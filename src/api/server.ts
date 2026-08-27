/**
 * api：管理接口（M4，ADR-008）。node:http 极简路由，不引框架。
 * 依赖方向：零实现依赖——所有能力经构造注入（index 装配 core/egress 的公开接口），
 * 本模块只依赖 lib。端点/错误码遵循 team-api-design skill。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { KEY_PATTERN } from '../lib/patterns.js';

export interface AdminApiDeps {
  /** 在线流列表 */
  listStreams(): readonly { key: string; startedAt: number; publisher: string }[];
  /** 踢流；流不存在返回 false */
  kickStream(key: string): boolean;
  /** 录像列表 */
  listRecords(): readonly { name: string; sizeBytes: number; startedAt: string }[];
  /** 开始录制；已在录/流不存在 返回 false */
  startRecord(key: string): boolean;
  /** 停止录制；未在录返回 false */
  stopRecord(key: string): Promise<boolean>;
  /** 删除录像（活动录制会先停录再删）；不存在/名称非法返回 false */
  removeRecord(name: string): Promise<boolean>;
}

export interface AdminApiOptions {
  readonly deps: AdminApiDeps;
  /** 管理令牌；未配置时写操作一律拒绝（只读模式） */
  readonly adminToken?: string;
  readonly logger: {
    info(msg: string, extra?: Record<string, unknown>): void;
    warn(msg: string, extra?: Record<string, unknown>): void;
  };
}

/** 错误码：五位 = HTTP 码 ×10 + 序号（team-api-design §4） */
type ApiError = { status: number; code: number; message: string };
const ERR_TOKEN = (msg: string): ApiError => ({ status: 401, code: 40101, message: msg });
const ERR_READONLY: ApiError = { status: 403, code: 40301, message: 'admin token 未配置，写操作被拒绝（只读模式）' };
const ERR_NOT_FOUND = (what: string): ApiError => ({ status: 404, code: 40401, message: `${what} not found` });
const ERR_CONFLICT: ApiError = { status: 409, code: 40901, message: 'record already running' };
const ERR_BAD_REQUEST = (msg: string): ApiError => ({ status: 400, code: 40001, message: msg });

class BodyError extends Error {
  constructor(readonly api: ApiError) {
    super(api.message);
  }
}

export function createAdminApi(opts: AdminApiOptions): {
  handle(req: IncomingMessage, res: ServerResponse): void;
} {
  const { deps, adminToken, logger } = opts;

  function send(res: ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(json);
  }

  function ok(res: ServerResponse, data: unknown = null): void {
    send(res, 200, { code: 0, message: 'ok', data });
  }

  function fail(res: ServerResponse, err: ApiError): void {
    send(res, err.status, { code: err.code, message: err.message, data: null });
  }

  /** 写操作认证：令牌已配置则必须匹配 */
  function authWrite(req: IncomingMessage): ApiError | null {
    if (!adminToken) return ERR_READONLY;
    const token = req.headers['x-admin-token'];
    if (token !== adminToken) return ERR_TOKEN('invalid admin token');
    return null;
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    void (async () => {
      try {
        // URL 解析必须防护：畸形请求行会让 new URL 同步抛出击穿进程（review blocker）
        let url: URL;
        try {
          url = new URL(req.url ?? '/', 'http://localhost');
        } catch {
          return fail(res, ERR_BAD_REQUEST('malformed request url'));
        }
        const p = url.pathname;

        // 健康检查（开放，无副作用）
        if (req.method === 'GET' && p === '/healthz') {
          return ok(res, { status: 'up' });
        }

        // 流管理
        if (req.method === 'GET' && p === '/api/v1/streams') {
          const items = deps.listStreams();
          return ok(res, { items, total: items.length }); // 单次调用保证原子一致
        }
        const kick = p.match(/^\/api\/v1\/streams\/(.+)$/);
        if (req.method === 'DELETE' && kick) {
          const authErr = authWrite(req);
          if (authErr) return fail(res, authErr);
          const key = decodeKey(kick[1]!);
          if (key === undefined) return fail(res, ERR_BAD_REQUEST('invalid stream key'));
          if (!deps.kickStream(key)) return fail(res, ERR_NOT_FOUND(`stream: ${key}`));
          logger.info('api: stream kicked', { key });
          return ok(res, { action: 'kicked', key });
        }

        // 录制管理
        if (req.method === 'GET' && p === '/api/v1/records') {
          const items = deps.listRecords();
          return ok(res, { items, total: items.length });
        }
        if (req.method === 'POST' && p === '/api/v1/records') {
          const authErr = authWrite(req);
          if (authErr) return fail(res, authErr);
          const body = await readJsonBody(req);
          const key = typeof body['key'] === 'string' ? body['key'] : undefined;
          if (key === undefined || !KEY_PATTERN.test(key)) {
            return fail(res, ERR_BAD_REQUEST('body must be { "key": "<app>/<name>" }'));
          }
          const normalized = key.replace(/^\//, '');
          if (!deps.listStreams().some((s) => s.key === normalized)) {
            return fail(res, ERR_NOT_FOUND(`stream: ${normalized}`));
          }
          if (!deps.startRecord(normalized)) return fail(res, ERR_CONFLICT);
          logger.info('api: record started', { key: normalized });
          return ok(res, { action: 'started', key: normalized });
        }
        const rec = p.match(/^\/api\/v1\/records\/(.+)$/);
        if (req.method === 'DELETE' && rec) {
          const authErr = authWrite(req);
          if (authErr) return fail(res, authErr);
          const name = decodeURIComponent(rec[1]!);
          // 先尝试停进行中的录制（name 为 stream key），再删除文件（活动文件由 recorder 先停再删）
          if (await deps.stopRecord(name)) {
            logger.info('api: record stopped', { key: name });
            return ok(res, { action: 'stopped', key: name });
          }
          if (await deps.removeRecord(name)) {
            logger.info('api: record removed', { name });
            return ok(res, { action: 'deleted', name });
          }
          return fail(res, ERR_NOT_FOUND(`record: ${name}`));
        }

        return fail(res, { status: 404, code: 40401, message: `no route: ${req.method} ${p}` });
      } catch (err) {
        // 客户端请求体错误 → 40001；未知错误 → 50001（均不击穿进程）
        if (err instanceof BodyError) return fail(res, err.api);
        logger.warn('api handler error', { detail: err instanceof Error ? err.message : String(err) });
        return fail(res, { status: 500, code: 50001, message: 'internal error' });
      }
    })();
  }

  function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let destroyed = false;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 64 * 1024) {
          // 先响应错误包，再断开（客户端能收到 JSON 而非连接重置）
          if (!destroyed) {
            destroyed = true;
            reject(new BodyError(ERR_BAD_REQUEST('body too large (max 64KB)')));
            req.destroy();
          }
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (destroyed) return;
        if (chunks.length === 0) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
        } catch {
          reject(new BodyError(ERR_BAD_REQUEST('invalid json body')));
        }
      });
      req.on('error', (err) => {
        if (!destroyed) reject(new BodyError(ERR_BAD_REQUEST(`body read failed: ${err.message}`)));
      });
    });
  }

  return { handle };
}

function decodeKey(raw: string): string | undefined {
  try {
    const key = decodeURIComponent(raw);
    return KEY_PATTERN.test(key) ? key.replace(/^\//, '') : undefined;
  } catch {
    return undefined;
  }
}

/** 测试/装配辅助：把 handler 挂到独立 http server */
export function listenAdminApi(
  handle: (req: IncomingMessage, res: ServerResponse) => void,
  port: number,
  host = '127.0.0.1',
): Promise<{ close(): Promise<void>; port: number }> {
  const server = createServer(handle);
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        close: () => new Promise<void>((r) => server.close(() => r())),
        port: actual,
      });
    });
  });
}

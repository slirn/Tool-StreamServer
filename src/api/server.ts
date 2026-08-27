/**
 * api：管理接口（M4，ADR-008）。node:http 极简路由，不引框架。
 * 依赖方向：零实现依赖——所有能力经构造注入（index 装配 core/egress 的公开接口），
 * 本模块只依赖 lib。端点/错误码遵循 team-api-design skill。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';

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
  /** 删除录像；不存在/名称非法返回 false */
  removeRecord(name: string): boolean;
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

const KEY_PATTERN = /^\/?([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)$/;

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
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;
    void (async () => {
      try {
        // 健康检查（开放，无副作用）
        if (req.method === 'GET' && p === '/healthz') {
          return ok(res, { status: 'up' });
        }

        // 流管理
        if (req.method === 'GET' && p === '/api/v1/streams') {
          return ok(res, { items: deps.listStreams(), total: deps.listStreams().length });
        }
        const kick = p.match(/^\/api\/v1\/streams\/(.+)$/);
        if (req.method === 'DELETE' && kick) {
          const authErr = authWrite(req);
          if (authErr) return fail(res, authErr);
          const key = decodeKey(kick[1]!);
          if (key === undefined) return fail(res, ERR_BAD_REQUEST('invalid stream key'));
          if (!deps.kickStream(key)) return fail(res, ERR_NOT_FOUND(`stream: ${key}`));
          logger.info('api: stream kicked', { key });
          return ok(res);
        }

        // 录制管理
        if (req.method === 'GET' && p === '/api/v1/records') {
          return ok(res, { items: deps.listRecords(), total: deps.listRecords().length });
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
          return ok(res);
        }
        const stopRec = p.match(/^\/api\/v1\/records\/(.+)$/);
        if (req.method === 'DELETE' && stopRec) {
          const authErr = authWrite(req);
          if (authErr) return fail(res, authErr);
          const name = decodeURIComponent(stopRec[1]!);
          // 先尝试停进行中的录制（name 为 stream key），再尝试删除文件
          if (await deps.stopRecord(name)) {
            logger.info('api: record stopped', { key: name });
            return ok(res);
          }
          if (deps.removeRecord(name)) {
            logger.info('api: record removed', { name });
            return ok(res);
          }
          return fail(res, ERR_NOT_FOUND(`record: ${name}`));
        }

        return fail(res, { status: 404, code: 40401, message: `no route: ${req.method} ${p}` });
      } catch (err) {
        logger.warn('api handler error', { detail: err instanceof Error ? err.message : String(err) });
        return fail(res, { status: 500, code: 50001, message: 'internal error' });
      }
    })();
  }

  return { handle };
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
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

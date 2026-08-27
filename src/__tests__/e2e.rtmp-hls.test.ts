/**
 * 端到端集成测试（ffmpeg 门控）：
 * - M2：推 RTMP → HLS m3u8 可拉 → 断推清理
 * - M3：无签名/错误签名推流被拒（不注册、推流端被断开）
 * 无 ffmpeg 时 skip 并说明原因（不静默）；CI（ubuntu 自带 ffmpeg）完整执行。
 * 依赖已构建的 dist/（先 npm run build）。
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest';
import { streamSign } from '../auth/signature.js';

const FFMPEG = process.env['FFMPEG_PATH'] ?? 'ffmpeg';
const NODE = process.execPath;
const HTTP_PORT = 18000;
const RTMP_PORT = 11935;
const APP = 'live';
const KEY = 'e2etest';
const AUTH_SECRET = 'e2e-secret-0123456789abcdef';

function pushUrl(key: string, sign?: string, expire?: number): string {
  const exp = expire ?? Math.floor(Date.now() / 1000) + 600;
  const s = sign ?? streamSign(AUTH_SECRET, `/${APP}/${key}`, exp);
  return `rtmp://127.0.0.1:${RTMP_PORT}/${APP}/${key}?expire=${exp}&sign=${s}`;
}

function hasFfmpeg(): boolean {
  try {
    execFile(FFMPEG, ['-version']);
    return true;
  } catch {
    return false;
  }
}

const ffmpegAvailable = hasFfmpeg();
if (!ffmpegAvailable) {
  // 不静默 skip：明确告知原因
  console.warn(`[e2e skipped] ${'本机未安装 ffmpeg（设置 FFMPEG_PATH 可指定路径）；CI runner 自带 ffmpeg 会完整执行本测试'}`);
}

describe.skipIf(!ffmpegAvailable)('e2e：RTMP 推流 / HLS / 鉴权 / 录制 / 管理 API', () => {
  let server: ReturnType<typeof spawn>;
  let mediaRoot: string;
  let recordsRoot: string;
  const serverLogs: string[] = [];
  const API_PORT_L = 18001;
  const ADMIN_TOKEN = 'e2e-admin-tok';

  beforeAll(async () => {
    mediaRoot = mkdtempSync(path.join(tmpdir(), 'ss-e2e-'));
    recordsRoot = mkdtempSync(path.join(tmpdir(), 'ss-e2e-rec-'));
    server = spawn(NODE, ['dist/index.js'], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HTTP_PORT: String(HTTP_PORT),
        RTMP_PORT: String(RTMP_PORT),
        MEDIA_ROOT: mediaRoot,
        RECORDS_ROOT: recordsRoot,
        API_PORT: String(API_PORT_L),
        ADMIN_TOKEN,
        HLS_FRAGMENT_SEC: '2',
        HLS_WINDOW_SIZE: '3',
        AUTH_SECRET: AUTH_SECRET,
        LOG_LEVEL: 'debug',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // 收集服务日志：测试失败时转储（不静默）
    server.stdout?.on('data', (c: Buffer) => serverLogs.push(c.toString()));
    server.stderr?.on('data', (c: Buffer) => serverLogs.push(c.toString()));
    // 等服务就绪：轮询管理 API 健康检查
    await waitFor(
      async () => (await fetch(`http://127.0.0.1:${API_PORT_L}/healthz`).catch(() => null))?.ok,
      10_000,
    );
  }, 20_000);

  afterAll(async () => {
    server?.kill();
    // 硬杀会留下孤儿 ffmpeg 占用录像文件：等待句柄释放后再清理，失败则留给 OS 清 tmp
    await new Promise((r) => setTimeout(r, 1500));
    for (const dir of [mediaRoot, recordsRoot]) {
      if (dir && existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* 孤儿进程句柄未释放：临时目录交给 OS */
        }
      }
    }
  });

  it('ffmpeg 推流（合法签名）→ m3u8 出现且分片 ≥2 → 断推后清理', async () => {
    const pusher = spawn(FFMPEG, [
      '-re',
      '-f', 'lavfi', '-i', 'testsrc=duration=12:size=640x360:rate=15',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-g', '30', // 2s 关键帧间隔：HLS copy 切片必须等关键帧，x264 默认 GOP=250(≈17s) 会让短推流永远切不出片
      '-c:a', 'aac',
      '-f', 'flv',
      pushUrl(KEY),
    ], { stdio: 'ignore' });

    const m3u8Url = `http://127.0.0.1:${HTTP_PORT}/hls/${APP}/${KEY}/index.m3u8`;
    // m3u8 出现（HLS 切片启动需要数秒）
    await waitFor(async () => {
      const res = await fetch(m3u8Url).catch(() => null);
      return res !== null && res.ok;
    }, 20_000, 500);

    // 分片数达到 ≥2
    await waitFor(async () => {
      const res = await fetch(m3u8Url).catch(() => null);
      if (!res?.ok) return false;
      const body = await res.text();
      return (body.match(/\.ts/g) ?? []).length >= 2;
    }, 20_000, 1000);

    await new Promise<void>((resolve) => pusher.on('close', () => resolve()));
    // 断推后分片清理：NMS v4 有 30s publish 宽限期（断线重连续传），
    // donePublish 在宽限期后触发 → egress 退订 → 目录删除。慢机器留足余量（60s）。
    await waitFor(() => {
      const dir = path.join(mediaRoot, APP, KEY);
      return !existsSync(dir) || readdirSync(dir).length === 0;
    }, 60_000, 1000);
    expect(existsSync(path.join(mediaRoot, APP, KEY))).toBe(false); // 目录确实被清
  }, 120_000);

  it('M3：错误签名推流被拒——推流端被断开且不产生任何 HLS 产出', async () => {
    const badKey = 'bad-sign';
    const pusher = spawn(FFMPEG, [
      '-re',
      '-f', 'lavfi', '-i', 'testsrc=duration=8:size=640x360:rate=15',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-g', '30',
      '-an',
      '-f', 'flv',
      pushUrl(badKey, '0'.repeat(64)), // 合法格式但错误签名
    ], { stdio: 'ignore' });

    // 推流端被服务端断开（ffmpeg 异常退出，非超时自然结束）
    const exit = await new Promise<number | null>((resolve) => pusher.on('close', (code) => resolve(code)));
    expect(exit).not.toBe(0);

    // 等待可能的注册路径走完（鉴权失败根本不注册），断言无 HLS 产出
    await new Promise((r) => setTimeout(r, 2000));
    expect(existsSync(path.join(mediaRoot, APP, badKey))).toBe(false);
  }, 30_000);

  it('M4：录制开停 + 踢流 + 管理 API 全链路', async () => {
    onTestFailed(() => console.error('[e2e server logs]\n' + serverLogs.join('')));
    const key = 'm4test';
    const api = (p: string, init?: RequestInit) =>
      fetch(`http://127.0.0.1:${API_PORT_L}${p}`, {
        ...init,
        headers: { 'x-admin-token': ADMIN_TOKEN, ...init?.headers },
      });
    const pusher = spawn(FFMPEG, [
      '-re',
      '-f', 'lavfi', '-i', 'testsrc=duration=40:size=640x360:rate=15',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-g', '30',
      '-an',
      '-f', 'flv',
      pushUrl(key),
    ], { stdio: 'ignore' });

    // 流上线（streams API 可见）
    await waitFor(async () => {
      const res = await api('/api/v1/streams');
      const body = await res.json();
      return body.data.items.some((s: { key: string }) => s.key === `${APP}/${key}`);
    }, 20_000, 500);

    // 开始录制
    const startRes = await api('/api/v1/records', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: `${APP}/${key}` }),
    });
    expect(startRes.status).toBe(200);

    // 录像文件出现且有实质内容（ffmpeg 有 I/O 缓冲，不做短窗增长断言以免 flaky）
    await waitFor(() => readdirSync(recordsRoot).some((n) => n.endsWith('.flv')), 15_000, 500);
    const recName = readdirSync(recordsRoot).find((n) => n.endsWith('.flv'))!;
    await waitFor(() => statSync(path.join(recordsRoot, recName)).size > 200_000, 15_000, 500);

    // 停止录制（按 stream key：live/m4test → URL 编码）
    const stopRes = await api(`/api/v1/records/${APP}%2F${key}`, { method: 'DELETE' });
    expect(stopRes.status).toBe(200);
    await waitFor(() => readdirSync(recordsRoot).includes(recName), 5_000, 300); // 文件保留（已停止）

    // 踢流：推流端被断开 + registry 立即清空
    const kickRes = await api(`/api/v1/streams/${APP}%2F${key}`, { method: 'DELETE' });
    expect(kickRes.status).toBe(200);
    const pusherExit = new Promise<number | null>((resolve) => pusher.on('close', (c) => resolve(c)));
    await waitFor(async () => {
      const res = await api('/api/v1/streams');
      const body = await res.json();
      return !body.data.items.some((s: { key: string }) => s.key === `${APP}/${key}`);
    }, 10_000, 300);
    expect(await pusherExit).not.toBe(0);

    // 录像列表可见且可删除
    const listRes = await api('/api/v1/records');
    const listBody = await listRes.json();
    expect(listBody.data.items.some((i: { name: string }) => i.name === recName)).toBe(true);
    const delRes = await api(`/api/v1/records/${encodeURIComponent(recName)}`, { method: 'DELETE' });
    expect(delRes.status).toBe(200);
    expect(readdirSync(recordsRoot).includes(recName)).toBe(false);
  }, 90_000);
});

async function waitFor(cond: () => Promise<boolean> | boolean, timeoutMs: number, intervalMs = 200): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await cond()) return;
    if (Date.now() > deadline) throw new Error(`waitFor 超时（${timeoutMs}ms）`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

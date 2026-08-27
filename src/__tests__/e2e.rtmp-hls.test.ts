/**
 * M2 端到端集成测试（ffmpeg 门控）：推 RTMP → HLS m3u8 可拉 → 断推清理。
 * 无 ffmpeg 时 skip 并说明原因（不静默）；CI（ubuntu 自带 ffmpeg）完整执行。
 * 依赖已构建的 dist/（先 npm run build）。
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FFMPEG = process.env['FFMPEG_PATH'] ?? 'ffmpeg';
const NODE = process.execPath;
const HTTP_PORT = 18000;
const RTMP_PORT = 11935;
const APP = 'live';
const KEY = 'e2etest';

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

describe.skipIf(!ffmpegAvailable)('M2 e2e：RTMP 推流 → HLS 拉流', () => {
  let server: ReturnType<typeof spawn>;
  let mediaRoot: string;

  beforeAll(async () => {
    mediaRoot = mkdtempSync(path.join(tmpdir(), 'ss-e2e-'));
    server = spawn(NODE, ['dist/index.js'], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HTTP_PORT: String(HTTP_PORT),
        RTMP_PORT: String(RTMP_PORT),
        MEDIA_ROOT: mediaRoot,
        HLS_FRAGMENT_SEC: '2',
        HLS_WINDOW_SIZE: '3',
        LOG_LEVEL: 'debug',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // 服务日志转储到测试输出（失败时 vitest 会显示；成功时不打扰）
    server.stdout?.on('data', () => {});
    server.stderr?.on('data', () => {});
    // 等服务就绪：轮询 m3u8 根（404 也算 http 已起）
    await waitFor(async () => (await fetch(`http://127.0.0.1:${HTTP_PORT}/`, { method: 'GET' }).catch(() => null)) !== null, 10_000);
  }, 20_000);

  afterAll(() => {
    server?.kill();
    if (mediaRoot && existsSync(mediaRoot)) rmSync(mediaRoot, { recursive: true, force: true });
  });

  it('ffmpeg 推流 → m3u8 出现且分片 ≥2 → 断推后清理', async () => {
    const pusher = spawn(FFMPEG, [
      '-re',
      '-f', 'lavfi', '-i', 'testsrc=duration=12:size=640x360:rate=15',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-g', '30', // 2s 关键帧间隔：HLS copy 切片必须等关键帧，x264 默认 GOP=250(≈17s) 会让短推流永远切不出片
      '-c:a', 'aac',
      '-f', 'flv',
      `rtmp://127.0.0.1:${RTMP_PORT}/${APP}/${KEY}`,
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
    // donePublish 在宽限期后触发 → egress 退订 → 目录删除。等待窗口需 > 30s。
    await waitFor(() => {
      const dir = path.join(mediaRoot, APP, KEY);
      if (!existsSync(dir)) return true;
      return readdirSync(dir).length === 0;
    }, 45_000, 1000);
    expect(true).toBe(true);
  }, 120_000);
});

async function waitFor(cond: () => Promise<boolean> | boolean, timeoutMs: number, intervalMs = 200): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await cond()) return;
    if (Date.now() > deadline) throw new Error(`waitFor 超时（${timeoutMs}ms）`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * egress：HLS 出口（ADR-006：NMS v4 无 HLS，由本模块按流 spawn ffmpeg 切片）。
 * 依赖方向：依赖 core（订阅流事件）/ lib；不依赖 ingress（经 RTMP URL 字符串解耦）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { StreamEventBus, StreamKey } from '../core/types.js';
import { STREAM_EVENTS } from '../core/types.js';
import type { Logger } from '../lib/logger.js';
import type { Egress } from './types.js';

export interface HlsEgressOptions {
  readonly bus: StreamEventBus;
  /** 本机 RTMP 地址（拉流源），如 rtmp://127.0.0.1:1935 */
  readonly rtmpBaseUrl: string;
  readonly mediaRoot: string;
  readonly hlsFragmentSec: number;
  readonly hlsWindowSize: number;
  readonly logger: Logger;
}

export class HlsEgress implements Egress {
  private readonly ffmpegByStream = new Map<StreamKey, ChildProcess>();
  private readonly opts: HlsEgressOptions;
  private running = false;

  constructor(opts: HlsEgressOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    if (this.running) return;
    const { bus, logger } = this.opts;
    bus.on(STREAM_EVENTS.publish, (e) => {
      if (e.type === 'publish') void this.onStreamPublished(e.meta.key);
    });
    bus.on(STREAM_EVENTS.unpublish, (e) => {
      if (e.type === 'unpublish') void this.unsubscribe(e.key);
    });
    this.running = true;
    logger.info('hls egress started', { mediaRoot: this.opts.mediaRoot });
  }

  /** publish 瞬间流 header（metadata/音视频头）可能尚未就绪：稍候再拉，失败重试 */
  private async onStreamPublished(key: StreamKey): Promise<void> {
    await sleep(PUBLISH_SETTLE_MS);
    for (let attempt = 1; attempt <= MAX_SPAWN_ATTEMPTS; attempt++) {
      if (!this.running) return;
      const produced = await this.spawnAndWaitForOutput(key);
      if (produced) return;
      this.opts.logger.warn('ffmpeg hls no output, retrying', { key, attempt });
      await sleep(RETRY_BACKOFF_MS);
    }
    this.opts.logger.error('ffmpeg hls failed after retries', { key });
  }

  /** spawn ffmpeg 并等待首个分片出现（或超时判定失败）。返回是否产出 */
  private async spawnAndWaitForOutput(key: StreamKey): Promise<boolean> {
    const started = this.subscribeRaw(key);
    if (!started) return false;
    const m3u8 = path.join(this.opts.mediaRoot, ...key.split('/'), 'index.m3u8');
    const deadline = Date.now() + FIRST_SEGMENT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(250);
      if (!this.ffmpegByStream.has(key)) return false; // ffmpeg 已退出
      if (existsSync(m3u8)) return true;
    }
    await this.killFfmpeg(key);
    return false;
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    for (const key of [...this.ffmpegByStream.keys()]) {
      await this.unsubscribe(key);
    }
    this.running = false;
    this.opts.logger.info('hls egress stopped');
  }

  /** 退订：停 ffmpeg（等待真正退出）、清分片目录（Windows 句柄占用需重试） */
  async unsubscribe(key: StreamKey): Promise<void> {
    await this.killFfmpeg(key);
    const outDir = path.join(this.opts.mediaRoot, ...key.split('/'));
    for (let i = 0; i < 10; i++) {
      try {
        rmSync(outDir, { recursive: true, force: true });
        return;
      } catch {
        await sleep(500); // 句柄未释放（ffmpeg 刚死）：稍候重试
      }
    }
    this.opts.logger.error('hls cleanup failed', { key });
  }

  private async killFfmpeg(key: StreamKey): Promise<void> {
    const ffmpeg = this.ffmpegByStream.get(key);
    if (!ffmpeg) return;
    const exited = new Promise<void>((resolve) => ffmpeg.once('close', () => resolve()));
    ffmpeg.kill('SIGKILL');
    await Promise.race([exited, sleep(8_000)]);
    this.ffmpegByStream.delete(key);
  }

  /** 真正 spawn ffmpeg（幂等：已存在则 false） */
  private subscribeRaw(key: StreamKey): boolean {
    if (this.ffmpegByStream.has(key)) return false;
    const { rtmpBaseUrl, mediaRoot, hlsFragmentSec, hlsWindowSize, logger } = this.opts;
    const outDir = path.join(mediaRoot, ...key.split('/'));
    mkdirSync(outDir, { recursive: true });
    const ffmpeg = spawn(ffmpegExecutable(), [
      '-loglevel', 'warning',
      '-rw_timeout', '5000000',
      '-i', `${rtmpBaseUrl}/${key}`,
      '-c', 'copy',
      '-f', 'hls',
      '-hls_time', String(hlsFragmentSec),
      '-hls_list_size', String(hlsWindowSize),
      '-hls_flags', 'delete_segments+append_list+omit_endlist',
      path.join(outDir, 'index.m3u8'),
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    ffmpeg.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) logger.warn('ffmpeg hls', { key, detail: text.slice(0, 300) });
    });
    ffmpeg.on('error', (err) => logger.error('ffmpeg spawn failed', { key, detail: err.message }));
    ffmpeg.on('close', (code) => {
      this.ffmpegByStream.delete(key);
      logger.info('ffmpeg hls exited', { key, code });
    });
    this.ffmpegByStream.set(key, ffmpeg);
    logger.info('hls subscribed', { key });
    return true;
  }

  /** 兼容 Egress 接口的 subscribe：直接触发（无重试语义，供测试/手动调用） */
  async subscribe(key: StreamKey): Promise<void> {
    this.subscribeRaw(key);
  }
}

const PUBLISH_SETTLE_MS = 2_000;
const MAX_SPAWN_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 500;
const FIRST_SEGMENT_TIMEOUT_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ffmpegExecutable(): string {
  return process.env['FFMPEG_PATH'] ?? 'ffmpeg';
}

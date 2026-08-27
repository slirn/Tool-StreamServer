/**
 * egress：HLS 出口（ADR-006：NMS v4 无 HLS，由本模块按流 spawn ffmpeg 切片）。
 * 依赖方向：依赖 core（订阅流事件）/ lib；不依赖 ingress（经 RTMP URL 字符串解耦）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type { StreamEventBus, StreamKey } from '../core/types.js';
import { STREAM_EVENTS } from '../core/types.js';
import { killGracefully } from './record-ffmpeg.js';
import type { Logger } from '../lib/logger.js';
import type { Egress } from './types.js';

export interface HlsEgressOptions {
  readonly bus: StreamEventBus;
  /** 本机 RTMP 地址（拉流源），如 rtmp://127.0.0.1:1935 */
  readonly rtmpBaseUrl: string;
  readonly mediaRoot: string;
  readonly hlsFragmentSec: number;
  readonly hlsWindowSize: number;
  /** 单机最大并发切片进程（防资源耗尽）；默认 32 */
  readonly maxConcurrent?: number;
  readonly logger: Logger;
}

/** 合法 streamKey：段间以 / 分隔，每段限字母数字下划线连字符（纵深防御：不依赖 NMS 校验） */
const KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

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
      if (e.type === 'publish') {
        this.onStreamPublished(e.meta.key).catch((err) =>
          logger.error('hls publish handler failed', { key: e.meta.key, detail: errorMessage(err) }),
        );
      }
    });
    bus.on(STREAM_EVENTS.unpublish, (e) => {
      if (e.type === 'unpublish') {
        this.unsubscribe(e.key).catch((err) =>
          logger.error('hls unpublish handler failed', { key: e.key, detail: errorMessage(err) }),
        );
      }
    });
    this.running = true;
    logger.info('hls egress started', { mediaRoot: this.opts.mediaRoot });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    for (const key of [...this.ffmpegByStream.keys()]) {
      await this.unsubscribe(key);
    }
    this.opts.logger.info('hls egress stopped');
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
    if (!this.spawnRaw(key)) return this.ffmpegByStream.has(key); // 已在跑（重连场景）视为成功
    const m3u8 = this.outFile(key);
    const deadline = Date.now() + FIRST_SEGMENT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(250);
      if (!this.ffmpegByStream.has(key)) return false; // ffmpeg 已退出
      if (isNonEmpty(m3u8)) return true;
    }
    await this.killFfmpeg(key);
    return false;
  }

  /** 退订：停 ffmpeg（等待真正退出）、清分片目录（Windows 句柄占用需重试） */
  async unsubscribe(key: StreamKey): Promise<void> {
    await this.killFfmpeg(key);
    const outDir = this.outDir(key);
    if (!outDir) return;
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
    // 优雅退出优先（Linux 下 ffmpeg 收 SIGINT 会写完尾部/ENDLIST）；超时 SIGKILL 兜底
    await killGracefully(ffmpeg);
    // 注意：不在此处删除 map 条目——由 'close' 事件统一删除。
    // 若兜底后进程仍活着（罕见），保留条目可防止同 key 双开 ffmpeg 竞争写文件。
  }

  /**
   * 真正 spawn ffmpeg。幂等：已在跑返回 false。
   * key 先过白名单（纵深防御，不信任上游），输出目录必须落在 mediaRoot 内。
   */
  private spawnRaw(key: StreamKey): boolean {
    if (this.ffmpegByStream.has(key)) return false;
    const outDir = this.outDir(key);
    if (!outDir) {
      this.opts.logger.warn('hls key rejected (invalid pattern or escapes mediaRoot)', { key });
      return false;
    }
    const max = this.opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    if (this.ffmpegByStream.size >= max) {
      this.opts.logger.error('hls concurrency limit reached, reject', { key, active: this.ffmpegByStream.size, max });
      return false;
    }
    const { rtmpBaseUrl, hlsFragmentSec, hlsWindowSize, logger } = this.opts;
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
    ffmpeg.on('close', () => {
      this.ffmpegByStream.delete(key); // 条目生命周期唯一归属：close 事件
      logger.info('ffmpeg hls exited', { key });
    });
    this.ffmpegByStream.set(key, ffmpeg);
    logger.info('hls subscribed', { key });
    return true;
  }

  /** 输出目录（含 key 白名单 + 穿越断言）；非法返回 undefined */
  private outDir(key: StreamKey): string | undefined {
    if (!KEY_PATTERN.test(key)) return undefined;
    const dir = path.join(this.opts.mediaRoot, ...key.split('/'));
    if (!path.resolve(dir).startsWith(path.resolve(this.opts.mediaRoot) + path.sep)) return undefined;
    return dir;
  }

  private outFile(key: StreamKey): string {
    return path.join(this.opts.mediaRoot, ...key.split('/'), 'index.m3u8');
  }

  /** 兼容 Egress 接口的 subscribe：直接触发（无重试语义，供测试/手动调用） */
  async subscribe(key: StreamKey): Promise<void> {
    this.spawnRaw(key);
  }
}

const PUBLISH_SETTLE_MS = 2_000;
const MAX_SPAWN_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 500;
const FIRST_SEGMENT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_CONCURRENT = 32;

function isNonEmpty(file: string): boolean {
  try {
    return existsSync(file) && statSync(file).size > 0;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ffmpegExecutable(): string {
  return process.env['FFMPEG_PATH'] ?? 'ffmpeg';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

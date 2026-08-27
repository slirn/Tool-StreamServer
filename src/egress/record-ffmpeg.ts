/**
 * egress：FLV 录制（M4，ADR-008）：按 API 指令对活跃流 spawn ffmpeg 落盘 FLV（copy 零转码）。
 * 依赖方向：core（流事件，流结束自动停录）/ lib；不依赖 ingress。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type { StreamEventBus, StreamKey } from '../core/types.js';
import { STREAM_EVENTS } from '../core/types.js';
import type { Logger } from '../lib/logger.js';

export interface RecordItem {
  readonly name: string;
  readonly sizeBytes: number;
  readonly startedAt: string; // ISO
}

export interface FlvRecorderOptions {
  readonly bus: StreamEventBus;
  readonly rtmpBaseUrl: string;
  readonly recordsRoot: string;
  readonly maxConcurrent?: number;
  readonly logger: Logger;
}

/** 录像文件名：<key 段以 ~ 连接>_<时间戳>.flv；字符集收紧防路径攻击 */
const NAME_PATTERN = /^[A-Za-z0-9_-]+(~[A-Za-z0-9_-]+)*_\d{8}-\d{6}\.flv$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
const DEFAULT_MAX_CONCURRENT = 16;

export class FlvRecorder {
  private readonly ffmpegByStream = new Map<StreamKey, ChildProcess>();
  private readonly opts: FlvRecorderOptions;
  private started = false;

  constructor(opts: FlvRecorderOptions) {
    this.opts = opts;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    // 流结束（宽限期后）自动停录，防孤儿 ffmpeg
    this.opts.bus.on(STREAM_EVENTS.unpublish, (e) => {
      if (e.type === 'unpublish') {
        this.stop(e.key).catch((err) =>
          this.opts.logger.error('auto stop record failed', { key: e.key, detail: errorMessage(err) }),
        );
      }
    });
    mkdirSync(this.opts.recordsRoot, { recursive: true });
  }

  /** 开始录制一路流；已在录/流 key 非法/超并发 返回 false */
  startRecord(key: StreamKey): boolean {
    if (this.ffmpegByStream.has(key)) return false;
    if (!KEY_PATTERN.test(key)) return false;
    const max = this.opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    if (this.ffmpegByStream.size >= max) {
      this.opts.logger.error('record concurrency limit reached', { key, active: this.ffmpegByStream.size, max });
      return false;
    }
    const file = path.join(this.opts.recordsRoot, recordName(key));
    mkdirSync(this.opts.recordsRoot, { recursive: true });
    const ffmpeg = spawn(ffmpegExecutable(), [
      '-loglevel', 'warning',
      '-rw_timeout', '5000000',
      '-i', `${this.opts.rtmpBaseUrl}/${key}`,
      '-c', 'copy',
      '-f', 'flv',
      '-flvflags', 'no_duration_filesize',
      file,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    ffmpeg.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.opts.logger.warn('ffmpeg record', { key, detail: text.slice(0, 300) });
    });
    ffmpeg.on('error', (err) => this.opts.logger.error('ffmpeg record spawn failed', { key, detail: err.message }));
    ffmpeg.on('close', () => {
      this.ffmpegByStream.delete(key); // 条目生命周期唯一归属：close 事件
      this.opts.logger.info('ffmpeg record exited', { key });
    });
    this.ffmpegByStream.set(key, ffmpeg);
    this.opts.logger.info('record started', { key, file });
    return true;
  }

  /** 停止录制（未在录返回 false） */
  async stopRecord(key: StreamKey): Promise<boolean> {
    const ffmpeg = this.ffmpegByStream.get(key);
    if (!ffmpeg) return false;
    await killGracefully(ffmpeg);
    return true;
  }

  /** 列出已完成与进行中的录像 */
  list(): readonly RecordItem[] {
    if (!existsSync(this.opts.recordsRoot)) return [];
    return readdirSync(this.opts.recordsRoot)
      .filter((n) => NAME_PATTERN.test(n))
      .map((n) => {
        const st = statSync(path.join(this.opts.recordsRoot, n));
        return { name: n, sizeBytes: st.size, startedAt: st.birthtime.toISOString() };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  /** 删除录像（名称必须严格匹配白名单，防穿越） */
  remove(name: string): boolean {
    if (!NAME_PATTERN.test(name)) return false;
    const file = path.join(this.opts.recordsRoot, name);
    if (!path.resolve(file).startsWith(path.resolve(this.opts.recordsRoot) + path.sep)) return false;
    if (!existsSync(file)) return false;
    rmSync(file, { force: true });
    return true;
  }

  /** 兼容命名（内部自动停录用） */
  private async stop(key: StreamKey): Promise<void> {
    await this.stopRecord(key);
  }

  async stopAll(): Promise<void> {
    for (const key of [...this.ffmpegByStream.keys()]) {
      await this.stopRecord(key);
    }
  }
}

/** 录像文件名：live/key → live~key_20260827-153000.flv */
export function recordName(key: string, now = new Date()): string {
  const p = key.replaceAll('/', '~');
  const ts = [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('') + '-' + [String(now.getHours()), String(now.getMinutes()), String(now.getSeconds())]
    .map((s) => s.padStart(2, '0')).join('');
  return `${p}_${ts}.flv`;
}

/** 优雅退出：SIGINT（Linux 下 ffmpeg 会写完尾部）→ 2s 后 SIGKILL 兜底（Windows 信号为强制） */
export async function killGracefully(ffmpeg: ChildProcess): Promise<void> {
  const exited = new Promise<void>((resolve) => ffmpeg.once('close', () => resolve()));
  ffmpeg.kill('SIGINT');
  const graceful = await Promise.race([exited.then(() => true), sleep(2_000).then(() => false)]);
  if (!graceful) {
    ffmpeg.kill('SIGKILL');
    await Promise.race([exited, sleep(5_000)]);
  }
}

function ffmpegExecutable(): string {
  return process.env['FFMPEG_PATH'] ?? 'ffmpeg';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

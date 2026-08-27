/**
 * egress：FLV 录制（M4，ADR-008）：按 API 指令对活跃流 spawn ffmpeg 落盘 FLV（copy 零转码）。
 * 依赖方向：core（流事件，流结束自动停录）/ lib；不依赖 ingress。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type { StreamEventBus, StreamKey } from '../core/types.js';
import { STREAM_EVENTS } from '../core/types.js';
import { ffmpegExecutable, killGracefully } from '../lib/ffmpeg.js';
import { KEY_PATTERN, RECORD_NAME_PATTERN } from '../lib/patterns.js';
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

const DEFAULT_MAX_CONCURRENT = 16;

interface ActiveRecord {
  readonly ffmpeg: ChildProcess;
  readonly file: string;
}

export class FlvRecorder {
  private readonly active = new Map<StreamKey, ActiveRecord>();
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
        this.stopRecord(e.key).catch((err) =>
          this.opts.logger.error('auto stop record failed', { key: e.key, detail: errorMessage(err) }),
        );
      }
    });
    mkdirSync(this.opts.recordsRoot, { recursive: true });
  }

  /** 开始录制一路流；已在录/流 key 非法/超并发 返回 false */
  startRecord(key: StreamKey): boolean {
    if (this.active.has(key)) return false;
    if (!KEY_PATTERN.test(key)) return false;
    const max = this.opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    if (this.active.size >= max) {
      this.opts.logger.error('record concurrency limit reached', { key, active: this.active.size, max });
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
      this.active.delete(key); // 条目生命周期唯一归属：close 事件
      this.opts.logger.info('ffmpeg record exited', { key });
    });
    this.active.set(key, { ffmpeg, file });
    this.opts.logger.info('record started', { key, file });
    return true;
  }

  /** 停止录制（未在录返回 false） */
  async stopRecord(key: StreamKey): Promise<boolean> {
    const rec = this.active.get(key);
    if (!rec) return false;
    await killGracefully(rec.ffmpeg);
    return true;
  }

  /** 列出已完成与进行中的录像（逐条容错：竞态删除的条目跳过） */
  list(): readonly RecordItem[] {
    if (!existsSync(this.opts.recordsRoot)) return [];
    const out: RecordItem[] = [];
    for (const n of readdirSync(this.opts.recordsRoot)) {
      if (!RECORD_NAME_PATTERN.test(n)) continue;
      try {
        const st = statSync(path.join(this.opts.recordsRoot, n));
        out.push({ name: n, sizeBytes: st.size, startedAt: (st.birthtime ?? st.mtime).toISOString() });
      } catch {
        /* 条目在列出瞬间被删：跳过 */
      }
    }
    return out.sort((a, b) => b.name.localeCompare(a.name));
  }

  /**
   * 删除录像（名称必须严格匹配白名单，防穿越）。
   * 活动录制的文件会先停录再删（防 Windows EPERM / POSIX 孤儿 inode 泄漏）。
   */
  async remove(name: string): Promise<boolean> {
    if (!RECORD_NAME_PATTERN.test(name)) return false;
    const file = path.join(this.opts.recordsRoot, name);
    if (!path.resolve(file).startsWith(path.resolve(this.opts.recordsRoot) + path.sep)) return false;
    // 活动录制：先停
    for (const [key, rec] of this.active) {
      if (path.basename(rec.file) === name) {
        await killGracefully(rec.ffmpeg);
        this.active.delete(key);
      }
    }
    if (!existsSync(file)) return false;
    rmSync(file, { force: true });
    return true;
  }

  /** 全部停录（并行，避免串行 kill 累积超时） */
  async stopAll(): Promise<void> {
    await Promise.all([...this.active.keys()].map((key) => this.stopRecord(key)));
  }
}

/** 录像文件名：live/key → live~key_20260827-153000.flv */
export function recordName(key: string, now = new Date()): string {
  const p = key.replaceAll('/', '~');
  const ts =
    [String(now.getFullYear()).padStart(4, '0'), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('') +
    '-' +
    [now.getHours(), now.getMinutes(), now.getSeconds()].map((s) => String(s).padStart(2, '0')).join('');
  return `${p}_${ts}.flv`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

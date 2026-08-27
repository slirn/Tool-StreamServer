/** lib：ffmpeg 子进程管理共享工具（HLS 切片与 FLV 录制共用） */
import type { ChildProcess } from 'node:child_process';

/** 优雅退出：SIGINT（Linux 下 ffmpeg 会写完尾部/ENDLIST）→ 2s 后 SIGKILL 兜底（Windows 信号为强制） */
export async function killGracefully(ffmpeg: ChildProcess): Promise<void> {
  const exited = new Promise<void>((resolve) => ffmpeg.once('close', () => resolve()));
  ffmpeg.kill('SIGINT');
  const graceful = await Promise.race([exited.then(() => true), sleep(2_000).then(() => false)]);
  if (!graceful) {
    ffmpeg.kill('SIGKILL');
    await Promise.race([exited, sleep(5_000)]);
  }
}

export function ffmpegExecutable(): string {
  return process.env['FFMPEG_PATH'] ?? 'ffmpeg';
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

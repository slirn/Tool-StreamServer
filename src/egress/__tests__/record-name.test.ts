import { describe, expect, it } from 'vitest';
import { recordName } from '../record-ffmpeg.js';

describe('recordName', () => {
  it('key 段以 ~ 连接 + 时间戳 + .flv 后缀', () => {
    const now = new Date(2026, 7, 27, 15, 30, 5); // 2026-08-27 15:30:05 本地
    expect(recordName('live/stream1', now)).toBe('live~stream1_20260827-153005.flv');
    expect(recordName('live/a/b', now)).toBe('live~a~b_20260827-153005.flv');
    expect(recordName('live/x', now)).toMatch(/^[A-Za-z0-9_~-]+_\d{8}-\d{6}\.flv$/);
  });

  it('个位数月/日/时/分/秒补零', () => {
    const now = new Date(2026, 0, 2, 3, 4, 5); // 2026-01-02 03:04:05
    expect(recordName('live/k', now)).toBe('live~k_20260102-030405.flv');
  });
});

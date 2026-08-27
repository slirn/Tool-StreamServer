import { describe, expect, it } from 'vitest';
import { signedPushUrl, streamSign, verifyStreamSign } from '../signature.js';

const SECRET = 'test-secret-0123456789abcdef';
const PATH = '/live/stream1';
const NOW = 1_700_000_000;

describe('streamSign / signedPushUrl', () => {
  it('签名可复现且随输入变化', () => {
    const s1 = streamSign(SECRET, PATH, NOW);
    expect(s1).toBe(streamSign(SECRET, PATH, NOW));
    expect(s1).toHaveLength(64);
    expect(streamSign(SECRET, PATH, NOW + 1)).not.toBe(s1);
    expect(streamSign('other', PATH, NOW)).not.toBe(s1);
    expect(streamSign(SECRET, '/live/stream2', NOW)).not.toBe(s1);
  });

  it('signedPushUrl 生成可通过校验的 URL', () => {
    const url = signedPushUrl(SECRET, 'rtmp://h:1935', PATH, NOW + 300);
    expect(url).toMatch(/^rtmp:\/\/h:1935\/live\/stream1\?expire=\d+&sign=[0-9a-f]{64}$/);
    const query = Object.fromEntries(new URL(url).searchParams);
    expect(verifyStreamSign(SECRET, PATH, query, NOW)).toEqual({ ok: true });
  });
});

describe('verifyStreamSign 拒绝路径', () => {
  const validQuery = () => ({ expire: String(NOW + 300), sign: streamSign(SECRET, PATH, NOW + 300) });

  it('缺失/非法 expire', () => {
    expect(verifyStreamSign(SECRET, PATH, undefined, NOW).reason).toBe('missing-expire');
    expect(verifyStreamSign(SECRET, PATH, {}, NOW).reason).toBe('missing-expire');
    expect(verifyStreamSign(SECRET, PATH, { expire: 'abc' }, NOW).reason).toBe('invalid-expire');
    expect(verifyStreamSign(SECRET, PATH, { expire: '-1' }, NOW).reason).toBe('invalid-expire');
  });

  it('过期拒绝（边界：等于当前时间视为过期）', () => {
    expect(verifyStreamSign(SECRET, PATH, validQuery(), NOW + 301).reason).toBe('expired');
    expect(verifyStreamSign(SECRET, PATH, validQuery(), NOW + 300)).toEqual({ ok: true });
  });

  it('签名缺失/格式错/篡改拒绝', () => {
    expect(verifyStreamSign(SECRET, PATH, { expire: String(NOW + 300) }, NOW).reason).toBe('missing-sign');
    expect(
      verifyStreamSign(SECRET, PATH, { expire: String(NOW + 300), sign: 'zz' }, NOW).reason,
    ).toBe('missing-sign');
    const tampered = { ...validQuery(), sign: streamSign(SECRET, PATH, NOW + 299) };
    expect(verifyStreamSign(SECRET, PATH, tampered, NOW).reason).toBe('sign-mismatch');
    expect(verifyStreamSign('wrong-secret', PATH, validQuery(), NOW).reason).toBe('sign-mismatch');
  });
});

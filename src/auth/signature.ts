/**
 * auth：推流 URL 签名（HMAC-SHA256 + 过期时间）。
 * 纯函数、零依赖，供 policy 与外部工具生成签名 URL。
 *
 * 格式：rtmp://host/<app>/<key>?expire=<unix秒>&sign=<hmac-sha256-hex>
 * 签名串：`${streamPath}-${expire}`，密钥 = AUTH_SECRET
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export function streamSign(secret: string, streamPath: string, expireUnixSec: number): string {
  return createHmac('sha256', secret).update(`${streamPath}-${expireUnixSec}`).digest('hex');
}

/** 生成带签名的完整推流 URL（工具函数，供测试与运维脚本用） */
export function signedPushUrl(
  secret: string,
  rtmpBaseUrl: string,
  streamPath: string,
  expireUnixSec: number,
): string {
  const sign = streamSign(secret, streamPath, expireUnixSec);
  return `${rtmpBaseUrl}${streamPath}?expire=${expireUnixSec}&sign=${sign}`;
}

export type VerifyFailure =
  | 'missing-expire'
  | 'invalid-expire'
  | 'missing-sign'
  | 'expired'
  | 'sign-mismatch';

export interface VerifyResult {
  readonly ok: boolean;
  readonly reason?: VerifyFailure;
}

/**
 * 校验推流签名。
 * @param query 推流 URL 的 query 参数（来自 NMS session.streamQuery）
 * @param nowUnixSec 当前时间（注入便于测试）
 */
export function verifyStreamSign(
  secret: string,
  streamPath: string,
  query: Readonly<Record<string, string>> | undefined,
  nowUnixSec: number,
): VerifyResult {
  const expireRaw = query?.['expire'];
  if (expireRaw === undefined || expireRaw === '') return { ok: false, reason: 'missing-expire' };
  if (!/^\d+$/.test(expireRaw)) return { ok: false, reason: 'invalid-expire' };
  const expire = Number(expireRaw);
  if (expire < nowUnixSec) return { ok: false, reason: 'expired' };
  const sign = query?.['sign'];
  if (sign === undefined || !/^[0-9a-f]{64}$/.test(sign)) return { ok: false, reason: 'missing-sign' };
  const expected = streamSign(secret, streamPath, expire);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sign, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'sign-mismatch' };
  return { ok: true };
}

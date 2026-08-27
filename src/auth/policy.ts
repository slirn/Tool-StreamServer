/**
 * auth：AuthPolicy 实现（M1 接口落地，ADR：推流 HMAC 签名、拉流 v1 开放）。
 */
import type { AuthInput, AuthPolicy, AuthResult } from './types.js';
import { verifyStreamSign } from './signature.js';

export class HmacAuthPolicy implements AuthPolicy {
  constructor(private readonly secret: string) {}

  async verifyPublish(input: AuthInput): Promise<AuthResult> {
    // streamPath 在 NMS 会话上形如 "/live/key"，与签名串一致
    const result = verifyStreamSign(this.secret, `/${input.key}`, input.query, nowSec());
    return { ok: result.ok, reason: result.reason };
  }

  async verifyPlay(_input: AuthInput): Promise<AuthResult> {
    return { ok: true }; // v1 拉流开放（已批准决策）
  }
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

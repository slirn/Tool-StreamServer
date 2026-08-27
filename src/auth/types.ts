/**
 * auth 模块：推流/拉流鉴权（v1：URL 签名，策略可插拔）。
 * M1 仅定义接口占位，实现在 M3。
 */
import type { StreamKey } from '../core/types.js';

export interface AuthInput {
  readonly key: StreamKey;
  /** 推流 URL 携带的鉴权参数（如签名、过期时间） */
  readonly query: Readonly<Record<string, string>>;
}

export interface AuthResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface AuthPolicy {
  /** 校验推流请求；拒绝时 ingress 必须断开连接 */
  verifyPublish(input: AuthInput): Promise<AuthResult>;
  /** 校验拉流请求 */
  verifyPlay(input: AuthInput): Promise<AuthResult>;
}

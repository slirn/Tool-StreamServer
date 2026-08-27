/**
 * api 模块：REST 管理接口（查询在线流、踢流等）。实现在 M4。
 * 依赖方向：只依赖 core / lib；【不得】依赖 ingress / egress / auth 实现。
 */
import type { StreamMeta } from '../core/types.js';

export interface ApiConfig {
  readonly httpPort: number;
  /** 管理 token；为空时管理接口拒绝写操作 */
  readonly adminToken?: string;
}

export interface AdminApi {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** 查询在线流 */
  listStreams(): readonly StreamMeta[];
}

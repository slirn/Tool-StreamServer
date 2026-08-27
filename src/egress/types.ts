/**
 * egress 模块：拉流出口（HLS / HTTP-FLV）。实现在 M2/M3。
 * 依赖方向：可依赖 core / lib；【不得】依赖 ingress / api。
 */
import type { StreamKey } from '../core/types.js';

export interface EgressConfig {
  readonly httpPort: number;
  readonly hlsFragmentSec: number;
  readonly hlsWindowSize: number;
}

export interface Egress {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** 订阅 core 中已发布的流（HLS 切片 / FLV 连接由实现维护） */
  subscribe(key: StreamKey): Promise<void>;
  unsubscribe(key: StreamKey): Promise<void>;
}

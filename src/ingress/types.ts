/**
 * ingress 模块：推流接入（RTMP 监听、鉴权钩子）。实现在 M2。
 * 依赖方向：可依赖 core / auth / lib；【不得】依赖 egress / api。
 */
import type { StreamMeta } from '../core/types.js';

export interface IngressConfig {
  readonly rtmpPort: number;
  readonly app: string;
}

export interface Ingress {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** 连接建立、鉴权通过后，由实现写入 core 的 StreamRegistry */
  onPublished(meta: StreamMeta): void;
}

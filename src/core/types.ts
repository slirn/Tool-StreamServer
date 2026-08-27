/**
 * core 模块：流管理的核心抽象。
 *
 * 依赖方向铁律（ARCHITECTURE §4）：
 * - 本模块【不得】import ingress / egress / api 的任何实现
 * - 本模块【不得】使用任何第三方媒体库；只用 Node 内置与本地 lib
 */
import { EventEmitter } from 'node:events';

/** 流的唯一标识，如 "live/stream1" */
export type StreamKey = string;

export interface StreamMeta {
  readonly key: StreamKey;
  /** 发布开始时间（epoch ms） */
  readonly startedAt: number;
  /** 推流端描述（如 remote address），仅用于观测 */
  readonly publisher: string;
}

export type StreamEvent =
  | { type: 'publish'; meta: StreamMeta }
  | { type: 'unpublish'; key: StreamKey; reason: 'closed' | 'kicked' | 'error' }
  | { type: 'subscribe'; key: StreamKey; subscriber: string }
  | { type: 'unsubscribe'; key: StreamKey; subscriber: string };

/** 流注册表：发布/订阅生命周期的唯一事实来源 */
export interface StreamRegistry {
  /** 注册流；key 已存在时返回 false（重复推流拒绝） */
  publish(meta: StreamMeta): boolean;
  /** 移除流；key 不存在时返回 false */
  unpublish(key: StreamKey, reason: 'closed' | 'kicked' | 'error'): boolean;
  has(key: StreamKey): boolean;
  get(key: StreamKey): StreamMeta | undefined;
  list(): readonly StreamMeta[];
}

/** 事件总线：业务层（egress/api）通过它感知流生命周期，而非反向持有引用 */
export interface StreamEventBus extends EventEmitter {
  emitStream(event: StreamEvent): void;
}

/** 默认事件总线实现（Node EventEmitter 直通） */
export class MemoryStreamEventBus extends EventEmitter implements StreamEventBus {
  emitStream(event: StreamEvent): void {
    this.emit(STREAM_EVENTS[event.type], event);
  }
}

export const STREAM_EVENTS = Object.freeze({
  publish: 'stream:publish',
  unpublish: 'stream:unpublish',
  subscribe: 'stream:subscribe',
  unsubscribe: 'stream:unsubscribe',
} as const);

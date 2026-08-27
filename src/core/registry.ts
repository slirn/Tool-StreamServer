/**
 * MemoryStreamRegistry：StreamRegistry 的纯内存实现（ADR-005 单进程内存转发表）。
 * 零第三方依赖；线程模型为 Node 单线程事件循环，无锁。
 */
import type { StreamEventBus, StreamKey, StreamMeta, StreamRegistry } from './types.js';
import { MemoryStreamEventBus } from './types.js';

export class MemoryStreamRegistry implements StreamRegistry {
  private readonly streams = new Map<StreamKey, StreamMeta>();
  private readonly bus: StreamEventBus;

  constructor(bus?: StreamEventBus) {
    this.bus = bus ?? new MemoryStreamEventBus();
  }

  /**
   * 注册流；key 已存在时视为"宽限期内重连续传"：
   * 刷新元数据并再次发出 publish 事件（egress 幂等，可安全重订），返回 false。
   */
  publish(meta: StreamMeta): boolean {
    const isResume = this.streams.has(meta.key);
    this.streams.set(meta.key, meta);
    this.bus.emitStream({ type: 'publish', meta });
    return !isResume;
  }

  unpublish(key: StreamKey, reason: 'closed' | 'kicked' | 'error'): boolean {
    if (!this.streams.delete(key)) return false;
    this.bus.emitStream({ type: 'unpublish', key, reason });
    return true;
  }

  has(key: StreamKey): boolean {
    return this.streams.has(key);
  }

  get(key: StreamKey): StreamMeta | undefined {
    return this.streams.get(key);
  }

  list(): readonly StreamMeta[] {
    return [...this.streams.values()];
  }

  get events(): StreamEventBus {
    return this.bus;
  }
}

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

  publish(meta: StreamMeta): boolean {
    if (this.streams.has(meta.key)) return false; // 重复推流拒绝（语义由单测固化）
    this.streams.set(meta.key, meta);
    this.bus.emitStream({ type: 'publish', meta });
    return true;
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

import { describe, expect, it, vi } from 'vitest';
import { MemoryStreamRegistry } from '../registry.js';
import { STREAM_EVENTS, type StreamEvent, type StreamEventBus } from '../types.js';
import { EventEmitter } from 'node:events';

function makeBus(): StreamEventBus {
  const bus = new EventEmitter() as StreamEventBus;
  bus.emitStream = (e: StreamEvent) => bus.emit(STREAM_EVENTS[e.type], e);
  return bus;
}

function meta(key: string, startedAt = Date.now()) {
  return { key, startedAt, publisher: '127.0.0.1:1234' };
}

describe('MemoryStreamRegistry', () => {
  it('publish 注册流并发出 publish 事件', () => {
    const bus = makeBus();
    const reg = new MemoryStreamRegistry(bus);
    const onPublish = vi.fn();
    bus.on(STREAM_EVENTS.publish, onPublish);

    expect(reg.publish(meta('live/a'))).toBe(true);
    expect(reg.has('live/a')).toBe(true);
    expect(reg.get('live/a')!.publisher).toBe('127.0.0.1:1234');
    expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({ type: 'publish' }));
  });

  it('重复 streamKey 视为重连续传：返回 false 但刷新元数据并再发事件', () => {
    const bus = makeBus();
    const reg = new MemoryStreamRegistry(bus);
    const onPublish = vi.fn();
    bus.on(STREAM_EVENTS.publish, onPublish);

    expect(reg.publish(meta('live/a', 1))).toBe(true);
    expect(reg.publish(meta('live/a', 2))).toBe(false); // 宽限期重连：续期而非拒绝
    expect(onPublish).toHaveBeenCalledTimes(2); // 两次都发事件（egress 幂等重订）
    expect(reg.get('live/a')!.startedAt).toBe(2); // 元数据已刷新
  });

  it('unpublish 删除流并携带原因', () => {
    const bus = makeBus();
    const reg = new MemoryStreamRegistry(bus);
    const seen: StreamEvent[] = [];
    bus.on(STREAM_EVENTS.unpublish, (e: StreamEvent) => seen.push(e));

    reg.publish(meta('live/a'));
    expect(reg.unpublish('live/a', 'closed')).toBe(true);
    expect(reg.has('live/a')).toBe(false);
    expect(seen[0]).toMatchObject({ type: 'unpublish', key: 'live/a', reason: 'closed' });
  });

  it('unpublish 不存在的流返回 false 且不发事件', () => {
    const bus = makeBus();
    const reg = new MemoryStreamRegistry(bus);
    const onUnpublish = vi.fn();
    bus.on(STREAM_EVENTS.unpublish, onUnpublish);

    expect(reg.unpublish('live/none', 'error')).toBe(false);
    expect(onUnpublish).not.toHaveBeenCalled();
  });

  it('list 返回快照，不受后续修改影响', () => {
    const reg = new MemoryStreamRegistry();
    reg.publish(meta('live/a'));
    reg.publish(meta('live/b'));
    const snapshot = reg.list();
    reg.unpublish('live/a', 'closed');
    expect(snapshot).toHaveLength(2);
    expect(reg.list()).toHaveLength(1);
  });
});

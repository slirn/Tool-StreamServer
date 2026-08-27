import { describe, expect, it } from 'vitest';
import { createLogger } from '../logger.js';

describe('createLogger', () => {
  it('按级别过滤输出', () => {
    const lines: string[] = [];
    const logger = createLogger('warn', (l) => lines.push(l));
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).level).toBe('warn');
  });

  it('敏感字段脱敏（顶层 + 嵌套 + 数组 + 大小写变体）；流 key 不误伤', () => {
    const lines: string[] = [];
    const logger = createLogger('info', (l) => lines.push(l));
    logger.info('boot', {
      authSecret: 's3cr3t',
      httpPort: 8000,
      key: 'live/stream1',
      user: { apiKey: 'k1', name: 'dev', roles: [{ token: 't1' }, { id: 7 }] },
      Authorization: 'Bearer xyz',
    });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.authSecret).toBe('***');
    expect(parsed.httpPort).toBe(8000);
    expect(parsed.key).toBe('live/stream1');
    expect(parsed.user.apiKey).toBe('***');
    expect(parsed.user.name).toBe('dev');
    expect(parsed.user.roles[0].token).toBe('***');
    expect(parsed.user.roles[1].id).toBe(7);
    expect(parsed.Authorization).toBe('***');
  });

  it('循环引用 / BigInt 降级输出，不抛错', () => {
    const lines: string[] = [];
    const logger = createLogger('info', (l) => lines.push(l));
    const cyc: Record<string, unknown> = { a: 1 };
    cyc['self'] = cyc;
    // 循环引用被深度截断化解（第 5 层起 '[deep]'），序列化不抛错
    expect(() => logger.info('cyclic', cyc)).not.toThrow();
    const parsedCyc = JSON.parse(lines[0]!);
    expect(parsedCyc.a).toBe(1);
    // BigInt 无法序列化 → 整体降级为 '[unserializable]'
    expect(() => logger.info('bigint', { n: 10n })).not.toThrow();
    expect(JSON.parse(lines[1]!).extra).toBe('[unserializable]');
  });

  it('undefined extra 正常输出；深度超限截断', () => {
    const lines: string[] = [];
    const logger = createLogger('info', (l) => lines.push(l));
    logger.info('plain');
    expect(JSON.parse(lines[0]!).msg).toBe('plain');
    logger.info('deep', { l1: { l2: { l3: { l4: { l5: { l6: 'x' } } } } } });
    expect(JSON.parse(lines[1]!).l1.l2.l3.l4.l5).toBe('[deep]');
  });
});

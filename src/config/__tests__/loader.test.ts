import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../loader.js';

describe('loadConfig', () => {
  it('完整环境返回覆盖值', () => {
    const c = loadConfig({ NODE_ENV: 'development' });
    expect(c).toEqual({
      nodeEnv: 'development',
      httpPort: 8000,
      rtmpPort: 1935,
      rtmpApp: 'live',
      hlsFragmentSec: 6,
      hlsWindowSize: 5,
      authSecret: 'dev-insecure-secret',
      logLevel: 'info',
    });
  });

  it('环境变量覆盖默认值（含空串回落默认）', () => {
    const c = loadConfig({
      NODE_ENV: 'development',
      HTTP_PORT: '9000',
      LOG_LEVEL: 'debug',
      RTMP_APP: 'app2',
      HTTP_PORT_BAK: '',
    });
    expect(c.httpPort).toBe(9000);
    expect(c.logLevel).toBe('debug');
    expect(c.rtmpApp).toBe('app2');
    expect(loadConfig({ NODE_ENV: 'test', HTTP_PORT: '' }).httpPort).toBe(8000);
  });

  it('NODE_ENV 缺失或空串 fail-fast（防生产漏设静默降级）', () => {
    expect(() => loadConfig({})).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ NODE_ENV: '' })).toThrow(/NODE_ENV/);
  });

  it('非法端口 fail-fast（非数字 / 越界 / 小数 / 负数）', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', HTTP_PORT: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: 'test', HTTP_PORT: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: 'test', HTTP_PORT: '65536' })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: 'test', HTTP_PORT: '-1' })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: 'test', HTTP_PORT: '1.5' })).toThrow(ConfigError);
    // 合法边界
    expect(loadConfig({ NODE_ENV: 'test', HTTP_PORT: '1' }).httpPort).toBe(1);
    expect(loadConfig({ NODE_ENV: 'test', HTTP_PORT: '65535' }).httpPort).toBe(65535);
  });

  it('非法枚举 fail-fast（大小写 / 空白均不可绕过）', () => {
    expect(() => loadConfig({ NODE_ENV: 'Development' })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: ' production' })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'verbose' })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(ConfigError);
  });

  it('生产环境 AUTH_SECRET 强制（缺失 / 弱值 / 空白均拒绝）', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/AUTH_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_SECRET: 'short' })).toThrow(/16/);
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_SECRET: '                ' })).toThrow(/16/);
    expect(() =>
      loadConfig({ NODE_ENV: 'production', AUTH_SECRET: 'a-strong-enough-secret!!' }),
    ).not.toThrow();
  });

  it('RTMP_APP 字符集校验（防路径穿越面流入 streamKey）', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', RTMP_APP: '../etc' })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: 'test', RTMP_APP: 'a b' })).toThrow(ConfigError);
    expect(loadConfig({ NODE_ENV: 'test', RTMP_APP: 'live_2' }).rtmpApp).toBe('live_2');
  });
});

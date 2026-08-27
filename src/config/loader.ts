/**
 * 配置加载（ADR-003）：环境变量 + 默认值，启动时校验、非法即 fail-fast。
 * 键名对齐 config/.env.example。
 */

export interface AppConfig {
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly httpPort: number;
  readonly rtmpPort: number;
  readonly rtmpApp: string;
  readonly hlsFragmentSec: number;
  readonly hlsWindowSize: number;
  readonly authSecret: string;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export class ConfigError extends Error {
  constructor(readonly field: string, readonly reason: string) {
    super(`invalid config ${field}: ${reason}`);
    this.name = 'ConfigError';
  }
}

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const NODE_ENVS = new Set(['development', 'production', 'test']);

function readInt(env: NodeJS.ProcessEnv, name: string, def: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  if (!/^\d+$/.test(raw)) throw new ConfigError(name, `expected integer, got "${raw}"`);
  const n = Number(raw);
  if (n < min || n > max) throw new ConfigError(name, `expected ${min}..${max}, got ${n}`);
  return n;
}

function readEnum<T extends string>(env: NodeJS.ProcessEnv, name: string, allowed: ReadonlySet<string>, def: T): T {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  if (!allowed.has(raw)) throw new ConfigError(name, `expected one of [${[...allowed].join(', ')}], got "${raw}"`);
  return raw as T;
}

function readString(env: NodeJS.ProcessEnv, name: string, def: string): string {
  const raw = env[name];
  return raw === undefined || raw === '' ? def : raw;
}

/** 加载配置。
 * NODE_ENV 必填（防生产漏设时静默降级为 development + 弱 secret）；
 * 测试/开发环境允许默认 authSecret；生产环境必须显式提供且非弱值。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = readEnum<AppConfig['nodeEnv']>(env, 'NODE_ENV', NODE_ENVS, 'development');
  if (env['NODE_ENV'] === undefined || env['NODE_ENV'] === '') {
    throw new ConfigError('NODE_ENV', '必须显式设置（development / production / test）');
  }
  const authSecret = readString(env, 'AUTH_SECRET', 'dev-insecure-secret');
  if (nodeEnv === 'production') {
    if (authSecret === 'dev-insecure-secret') {
      throw new ConfigError('AUTH_SECRET', 'production 环境必须显式设置 AUTH_SECRET');
    }
    if (authSecret.trim().length < 16) {
      throw new ConfigError('AUTH_SECRET', '长度不足（trim 后至少 16 字符）');
    }
  }
  const rtmpApp = readString(env, 'RTMP_APP', 'live');
  if (!/^[A-Za-z0-9_-]+$/.test(rtmpApp)) {
    throw new ConfigError('RTMP_APP', `仅允许字母/数字/_/-，得到 "${rtmpApp}"`);
  }
  return {
    nodeEnv,
    httpPort: readInt(env, 'HTTP_PORT', 8000, 1, 65535),
    rtmpPort: readInt(env, 'RTMP_PORT', 1935, 1, 65535),
    rtmpApp: readString(env, 'RTMP_APP', 'live'),
    hlsFragmentSec: readInt(env, 'HLS_FRAGMENT_SEC', 6, 1, 30),
    hlsWindowSize: readInt(env, 'HLS_WINDOW_SIZE', 5, 1, 60),
    authSecret,
    logLevel: readEnum<AppConfig['logLevel']>(env, 'LOG_LEVEL', LOG_LEVELS, 'info'),
  };
}

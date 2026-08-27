/** lib：日志（v1 极简结构化输出；M4 引入正式日志库时替换此实现，接口不变） */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

/** 脱敏：键名命中即遮蔽值；递归处理嵌套对象与数组。注意不匹配裸 "key"（流 key 是观测核心字段） */
const SENSITIVE_PATTERN = /secret|token|password|apikey|auth|bearer|cookie|sign/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sanitize(value: unknown, depth: number): unknown {
  if (depth > 4) return '[deep]';
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_PATTERN.test(k) ? '***' : sanitize(v, depth + 1);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  return value;
}

export function createLogger(level: LogLevel, sink: (line: string) => void = console.log): Logger {
  const write = (lvl: LogLevel, msg: string, extra?: Record<string, unknown>) => {
    if (LEVEL_ORDER[lvl] < LEVEL_ORDER[level]) return;
    let line: string;
    try {
      line = JSON.stringify({
        time: new Date().toISOString(),
        level: lvl,
        msg,
        ...(extra === undefined ? {} : (sanitize(extra, 0) as Record<string, unknown>)),
      });
    } catch {
      // 循环引用 / BigInt 等不可序列化值：降级输出，绝不让日志调用击穿异常处理
      line = JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, extra: '[unserializable]' });
    }
    sink(line);
  };
  return {
    debug: (m, e) => write('debug', m, e),
    info: (m, e) => write('info', m, e),
    warn: (m, e) => write('warn', m, e),
    error: (m, e) => write('error', m, e),
  };
}

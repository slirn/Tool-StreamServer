/**
 * StreamServer 入口：装配与启动（M1 骨架——仅配置 + 日志 + 启动横幅）。
 * 各模块实现随 M2+ 接入，装配顺序遵循 ARCHITECTURE §5 数据流。
 */
import { loadConfig } from './config/loader.js';
import { createLogger } from './lib/logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  logger.info('stream-server starting', {
    nodeEnv: config.nodeEnv,
    httpPort: config.httpPort,
    rtmpPort: config.rtmpPort,
    authSecret: config.authSecret, // logger 内部会脱敏为 ***
  });
  logger.info('modules scheduled: ingress(M2) egress(M2/M3) api(M4)');

  // M2+：在这里装配 ingress / egress / api，并挂到 core 的注册表与事件总线
}

main().catch((err: unknown) => {
  if (err instanceof Error && err.stack) {
    console.error('fatal:', err.stack);
  } else {
    console.error('fatal:', err);
  }
  process.exitCode = 1;
});

/**
 * StreamServer 入口：装配与启动。
 * 装配链（ARCHITECTURE §5）：config → logger → core(registry/bus) → auth → ingress(NMS) → egress(HLS)。
 */
import { loadConfig } from './config/loader.js';
import { createLogger } from './lib/logger.js';
import { MemoryStreamRegistry } from './core/registry.js';
import { NmsIngress } from './ingress/nms-server.js';
import { HlsEgress } from './egress/hls-ffmpeg.js';
import { HmacAuthPolicy } from './auth/policy.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const registry = new MemoryStreamRegistry();
  const auth = new HmacAuthPolicy(config.authSecret);

  const ingress = new NmsIngress({
    ingress: { rtmpPort: config.rtmpPort, app: config.rtmpApp },
    registry,
    bus: registry.events,
    auth,
    httpPort: config.httpPort,
    mediaRoot: config.mediaRoot,
    logger,
  });

  const egress = new HlsEgress({
    bus: registry.events,
    rtmpBaseUrl: `rtmp://127.0.0.1:${config.rtmpPort}`,
    mediaRoot: config.mediaRoot,
    hlsFragmentSec: config.hlsFragmentSec,
    hlsWindowSize: config.hlsWindowSize,
    logger,
  });

  await ingress.start();
  await egress.start();
  logger.info('stream-server started', {
    nodeEnv: config.nodeEnv,
    rtmp: `rtmp://localhost:${config.rtmpPort}/${config.rtmpApp}（推流需签名，见 README）`,
    hls: `http://localhost:${config.httpPort}/hls/${config.rtmpApp}/<key>/index.m3u8`,
    flv: `http://localhost:${config.httpPort}/${config.rtmpApp}/<key>.flv`,
  });

  // 优雅关停：停 egress（ffmpeg/分片）→ 停 ingress（RTMP/HTTP 会话）
  const shutdown = async (signal: string) => {
    logger.info('shutting down', { signal });
    try {
      await egress.stop();
      await ingress.stop();
    } finally {
      process.exitCode = 0;
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  if (err instanceof Error && err.stack) {
    console.error('fatal:', err.stack);
  } else {
    console.error('fatal:', err);
  }
  process.exitCode = 1;
});

/**
 * StreamServer 入口：装配与启动。
 * 装配链（ARCHITECTURE §5）：config → logger → core(registry/bus) → auth → ingress(NMS)
 *                          → egress(HLS/录制) → api(管理接口，能力经注入)。
 */
import { loadConfig } from './config/loader.js';
import { createLogger } from './lib/logger.js';
import { MemoryStreamRegistry } from './core/registry.js';
import { NmsIngress } from './ingress/nms-server.js';
import { HlsEgress } from './egress/hls-ffmpeg.js';
import { FlvRecorder } from './egress/record-ffmpeg.js';
import { HmacAuthPolicy } from './auth/policy.js';
import { createAdminApi, listenAdminApi } from './api/server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const registry = new MemoryStreamRegistry();
  const auth = new HmacAuthPolicy(config.authSecret);
  const rtmpBaseUrl = `rtmp://127.0.0.1:${config.rtmpPort}`;

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
    rtmpBaseUrl,
    mediaRoot: config.mediaRoot,
    hlsFragmentSec: config.hlsFragmentSec,
    hlsWindowSize: config.hlsWindowSize,
    logger,
  });

  const recorder = new FlvRecorder({
    bus: registry.events,
    rtmpBaseUrl,
    recordsRoot: config.recordsRoot,
    logger,
  });

  // 管理 API：能力经注入（api 模块不 import ingress/egress 实现，依赖方向合规）
  const adminApi = createAdminApi({
    adminToken: config.adminToken,
    logger,
    deps: {
      listStreams: () => registry.list().map((s) => ({ key: s.key, startedAt: s.startedAt, publisher: s.publisher })),
      kickStream: (key) => registry.unpublish(key, 'kicked'),
      listRecords: () => recorder.list(),
      startRecord: (key) => recorder.startRecord(key),
      stopRecord: (key) => recorder.stopRecord(key),
      removeRecord: (name) => recorder.remove(name),
    },
  });

  await ingress.start();
  await egress.start();
  recorder.start();
  const apiServer = await listenAdminApi(adminApi.handle, config.apiPort);

  logger.info('stream-server started', {
    nodeEnv: config.nodeEnv,
    rtmp: `rtmp://localhost:${config.rtmpPort}/${config.rtmpApp}（推流需签名，见 README）`,
    hls: `http://localhost:${config.httpPort}/hls/${config.rtmpApp}/<key>/index.m3u8`,
    flv: `http://localhost:${config.httpPort}/${config.rtmpApp}/<key>.flv`,
    api: `http://localhost:${config.apiPort}/healthz`,
    apiMode: config.adminToken === undefined ? 'readonly（未配置 ADMIN_TOKEN）' : 'read-write',
  });

  // 优雅关停：api → egress（ffmpeg/分片）→ 录制 → ingress（RTMP/HTTP 会话）
  const shutdown = async (signal: string) => {
    logger.info('shutting down', { signal });
    try {
      await apiServer.close();
      await egress.stop();
      await recorder.stopAll();
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

/**
 * ingress：Node-Media-Server 适配器（ADR-001 / ADR-004 落地）。
 * 本文件是项目中【唯一】import node-media-server 的地方（架构守护测试固化）。
 * 职责：起 NMS（RTMP+HTTP+HLS 编排）→ 把推流生命周期事件写入 core 注册表。
 * 鉴权：M2 直通放行；M3 在 on_prePublish 接 AuthPolicy。
 */
import NodeMediaServer, { type NodeMediaServerConfig } from 'node-media-server';
import type { Ingress, IngressConfig } from './types.js';
import type { StreamRegistry } from '../core/types.js';
import type { Logger } from '../lib/logger.js';

export interface NmsIngressOptions {
  readonly ingress: IngressConfig;
  readonly registry: StreamRegistry;
  /** NMS http 服务端口（承载 HTTP-FLV + HLS 静态分片） */
  readonly httpPort: number;
  readonly mediaRoot: string;
  readonly logger: Logger;
}

export class NmsIngress implements Ingress {
  private readonly nms: InstanceType<typeof NodeMediaServer>;
  private readonly opts: NmsIngressOptions;
  private running = false;

  constructor(opts: NmsIngressOptions) {
    this.opts = opts;
    const { ingress } = opts;
    const config: NodeMediaServerConfig = {
      rtmp: { port: ingress.rtmpPort, gop_cache: true },
      http: { port: opts.httpPort },
      // HLS 分片经静态路由伺服：GET /hls/<app>/<key>/index.m3u8 → mediaRoot 下同名文件
      static: { router: '/hls', root: opts.mediaRoot },
      auth: {
        play: false,
        publish: false,
        // M2 直通；M3 接 AuthPolicy（返回 false 即拒绝推流）
        on_prePublish: () => true,
        on_prePlay: () => true,
      },
    };
    this.nms = new NodeMediaServer(config);
    this.wireEvents();
  }

  private wireEvents(): void {
    const { registry, logger } = this.opts;
    // NMS v4 实测签名：回调只接收 stream 会话对象
    this.nms.on('postPublish', (stream) => {
      const key = streamPathToKey(stream.streamPath);
      const ok = registry.publish({
        key,
        startedAt: Date.now(),
        publisher: stream.ip ?? 'unknown',
      });
      if (ok) logger.info('stream published', { key, publisher: stream.ip ?? 'unknown' });
      else logger.warn('duplicate publish rejected', { key });
    });
    this.nms.on('donePublish', (stream) => {
      const key = streamPathToKey(stream.streamPath);
      const ok = registry.unpublish(key, 'closed');
      if (ok) logger.info('stream unpublished', { key });
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.nms.run();
    this.running = true;
    this.opts.logger.info('ingress started', {
      rtmpPort: this.opts.ingress.rtmpPort,
      httpPort: this.opts.httpPort,
      mediaRoot: this.opts.mediaRoot,
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.nms.stop();
    this.running = false;
    this.opts.logger.info('ingress stopped');
  }

  /** 兼容 Ingress 接口；NMS 侧 publish 由其自身会话管理，无需外部触发 */
  onPublished(): void {
    /* no-op：事件经 postPublish 自动进入 registry */
  }
}

/** "/live/stream1" -> "live/stream1"（StreamKey 与 ARCHITECTURE §5 约定一致） */
function streamPathToKey(streamPath: string): string {
  return streamPath.replace(/^\//, '');
}

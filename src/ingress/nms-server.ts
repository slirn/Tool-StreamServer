/**
 * ingress：Node-Media-Server 适配器（ADR-001 / ADR-004 落地）。
 * 本文件是项目中【唯一】import node-media-server 的地方（架构守护测试固化）。
 * 职责：起 NMS（RTMP + HTTP-FLV + 静态伺服）→ 把推流生命周期事件写入 core 注册表。
 * 鉴权：M2 直通；M3 走 NMS 的 prePublish/prePlay 事件（v4 无 on_prePublish 钩子，源码核实）。
 */
import NodeMediaServer, { type NodeMediaServerConfig } from 'node-media-server';
import type { Ingress, IngressConfig } from './types.js';
import type { StreamKey, StreamRegistry } from '../core/types.js';
import type { Logger } from '../lib/logger.js';

export interface NmsIngressOptions {
  readonly ingress: IngressConfig;
  readonly registry: StreamRegistry;
  /** NMS http 服务端口（承载 HTTP-FLV + HLS 静态分片） */
  readonly httpPort: number;
  readonly mediaRoot: string;
  readonly logger: Logger;
}

/** 合法 streamKey 形如 "/live/stream1"（两段，各限字母数字下划线连字符） */
const STREAM_PATH_PATTERN = /^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;

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
      // LightweightStore 持久化目录收进 mediaRoot（gitignored，避免污染 CWD）
      store: { path: `${opts.mediaRoot}/../.nms-data` },
    };
    this.nms = new NodeMediaServer(config);
    this.wireEvents();
  }

  private wireEvents(): void {
    const { registry, logger } = this.opts;
    // NMS v4 实测签名：回调只接收 stream 会话对象（单参数）。
    // ⚠️ blocker 修复：NMS 对非法 name 的会话只 end socket，仍会 emit postPublish 且
    // streamPath 为 undefined——必须校验，否则 TypeError 会击穿进程（远程 DoS）。
    this.nms.on('postPublish', (stream) => {
      try {
        const key = this.extractKey(stream?.streamPath);
        if (key === undefined) {
          logger.warn('postPublish with invalid streamPath, ignored', {
            streamPath: typeof stream?.streamPath,
          });
          return;
        }
        const ok = registry.publish({
          key,
          startedAt: Date.now(),
          publisher: stream.ip ?? 'unknown',
        });
        if (ok) logger.info('stream published', { key, publisher: stream.ip ?? 'unknown' });
        else logger.info('stream resumed', { key }); // 30s 宽限期内重连：registry 已续期并发事件
      } catch (err) {
        logger.error('postPublish handler failed', { detail: errorMessage(err) });
      }
    });
    this.nms.on('donePublish', (stream) => {
      try {
        const key = this.extractKey(stream?.streamPath);
        if (key === undefined) return;
        const ok = registry.unpublish(key, 'closed');
        if (ok) logger.info('stream unpublished', { key });
      } catch (err) {
        logger.error('donePublish handler failed', { detail: errorMessage(err) });
      }
    });
  }

  /** 校验并归一化 streamPath；非法返回 undefined（不写注册表） */
  private extractKey(streamPath: unknown): StreamKey | undefined {
    if (typeof streamPath !== 'string' || !STREAM_PATH_PATTERN.test(streamPath)) return undefined;
    return streamPath.replace(/^\//, '');
  }

  async start(): Promise<void> {
    if (this.running) return;
    await this.nms.run();
    this.running = true;
    this.opts.logger.info('ingress started', {
      rtmpPort: this.opts.ingress.rtmpPort,
      httpPort: this.opts.httpPort,
      mediaRoot: this.opts.mediaRoot,
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    try {
      await this.nms.stop();
    } catch (err) {
      this.opts.logger.error('nms stop failed', { detail: errorMessage(err) });
    }
    this.running = false;
    this.opts.logger.info('ingress stopped');
  }

  /** 兼容 Ingress 接口；NMS 侧 publish 由其自身会话管理，无需外部触发 */
  onPublished(): void {
    /* no-op：事件经 postPublish 自动进入 registry */
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

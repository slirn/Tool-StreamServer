/**
 * ingress：Node-Media-Server 适配器（ADR-001 / ADR-004 落地）。
 * 本文件是项目中【唯一】import node-media-server 的地方（架构守护测试固化）。
 * 职责：
 * - 起 NMS（RTMP + HTTP-FLV + 静态伺服）
 * - 推流鉴权门控（M3，ADR-007）：postPublish 时校验 HMAC 签名，失败关闭会话且不注册
 * - 流生命周期事件（publish/unpublish/subscribe/unsubscribe）写入 core
 * - 会话表：为踢流（M4，registry 'kicked' 事件）持有 RTMP 会话引用
 */
import NodeMediaServer, { type NodeMediaServerConfig } from 'node-media-server';
import type { Ingress, IngressConfig } from './types.js';
import type { StreamEventBus, StreamKey, StreamRegistry } from '../core/types.js';
import { STREAM_EVENTS } from '../core/types.js';
import type { AuthPolicy } from '../auth/types.js';
import type { Logger } from '../lib/logger.js';

export interface NmsIngressOptions {
  readonly ingress: IngressConfig;
  readonly registry: StreamRegistry;
  readonly bus: StreamEventBus;
  readonly auth: AuthPolicy;
  /** NMS http 服务端口（承载 HTTP-FLV + HLS 静态分片） */
  readonly httpPort: number;
  readonly mediaRoot: string;
  readonly logger: Logger;
}

/** 合法 streamKey 形如 "/live/stream1"（两段，各限字母数字下划线连字符） */
const STREAM_PATH_PATTERN = /^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;

/** NMS 会话的最小面（BaseSession 的 close + 身份字段） */
interface NmsSession {
  readonly ip?: string;
  readonly streamPath?: string;
  readonly streamQuery?: Readonly<Record<string, string>>;
  close(): void;
}

export class NmsIngress implements Ingress {
  private readonly nms: InstanceType<typeof NodeMediaServer>;
  private readonly opts: NmsIngressOptions;
  /** 推流会话表（踢流用）；宽限期内重连会覆盖同 key 条目 */
  private readonly publishSessions = new Map<StreamKey, NmsSession>();
  private running = false;

  constructor(opts: NmsIngressOptions) {
    this.opts = opts;
    const { ingress } = opts;
    const config: NodeMediaServerConfig = {
      rtmp: { port: ingress.rtmpPort, gop_cache: true },
      http: { port: opts.httpPort },
      // HLS 分片经静态路由伺服：GET /hls/<app>/<key>/index.m3u8 → mediaRoot 下同名文件
      static: { router: '/hls', root: opts.mediaRoot },
      // LightweightStore 持久化目录收进受管目录（gitignored，避免污染 CWD）
      store: { path: `${opts.mediaRoot}/../.nms-data` },
    };
    this.nms = new NodeMediaServer(config);
    this.wireEvents();
  }

  private wireEvents(): void {
    const { registry, bus, auth, logger } = this.opts;
    // NMS v4 实测签名：回调只接收 stream 会话对象（单参数）。
    // ⚠️ 非法 name 的会话只 end socket 仍会 emit postPublish 且 streamPath 为
    // undefined——必须校验，否则 TypeError 会击穿进程（远程 DoS，M2 review blocker）。
    this.nms.on('postPublish', (raw) => {
      try {
        const stream = raw as unknown as NmsSession;
        const key = this.extractKey(stream?.streamPath);
        if (key === undefined) {
          logger.warn('postPublish with invalid streamPath, ignored', {
            streamPath: typeof stream?.streamPath,
          });
          return;
        }
        // M3 鉴权门控（ADR-007）：NMS 内置仅支持 MD5 签名，此处按已批准方案自校验 HMAC-SHA256，
        // 失败即关闭会话且不注册（流不会进入 egress/registry，无任何产出）
        void auth
          .verifyPublish({ key, query: stream.streamQuery ?? {} })
          .then((result) => {
            if (!result.ok) {
              logger.warn('publish rejected: auth failed', { key, reason: result.reason });
              stream.close();
              return;
            }
            this.publishSessions.set(key, stream);
            const ok = registry.publish({
              key,
              startedAt: Date.now(),
              publisher: stream.ip ?? 'unknown',
            });
            if (ok) logger.info('stream published', { key, publisher: stream.ip ?? 'unknown' });
            else logger.info('stream resumed', { key }); // 30s 宽限期内重连：registry 已续期并发事件
          })
          .catch((err) => logger.error('auth verify failed', { key, detail: errorMessage(err) }));
      } catch (err) {
        logger.error('postPublish handler failed', { detail: errorMessage(err) });
      }
    });
    this.nms.on('donePublish', (raw) => {
      try {
        const stream = raw as unknown as NmsSession;
        const key = this.extractKey(stream?.streamPath);
        if (key === undefined) return;
        this.publishSessions.delete(key);
        const ok = registry.unpublish(key, 'closed');
        if (ok) logger.info('stream unpublished', { key });
      } catch (err) {
        logger.error('donePublish handler failed', { detail: errorMessage(err) });
      }
    });
    // 拉流生命周期（观测用；过滤本机 egress ffmpeg 产生的回环连接噪音）
    this.nms.on('postPlay', (raw) => {
      const stream = raw as unknown as NmsSession;
      if (isLoopback(stream?.ip)) return;
      const key = this.extractKey(stream?.streamPath);
      if (key !== undefined) bus.emitStream({ type: 'subscribe', key, subscriber: stream.ip ?? 'unknown' });
    });
    this.nms.on('donePlay', (raw) => {
      const stream = raw as unknown as NmsSession;
      if (isLoopback(stream?.ip)) return;
      const key = this.extractKey(stream?.streamPath);
      if (key !== undefined) bus.emitStream({ type: 'unsubscribe', key, subscriber: stream.ip ?? 'unknown' });
    });
    // 踢流（M4 经 registry.unpublish(key,'kicked') 触发）：关闭对应 RTMP 推流会话
    bus.on(STREAM_EVENTS.unpublish, (e) => {
      if (e.type !== 'unpublish' || e.reason !== 'kicked') return;
      const session = this.publishSessions.get(e.key);
      if (session) {
        session.close();
        this.publishSessions.delete(e.key);
        logger.info('stream kicked', { key: e.key });
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
    // 关闭所有推流会话（触发 donePublish → registry 清理）
    for (const session of this.publishSessions.values()) {
      try {
        session.close();
      } catch {
        /* 尽力而为 */
      }
    }
    this.publishSessions.clear();
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

function isLoopback(ip: string | undefined): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

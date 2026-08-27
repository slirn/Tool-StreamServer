/**
 * node-media-server@4.x 的最小类型声明（官方 @types 停在 2.3.7，已脱节）。
 * 只声明本项目实际使用的方法面；与实际 API 的偏差由 e2e 集成测试兜底校验。
 */
declare module 'node-media-server' {
  interface NodeMediaServerSessionBase {
    /** streamPath 形如 "/live/streamKey" */
    streamPath: string;
    /** 推流端 remote address */
    ip?: string;
    isLocal?: boolean;
  }

  interface NodeMediaServerPublishSession extends NodeMediaServerSessionBase {
    publishEventMarker?: never; // 占位：v4 publish 会话（避免空接口 lint；字段不使用）
  }

  type NodeMediaServerUnpublishSession = NodeMediaServerSessionBase;

  export interface NodeMediaServerConfig {
    rtmp?: {
      port?: number;
      chunk_stream?: number;
      gop_cache?: boolean;
      ping?: number;
      ping_timeout?: number;
    };
    http?: {
      port?: number;
      allow_origin?: string;
      mediaroot?: string;
    };
    /** 静态文件伺服：router 前缀下的请求映射到 root 目录（HLS 分片出口） */
    static?: {
      router?: string;
      root?: string;
    };
    relay?: Record<string, unknown>;
    auth?: {
      play?: boolean;
      publish?: boolean;
      secret?: string;
      /** 鉴权钩子：返回 false 拒绝 */
      on_prePublish?: (id: string, streamPath: string, query: object) => boolean;
      on_prePlay?: (id: string, streamPath: string, query: object) => boolean;
    };
  }

  export default class NodeMediaServer {
    constructor(config: NodeMediaServerConfig);
    /** v4 实测：事件回调只传 stream 会话对象（无独立 id 参数） */
    on(event: 'postPublish', listener: (stream: NodeMediaServerPublishSession) => void): this;
    on(event: 'donePublish', listener: (stream: NodeMediaServerUnpublishSession) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    run(): void;
    stop(): void;
  }
}

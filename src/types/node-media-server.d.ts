/**
 * node-media-server@4.x 的最小类型声明（官方 @types 停在 2.3.7，已脱节）。
 * 只声明本项目实际使用的方法面；与实际 API 的偏差由 e2e 集成测试兜底校验。
 * ⚠️ 源码核实（4.3.2）：鉴权无 on_prePublish/on_prePlay 配置钩子——
 * v4 鉴权走 auth.publish + verifyAuth 签名，或 prePublish/prePlay 事件（M3 采用后者）。
 */
declare module 'node-media-server' {
  interface NodeMediaServerSessionBase {
    /** streamPath 形如 "/live/streamKey"；⚠️ 非法 name 的会话此字段可能为 undefined */
    streamPath?: string;
    /** 推流端 remote address */
    ip?: string;
    isLocal?: boolean;
  }

  type NodeMediaServerPublishSession = NodeMediaServerSessionBase;

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
    };
    /** 静态文件伺服：router 前缀下的请求映射到 root 目录（HLS 分片出口） */
    static?: {
      router?: string;
      root?: string;
    };
    /** LightweightStore 持久化目录（默认 ./data，建议显式指定到受管目录） */
    store?: {
      path?: string;
      flushInterval?: number;
      maxOps?: number;
      pretty?: boolean;
      durability?: string;
    };
    auth?: {
      play?: boolean;
      publish?: boolean;
      secret?: string;
    };
  }

  export default class NodeMediaServer {
    constructor(config: NodeMediaServerConfig);
    /** v4 实测：事件回调只传 stream 会话对象（无独立 id 参数） */
    on(event: 'postPublish', listener: (stream: NodeMediaServerPublishSession) => void): this;
    on(event: 'donePublish', listener: (stream: NodeMediaServerPublishSession) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    /** v4 源码：async run() / stop()（返回 Promise） */
    run(): Promise<void>;
    stop(): Promise<void>;
  }
}

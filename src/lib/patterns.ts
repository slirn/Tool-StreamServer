/** lib：共享的输入白名单（单一来源，防各模块漂移） */

/** 流 key：段间以 / 分隔，每段限字母数字下划线连字符 */
export const KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

/** 录像文件名：<key 段以 ~ 连接>_<yyyyMMdd-HHmmss>.flv */
export const RECORD_NAME_PATTERN = /^[A-Za-z0-9_-]+(~[A-Za-z0-9_-]+)*_\d{8}-\d{6}\.flv$/;

/** 剥离 ip:port 的端口部分（NMS session.ip 形如 "127.0.0.1:54321"） */
export function addressOf(ipWithPort: string | undefined): string {
  return (ipWithPort ?? '').replace(/:\d+$/, '');
}

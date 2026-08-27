# M4 · 录制、管理 API 与观测 · Plan

- 状态：**已批准**（2026-08-27，用户"全部按推荐"）
- 分支：feature/m4-record-api

## 1. 目标

FLV 录制（API 触发）、管理 API 最小集（token 认证）、健康检查；CHANGELOG 定稿 + tag v0.1.0。

## 2. 已批准决策

| 决策 | 内容 |
| --- | --- |
| 录制格式 | FLV 直存（copy 零转码） |
| 录制触发 | 管理 API 手动开停 |
| API 端点 | `GET /api/v1/streams`、`DELETE /api/v1/streams/{key}`（踢流）、`GET/POST /api/v1/records`、`DELETE /api/v1/records/{name}`、`GET /healthz` |
| 认证 | `x-admin-token` 头比对 ADMIN_TOKEN；未配置时写操作拒绝（只读模式，错误码 40301） |
| 端口 | **独立 API_PORT（默认 8001）**——与"共用 8000"决策偏差：NMS 的 express 无法被第三方挂载，共用需违反架构依赖方向；ARCHITECTURE §6 本就倾向分离 |
| 观测 | 结构化日志 + /healthz（v1 不引 Prometheus） |
| 录像清理 | 手动删（API） |
| 收尾 | tag v0.1.0；捎带修复 M2 遗留 minor（e2e stderr 转储、ENDLIST 优雅写入） |

## 3. 方案

```
src/egress/record-ffmpeg.ts   录制：ffmpeg -i rtmp://... -c copy -f flv（复用 hls-ffmpeg 的
                              spawn 管理模式：并发上限/句柄清理/会话跟踪）
src/api/server.ts             node:http 极简路由（不引 express），统一响应包与错误码
                              按 team-api-design（40401 流不存在 / 40901 已在录 / 40301 只读）
src/api/handlers.ts           各端点实现，只经 core/egress 公开接口
ingress                        踢流：core 'kicked' 事件 → 关闭对应 NMS 会话
config                         +API_PORT +ADMIN_TOKEN +RECORDS_ROOT
```

依赖方向：api → core/lib（踢流经事件，录制经 egress 公开接口——由 index 装配注入回调，不直接 import egress 实现类）。

## 4. 测试计划

- 单元：录制文件命名（key+时间戳、路径安全）、token 认证逻辑
- 契约/集成：起真实服务 → 各端点状态码与响应包结构、错误码
- e2e：推流 → 录制开 → 文件增长 → 录制停 → 踢流 → 推流端断开且 registry 清空

## 5. 风险

- 录制与 HLS 并发时同流两 ffmpeg 拉同一 RTMP——NMS 多播放者能力已验证（M2 debug 场景）
- node:http 手写路由的输入校验需仔细（路径参数白名单复用 KEY_PATTERN）

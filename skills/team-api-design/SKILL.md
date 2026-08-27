---
name: team-api-design
version: 1.0.0
description: "StreamServer 团队 API 设计规范：接口命名、统一响应包、错误码、版本策略。当 agent 要设计或评审 REST 管理接口、定义路由、错误码或 API 契约时必须调用本 skill。触发词：接口设计、API 设计、REST、路由、错误码、接口规范、API 契约。"
---

# team-api-design：API 设计规范

适用于 `api` 模块（REST 管理接口：查询在线流、踢流等）。设计或评审接口时逐条对照。

## 1. 命名规范

- 路径用**复数名词 + kebab-case**：`/api/v1/streams`、`/api/v1/streams/{streamKey}/sessions`
- 资源操作用 HTTP 动词表达，不在路径里写动词：`DELETE /api/v1/streams/{streamKey}`（踢流）
- 路径参数用 camelCase；查询参数同（`?sortBy=startTime`）
- 布尔查询参数用 `true/false`

## 2. 方法语义

| 方法 | 语义 | 幂等 |
| --- | --- | --- |
| GET | 查询，无副作用 | 是 |
| POST | 创建 / 触发动作 | 否 |
| DELETE | 删除 / 踢流 | 是 |
| PATCH | 局部更新 | 否 |

## 3. 统一响应包

成功：

```json
{ "code": 0, "message": "ok", "data": { } }
```

失败：

```json
{ "code": 40401, "message": "stream not found: live/stream1", "data": null }
```

- 分页：`data` 为 `{ "items": [...], "total": 123, "page": 1, "pageSize": 20 }`

## 4. 错误码（五位：HTTP 码 × 10 + 序号）

| 区间 | 含义 | 示例 |
| --- | --- | --- |
| 400xx | 请求/参数错误 | 40001 缺少必填参数 |
| 401xx | 未认证 | 40101 admin token 无效 |
| 403xx | 无权限 | 40301 只读模式拒绝写操作 |
| 404xx | 资源不存在 | 40401 stream 不存在 |
| 409xx | 冲突 | 40901 streamKey 已在被推流 |
| 500xx | 服务端内部错误 | 50001 未知错误 |

- 新错误码先登记到本表再使用；`message` 必须人类可读且包含定位信息（如 streamKey）
- 错误响应的 HTTP 状态码与错误码前三位一致

## 5. 版本策略

- 路径版本：`/api/v1/...`；破坏性变更升 `v2`，旧版本至少保留 2 个里程碑
- 管理接口默认要求认证（token 从配置读取），除 `/healthz`（健康检查，无副作用）

## 6. 契约与测试

- 每个接口定义请求 / 响应的 TypeScript 类型（zod 或等价 schema 校验）
- 契约测试：Vitest 对每个路由断言 状态码 + 响应包结构 + 错误码
- 接口变更必须同步 ARCHITECTURE 与 CHANGELOG

## 评审要点（与 team-code-review 衔接）

- 是否遵循命名 / 方法语义？错误码是否登记？响应用了统一包？
- 是否需要认证？输入校验在哪一层做（入口处，不散落在业务里）？

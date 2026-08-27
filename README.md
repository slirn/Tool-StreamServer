# StreamServer

流媒体服务端应用 —— 基于 **Node.js + TypeScript** 的直播媒体服务。v1 覆盖经典直播链路：**RTMP 推流 → 流管理/转发表 → HLS / HTTP-FLV 拉流**，并在此基础上提供推流鉴权、录制等业务能力。

> **当前状态：v0.1.0 全部里程碑（M1–M4）已完成。** 完整链路可用：RTMP 签名推流 → HLS/HTTP-FLV 拉流 → FLV 录制 → 管理 API（踢流/录制/健康检查）。47 个测试全绿（含 5 场景 e2e）。开发前请先阅读 [ARCHITECTURE.md](./ARCHITECTURE.md) 与 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 特性（v1 范围）

- RTMP 推流接入（OBS / ffmpeg 等推流端）
- HLS（TS 切片 + m3u8）与 HTTP-FLV 拉流
- 流生命周期管理：发布 / 订阅 / 断开事件
- 推流鉴权（URL 签名，可插拔的鉴权钩子）
- 结构化日志与健康检查

> 非目标：v1 不包含 WebRTC（SFU）、转码、DRM、多节点集群。详见 [ARCHITECTURE.md](./ARCHITECTURE.md#8-非目标v1-明确不做)。

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js >= 20.19 | 本机 v24.19.0（nvm 管理） |
| 语言 | TypeScript 5.x | 严格模式 |
| 包管理 | npm | 本机未启用 corepack / pnpm |
| 媒体核心 | Node-Media-Server | RTMP / HTTP-FLV / HLS 封装（默认决策，见 ADR-001） |
| 测试 | Vitest | 单元 + 集成 |
| Lint / Format | ESLint 9 + Prettier 3 | 见 CONTRIBUTING |
| 提交规范 | commitlint（conventional） | 见 CONTRIBUTING |

## 快速开始

环境要求：Node.js >= 20.19。本机 node 已就绪，npm 位于 `D:\GreenApps\nvm\nodejs\npm.cmd`（不在 PATH 时用全路径调用）。

```bash
# 1. 安装依赖（首次；prepare 脚本会自动接线 husky 钩子）
npm install

# 2. 同步团队 skill 到全局（首次提交前必做——pre-commit 会校验一致性）
npm run skills:sync

# 3. 启动开发服务（tsx watch，HTTP 端口 8000）
npm run dev

# 4. 测试 / Lint / 格式化
npm test
npm run lint
npm run format
```

推流与拉流示例（**M3 起推流必须带签名**）：

```bash
# 1. 生成带签名的推流 URL（默认 600s 有效，secret 取 AUTH_SECRET）
node scripts/sign-url.mjs /live/stream1 600
# 输出：rtmp://localhost:1935/live/stream1?expire=1780000000&sign=<hmac-sha256>

# 2. 推流（关键帧间隔建议 2s，HLS 切片依赖关键帧）
ffmpeg -re -i input.mp4 -c copy -g 60 -f flv "rtmp://localhost:1935/live/stream1?expire=...&sign=..."

# 拉流
# HLS:       http://localhost:8000/hls/live/stream1/index.m3u8
# HTTP-FLV:  http://localhost:8000/live/stream1.flv

# 管理 API（默认 8001，写操作需 x-admin-token）
curl http://localhost:8001/healthz
curl http://localhost:8001/api/v1/streams
curl -X DELETE -H "x-admin-token: <ADMIN_TOKEN>" http://localhost:8001/api/v1/streams/live%2Fstream1
```

签名规则：`sign = HMAC-SHA256(AUTH_SECRET, "<streamPath>-<expire>")`，`expire` 为 Unix 秒；过期/缺失/篡改的推流会被直接断开。

> 端口等配置在 `config/` 下，v1 以环境变量 + 配置文件驱动（见 ARCHITECTURE §6）。

## 目录结构（规划）

```
StreamServer/
├── src/
│   ├── index.ts            # 入口：装配与启动
│   ├── config/             # 配置加载与校验
│   ├── ingress/            # 推流接入（RTMP 监听、鉴权钩子）
│   ├── core/               # 流管理、转发表、事件总线
│   ├── egress/             # 拉流出口（HLS / HTTP-FLV）
│   ├── api/                # REST 管理接口
│   ├── auth/               # 鉴权
│   ├── lib/                # 日志、错误、工具
│   └── __tests__/          # 测试
├── docs/                   # 规范与设计文档
├── skills/                 # 团队 Skill（must-read / commit / code-review / api-design）
├── config/                 # 环境配置示例
├── README.md
├── ARCHITECTURE.md
├── CONTRIBUTING.md
└── package.json
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发模式（热重载） |
| `npm run build` | 编译到 `dist/` |
| `npm start` | 运行编译产物 |
| `npm test` | 全量测试 |
| `npm run lint` / `lint:fix` | 静态检查 / 自动修复 |
| `npm run format` / `format:check` | 格式化 / 校验 |
| `npx commitlint --from HEAD~1` | 校验最近一次提交 |

## 文档索引

- [ARCHITECTURE.md](./ARCHITECTURE.md) —— 模块划分、依赖方向、关键设计决策（ADR）
- [CONTRIBUTING.md](./CONTRIBUTING.md) —— 分支策略、提交规范、代码审查、DoD
- [docs/DSH-WORKFLOW.md](./docs/DSH-WORKFLOW.md) —— DSH agent 协作流程与纪律
- [docs/PLAN-TEMPLATE.md](./docs/PLAN-TEMPLATE.md) —— Plan Mode 输出模板（先设计后编码）
- [CHANGELOG.md](./CHANGELOG.md) —— 变更日志

## 路线图

- [x] M1：工程骨架（规范落地 + 依赖安装 + CI 流水线）——已完成：src 分层骨架 + 配置加载 + 日志脱敏 + 架构守护测试 + husky 双钩子
- [x] M2：RTMP 推流接入与基础 HLS 拉流——已完成：NMS 4.3.2 适配 + egress ffmpeg 切片（ADR-006）+ e2e 集成测试
- [x] M3：HTTP-FLV、流生命周期事件、鉴权——已完成：HMAC 推流鉴权（ADR-007）、流事件、踢流会话管理
- [x] M4：录制、管理 API、观测——已完成：FLV 录制、管理 API 最小集（ADR-008）、健康检查

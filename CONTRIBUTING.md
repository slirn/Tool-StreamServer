# 贡献指南（CONTRIBUTING）

本文档定义 StreamServer 的开发流程、提交规范、代码审查标准与 **DoD（完成定义）**。所有协作者（人类或 DSH agent）动手前必须通读本文档，并遵守 [docs/DSH-WORKFLOW.md](./docs/DSH-WORKFLOW.md) 的协作纪律。

## 1. 必读清单（改代码前）

1. [README.md](./README.md) —— 项目是什么、怎么跑、怎么测
2. [ARCHITECTURE.md](./ARCHITECTURE.md) —— 模块边界与依赖方向（**不读不动手**）
3. 本文档 —— 流程与 DoD

## 2. 环境准备

- Node.js >= 20.19；包管理统一用 **npm**（`package-lock.json` 必须提交）
- 首次：`npm install`；`npx husky init`（安装 commit-msg 钩子）
- CI 至少执行：`npm run lint` → `npm test` → `npm run build`

## 3. 分支策略（Trunk-based 轻量版）

- 常驻分支：`main`（始终可发布；仅接受 PR 合入，禁止直接 push）
- 功能分支：`feature/<短描述>`（如 `feature/hls-slicer`）
- 修复分支：`fix/<短描述>`；纯文档：`docs/<短描述>`
- 分支生命周期：短小（一般 < 3 个工作日），完成后立即合入并删除
- 合入方式：PR + 至少 1 人（或 1 个 review 子代理）通过

## 4. 提交规范（Conventional Commits）

格式：`<type>(<scope>): <subject>`，subject 小写开头、不超过 72 字符。

| type | 含义 |
| --- | --- |
| feat | 新功能 |
| fix | 修复 |
| docs | 仅文档 |
| style | 格式（不影响逻辑） |
| refactor | 重构（不改变行为） |
| perf | 性能 |
| test | 测试 |
| build | 构建 / 依赖 |
| ci | CI 配置 |
| chore | 杂项 |
| revert | 回滚 |

scope（模块）：`ingress` / `core` / `egress` / `api` / `auth` / `config` / `deps` / `docs` / `infra` / `ci`（无 scope 可省略）。

示例：

```
feat(egress): 新增 HLS 分片清理任务
fix(ingress): 推流断开时未触发 onStreamClose
docs: 补充快速开始示例
```

校验：commitlint（husky 钩子）+ CI 双保险。破坏性变更用 `!`（如 `feat(api)!: ...`）。

## 5. 代码风格

- ESLint 9（flat config）+ Prettier 3 强制执行；`npm run lint` 零告警才算过
- TypeScript 严格模式；禁止 `any`（确需时注释说明并申请豁免）
- 类型导入一律 `import type { ... }`

## 6. 测试要求

- 新增 / 修改逻辑必须伴随测试：纯逻辑 → 单元测试；跨模块 → 集成测试
- 修复 Bug 的先决动作：**先写失败测试（复现）再修复**
- `npm test` 全绿 + `npm run lint` 干净，才算完成

## 7. 代码审查清单（Review Checklist）

审查时逐项确认（可用子代理并行按模块审查，输出：严重级别 + 位置 + 建议）：

- [ ] 正确性：边界条件、空值、超时、并发（同一 streamKey 重复推流等）
- [ ] 错误处理：异常路径有日志、可恢复、不吞错
- [ ] 安全：鉴权是否可绕过、日志是否泄露密钥、输入是否有校验
- [ ] 性能：热点路径（每帧回调）无阻塞、无泄漏
- [ ] 依赖方向：是否违反 [ARCHITECTURE.md](./ARCHITECTURE.md#4-模块划分与依赖方向) 的模块边界
- [ ] 测试：用例是否覆盖上述场景
- [ ] 规范：commit message、lint、文档是否同步更新

## 8. DoD（完成定义）

一个任务只有**全部满足**才算完成，agent 必须逐项在 todo 中勾选，不得"感觉写完了就停"：

- [ ] 代码实现完成，`npm run lint` 零告警
- [ ] 相关测试已写并通过，`npm test` 全绿
- [ ] `npm run build` 通过
- [ ] README / ARCHITECTURE 相关章节已同步（行为或配置有变时）
- [ ] 提交符合 Conventional Commits；PR 描述含**变更文件清单**
- [ ] （有行为变更时）按 §7 审查清单过一遍

## 9. DSH 协作纪律（agent 必读）

- 每个任务开工前：先读 §1 规范文档，再进 **Plan 模式**按 [docs/PLAN-TEMPLATE.md](./docs/PLAN-TEMPLATE.md) 产出方案 → 人工确认 → todo 分解
- 长命令（build / test / 打包）用**后台任务**，不空等
- 互不依赖的任务用**并行子代理**；跨大量文件的 fan-out 用 **workflow**
- 文件操作默认限制在 workspace，不越权写项目外文件
- 收尾必须按 §8 DoD 逐项勾选，并给出变更文件清单

## 10. 团队 Skill（规范的可执行化）

以下 skill 源码在项目 `skills/` 目录（入库、可版本化），agent 实际从用户主目录加载（`~\.claude\skills`、`~\.agents\skills`）。修改 `skills/` 源码后必须重新同步安装：`npm run skills:sync`（CI 或自查用 `npm run skills:check`）：

| Skill | 用途 | 触发时机 |
| --- | --- | --- |
| `team-must-read` | 开工前必读规范清单 | 任何开发任务开始前 |
| `team-commit` | Conventional Commits 强制 | 执行 git commit 时 |
| `team-code-review` | 六维审查清单 + 结构化报告 | 审查代码 / PR 时 |
| `team-api-design` | 接口命名 / 错误码 / 版本规范 | 设计或评审 API 时 |

### skill 校验的分工（已定案）

| 检查 | 位置 | 拦截目标 |
| --- | --- | --- |
| `npm run skills:ci` | CI（`ci.yml`，checkout 后第一步） | 结构非法：缺 SKILL.md / front-matter 缺字段 / name 与目录不一致 |
| `npm run skills:check` | **git pre-commit 钩子**（M1 husky 接线时挂上） | 改了 `skills/` 源码忘跑 `skills:sync`（此状态只存在于开发机，CI 原理上检测不到） |
| `npm run skills:sync` | 改 skill 源码后的收尾动作（agent 自动执行） | — |

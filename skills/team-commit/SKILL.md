---
name: team-commit
version: 1.0.0
description: "StreamServer 团队提交规范：强制 Conventional Commits 格式。当 agent 要执行 git commit、撰写或检查提交信息时必须调用本 skill，按 type/scope 规则生成合规 message，并用 commitlint 校验。触发词：提交、commit、git commit、提交信息、commit message。"
---

# team-commit：提交规范（Conventional Commits）

**MANDATORY** —— 在 StreamServer 项目里执行 `git commit` 前，提交信息必须符合本规范，且通过项目根 `commitlint.config.cjs` 的校验。

## 格式

```
<type>(<scope>)!: <subject>

<body 可选>

<footer 可选，如 BREAKING CHANGE: ...>
```

- header 总长 ≤ 72 字符；subject 小写开头、祈使语气、不加句号
- 破坏性变更加 `!`（如 `feat(api)!: ...`）并在 footer 写明迁移方式

## type 白名单（11 个）

| type | 用途 |
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

## scope 白名单（对应 ARCHITECTURE 模块）

`ingress` / `core` / `egress` / `api` / `auth` / `config` / `deps` / `docs` / `infra` / `ci`
（无合适 scope 可省略，但优先带上）

## 示例

```
feat(egress): 新增 HLS 分片清理任务
fix(ingress): 推流断开时未触发 onStreamClose
docs: 补充快速开始示例
refactor(core)!: 流注册表改为事件驱动，onPublish 回调签名变更
```

## 工作流（agent 执行）

1. `git status` + `git diff --staged` 确认改动内容与模块归属
2. 按上述规则生成 message（多个不相关改动 → 拆成多个提交）
3. 校验：`npx commitlint --from HEAD~1 --to HEAD`（提交后）
4. 一个提交只做一件事；禁止 "update stuff" / "修改bug" 这类无效信息

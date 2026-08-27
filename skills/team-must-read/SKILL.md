---
name: team-must-read
version: 1.0.0
description: "开始任何开发任务前的必读规范（StreamServer 团队）。当 agent 要在本项目写代码、修 Bug、重构或评审前必须先调用本 skill，按清单读取项目规范文档（README / ARCHITECTURE / CONTRIBUTING / docs），把『先理解架构再动手』变成强制流程。触发词：开始任务、动手前、必读规范、新任务。"
---

# team-must-read：开始任务前必读规范

**MANDATORY** —— 在 StreamServer 项目（当前 workspace 根目录）开始任何开发任务（新功能 / Bug 修复 / 重构 / 评审）之前，必须先完成本清单，未完成不得写任何代码。文档均在**项目根目录**下。

## 执行清单（按顺序，用 read 工具逐个读取）

1. **读 `README.md`**：确认项目是什么、怎么跑、怎么测。
2. **读 `ARCHITECTURE.md`**：重点记住——
   - 模块划分：`ingress` / `core` / `egress` / `api` / `auth` / `lib`
   - 依赖方向铁律：`core` 不得 import `ingress/egress/api`；`ingress` 与 `egress` 互不引用，一切经由 `core`；第三方库不得泄漏进 `core`
3. **读 `CONTRIBUTING.md`**：分支策略、提交规范、Review 清单（§7）、DoD（§8）。
4. **读 `docs/DSH-WORKFLOW.md`**：任务流转姿势、并行 / 后台 / 权限纪律。
5. 功能开发任务：按 `docs/PLAN-TEMPLATE.md` 先出方案，**人工确认后才编码**。

## 开工确认（输出给用户）

完成阅读后，用 2~4 行汇报：

```
[必读规范已读]
- 任务类型：feat / fix / refactor / review
- 涉及模块（按 ARCHITECTURE 划分）：…
- 关键约束：依赖方向 = …；DoD = CONTRIBUTING §8
- 方案：已进 Plan 模式 / 直接执行（小改动，说明理由）
```

## 禁止事项

- ❌ 未读规范就改代码
- ❌ 违反依赖方向"先斩后奏"（发现必须违反时，先停下来说明并征得同意）
- ❌ 跳过 Plan 模式直接做功能开发

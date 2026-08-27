# Changelog

本项目的显著变更记录。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- M1 工程骨架：`src/` 分层接口骨架（core / ingress / egress / api / auth / lib），核心抽象 `StreamRegistry` / `StreamEvent`。
- 配置加载（ADR-003）：env + 默认值 + 启动校验，生产环境强制 `AUTH_SECRET`。
- 结构化日志：级别过滤 + 敏感字段脱敏。
- 架构守护测试：静态 import 分析强制依赖方向（core 不依赖上层、ingress↔egress 互不引用）。
- husky 双钩子：commit-msg（commitlint）+ pre-commit（skills:check 一致性拦截）。
- 项目规范骨架：README / ARCHITECTURE / CONTRIBUTING / docs（DSH 协作规范、Plan 模板）。
- 工程配置基线：ESLint 9（flat）+ Prettier 3 + commitlint + editorconfig + tsconfig（严格模式）。
- CI 流水线（skills 结构校验 → lint → test → build → commitlint）。
- 环境变量示例 `config/.env.example`；团队 skill 同步脚本 `scripts/sync-skills.mjs`。

# Agent Note: 内置 skill 全局化

[English](2026-08-19-built-in-skills-globalized.md) | 中文

Status: implemented

## Problem

仓库在 `skills/` 下内置了六个文档/评审类 skill（`prose-standard`、`trim-cot-leakage`、`translate-docs`、`archive-agent-notes`、`code-review`、`doc-standards`），经 `dota2_skill` 暴露给 MCP 客户端。作者在全局 skill 目录（`~/.agents/skills/`）维护着这些 skill 的通用版本；仓库内副本与之重复，且已与全局版本漂移。

## Decision

`prose-standard`、`trim-cot-leakage`、`translate-docs`、`archive-agent-notes`、`code-review` 不再内置。它们的全局版本为准，仓库内引用均为裸文本（"the global prose-standard skill"）。`doc-standards` 保持内置，因为它是 dota2-mcp 专属、没有全局对应。`dota2-game-phases` 与 `dota2-runtime-dev` 保持内置，因为 `scripts/test-mcp-offline.mjs` 与 `src/index.ts` 的卡相位指引钉住了它们；全局 `dota2-custom-game-dev` 覆盖 addon 开发，但不覆盖 MCP 相位推进 SOP 或运行时热重载模型。

## Alternatives considered

- **六个全部保持内置。** 否决：重复全局维护，且副本已漂移——例如全局 `translate-docs` 视两种语言同权，而本仓库的配对契约是英文 canonical。
- **`doc-standards` 一并删除。** 否决：它是唯一 dota2-mcp 专属的文档 skill，没有全局对应。
- **把两个 Dota skill 并入全局 `dota2-custom-game-dev`。** 否决：相位 SOP 与运行时模型经 `dota2_skill` 工具被任何 MCP 客户端消费，且离线冒烟测试钉住它们。

## Consequences

- `dota2_skill` 暴露三个 skill，而非八个。
- 对全局 skill 的裸文本引用存在于 `docs/AGENTS.md`、`skills/doc-standards/SKILL.md` 与 `.agents/notes/README.md`；全局目录位置在 `AGENTS.md` 陈述一次。
- 全局 skill 与本仓库契约之间未来的漂移（例如翻译权威）由读者自行裁决，而非由内置副本兜底。

# Agent Note: 让 AGENTS.md 的 TODO 段与路线图 spec 及已发布的 1.6.0 对齐

[English](2026-08-25-roadmap-todo-reconciliation.md) | 中文

Status: proposed

## Problem

AGENTS.md 的“TODO — Roadmap”（:336-343）既与新路线图 spec（docs/superpowers/specs/2026-08-05-roadmap-design.md）矛盾，又与已发布的现实矛盾：BuildTools 仍然列出 spec 已“缩水”的完整计划（:16）；“[ ] Claude MCP configuration”已经完成（README 的按客户端配置）；FileOps/AssetInspector 被标记为 [x] 已落地，这晚于 spec 的“砍 / 保留（2.0）”裁决；spec 自己的 1.6 行规划了 dota_map_error + 验证清理，而 1.6.0 实际发布的是 asset 工具链（wayfinder 地图 #4）。spec 要求“AGENTS.md 的 TODO 段收敛为一行指针「开发路线见 docs/ROADMAP.md」”（:5, :72），而 docs/ROADMAP.md 尚不存在。

## Proposal

- 一旦用户刷新路线图 spec 以匹配已发布的 1.6.0（它的 1.6 行和 FileOps/AssetInspector 裁决都是 wayfinder 之前的），就把 AGENTS.md 的 TODO 第 336-343 行折进 spec 要求的那一行指向 docs/ROADMAP.md 的指针，并按 spec 的“版本总览”创建 docs/ROADMAP.md（按 docs/ 配对契约做双语）。
- 立即可安全执行的子步骤：删除“[ ] Claude MCP configuration”那一行（README 已经记录了所有客户端）。

## Alternatives considered

- **就地更新 AGENTS.md 的 TODO 而不建路线图文档。** 否决：spec 拥有收敛决策；第二份手工维护的清单会重新制造漂移。
- **在路线图落地前什么都不做。** 对 Claude MCP configuration 那一行否决：它今天就已经不成立了。

## Acceptance criteria

- AGENTS.md 的 TODO 段只有一行指针；docs/ROADMAP.md 存在；没有任何 TODO 行重复已发布功能或 spec 的裁决。
- 路线图 spec 的 1.6 行反映已发布的现实（或把 spec 标记为历史）。

## Risks

- 路线图 spec 是用户的活跃设计文档；对它的改动需要用户拍板。本 note 只提议在他们刷新它之后进行对齐。

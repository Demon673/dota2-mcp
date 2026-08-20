# Agent Note: dota2-vfx / dota2-model skill 与分节读取

[English](2026-08-20-vfx-model-skills.md) | 中文

Status: implemented

## Problem

Agent 需要特效/模型工具链的内置格式知识（地图 #9）：怎么写 .vpcf/.vmdl/.vmat KV3、九个工具如何组合成工作流。#9 决议还警示：全量内容 skill 会让 dota2_skill 的全文返回过重。

## Decision

`skills/` 下内置两个 skill：`dota2-vfx`（粒子：KV3 结构经真实 basic 模板 addon 验证、C_OP_*/C_INIT_* 词汇、管线心智模型、SOP、工具映射、错误表、最小模板）与 `dota2-model`（vmdl/vmat/vtex，同构；模型验证 = 编译 + inspect + 引用 + 加载错误——按设计无预览工具，地图 #7）。共享管线/SOP 章节按 #9 决议各自带一份（自包含优先于 DRY）。「完整字段参考」章节带 TODO(rare) 标记：日常作业已覆盖，Valve wiki 全字段表由后续切片补全。

`dota2_skill` 增加 `section`（返回单个 `##` 章节）与 `outline`（列出标题）参数；小 skill 的全文返回保持默认。

## Alternatives considered

- **合并为一个 skill。** 地图 #9 否决：用户选择拆两个并各自带共享章节。
- **静默截断长正文。** 否决：分节读取显式且无损；静默截断会隐藏内容。

## Consequences

- dota2_skill 暴露的 skill：doc-standards、dota2-game-phases、dota2-model、dota2-runtime-dev、dota2-vfx。
- 字面全量字段表为未完成工作，由两个 skill 内的 TODO(rare) 追踪。

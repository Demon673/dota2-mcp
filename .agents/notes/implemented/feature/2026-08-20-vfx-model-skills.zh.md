# Agent Note: dota2-vfx / dota2-model skill 与分节读取

[English](2026-08-20-vfx-model-skills.md) | 中文

Status: implemented

## Problem

Agent 需要特效/模型工具链的内置格式知识（地图 #9）：怎么写 .vpcf/.vmdl/.vmat KV3、九个工具如何组合成工作流。#9 决议还警示：全量内容 skill 会让 dota2_skill 的全文返回过重。

## Decision

`skills/` 下内置两个 skill：`dota2-vfx`（粒子：KV3 结构经真实 basic 模板 addon 验证、C_OP_*/C_INIT_* 词汇、管线心智模型、SOP、工具映射、错误表、最小模板）与 `dota2-model`（vmdl/vmat/vtex，同构；模型验证 = 编译 + inspect + 引用 + 加载错误——按设计无预览工具，地图 #7）。共享管线/SOP 章节按 #9 决议各自带一份（自包含优先于 DRY）。字段级完整参考在 `research/vpcf-field-reference/`，不随 npm 包发布（见 [slim-skills-payload 笔记](../simplification/2026-08-25-slim-skills-payload.md)）。

`dota2_skill` 增加 `section`（返回单个 `##` 章节）、`outline`（列出标题）与 `data`（原样返回 `skills/<name>/data/` 下的单个文件；`data='list'` 则列出这些文件）参数；小 skill 的全文返回保持默认。`files[]` 打包 `skills/**/*`，因此 skill 的数据文件随 npm 包一起分发——`dota2-vfx` 正是这样把官方粒子语料统计（`vpcf-stats.json`、`vpcf-official-findings.md`）交付给在本仓库之外工作的 agent；`AGENTS.md` 工具表中的 `dota2_skill` 一行就是这一暴露面的登记项。

现在还可读取 `###` 小节和 Markdown 数据章节，并通过 `data_path` 按 JSON 点路径取值（含数组数字下标）。全文和整文件读取保留为兼容路径；工具指引优先使用目录 → 章节 → 精确数据。VFX 最小模板改为带 `C_OP_RenderSprites` 的持续光晕，不再是无法绘图的纯 emitter 系统。SOP 使用服务器 Lua 预览，并结合 `dota_screenshot` 前后画面与 `vfx_preview_stop` 验证；演练源码使用同样有效的 emitter/renderer 结构。

## Alternatives considered

- **合并为一个 skill。** 地图 #9 否决：用户选择拆两个并各自带共享章节。
- **大参考默认静默返回全文。** 为兼容而否决：保留全文读取，同时用目录、章节和 JSON 路径给 agent 明确的轻量路径。
- **静默截断长正文。** 否决：分节读取显式且无损；静默截断会隐藏内容。

## Consequences

- dota2_skill 暴露的 skill：dota2-game-phases、dota2-model、dota2-runtime-dev、dota2-vfx。
- 字段级参考表在 `research/vpcf-field-reference/`，不随 npm 包发布（见 [slim-skills-payload 笔记](../simplification/2026-08-25-slim-skills-payload.md)）。

## Testing

`test-mcp-offline.mjs` 覆盖嵌套目录、在同级标题处截止的章节读取、Markdown 数据章节、通过 `data_path` 选择 JSON 数组项，以及非法路径。在一个测试 addon 的实测中，官方粒子返回非零 PID 并成功停止；最小自定义光晕编译成功，在真实截图中出现在指定英雄位置，调用 `vfx_preview_stop` 后消失，且没有加载错误。这些检查把运行时创建与真实可见性区分开。

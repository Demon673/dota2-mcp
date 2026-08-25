# Agent Note: asset_inspect 结构化摘要

[English](2026-08-20-asset-inspect.md) | 中文

Status: implemented

## Problem

Agent 需要单个 Source 2 资产（vpcf/vmdl/vmat/vtex）的稳定、diff 友好、结构化视图，而不被反编译全文淹没（wayfinder #8 schema）。

## Decision

`src/tools/asset-inspect.ts` 的 `inspectAsset()` 运行 VRF CLI（ensureVrf 管理的 Source2Viewer-CLI）`-i <资产> -d`（vtex 加 `-o <png>`），用轻量 KV3/KV1 正则层扫描反编译文本——不做完整 KV 解析器。JSON 输出按 #8 schema：`{asset_type, source, summary, notes[, raw_decompiled]}`，键字母序稳定（diff 友好）、引用列表去重排序。各类型摘要：vpcf（按 `_class` 名统计 particle_system/emitter/operator/initializer 数，`resource:` 引用拆为 child_refs 与 material_refs，`m_nMaxParticles`）、vmdl（CMesh 数、材质引用、`m_refLODGroup`、骨架引用）、vmat（`m_shader`、纹理引用键→路径映射、参数计数）、vtex（PNG 头宽/高/格式 + 导出路径；`mip_count` 为 null 并注释——PNG 导出为单层，mip 不可恢复）、unknown（仅透传）。`raw_decompiled` 经 `include_raw` 显式开启、截断 4000 字符。工具离线不门控；资产类型由目标扩展名决定（剥 `_c`）。

## Alternatives considered

- **完整 KV 解析器。** 否决：正则扫描已覆盖摘要字段，完整解析器是维护负担、精度收益有限。
- **总是返回全文。** 否决：反编译资产可达数千行；按需开启保持 MCP 输出精简（地图 #8 Q1）。

## Consequences

- `scripts/test-asset-inspect.mjs` 用 fake VRF CLI（env `VRF_CACHE_DIR`/`VRF_VERSION`）与各类型 fixture 钉住契约：五种类型 + raw 截断。
- 工具数 27 → 28。

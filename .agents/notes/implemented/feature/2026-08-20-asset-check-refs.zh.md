# Agent Note: asset_check_refs 引用完整性遍历

[English](2026-08-20-asset-check-refs.md) | 中文

Status: implemented

## Problem

资产间断裂或过期的引用（vmdl→vmat→vtex、vpcf→vmat）在游戏加载时以不透明的引擎错误失败。Agent 需要一个离线检查：遍历单个资产的引用链并精确报告断裂位置（wayfinder #10）。

## Decision

`src/tools/asset-check-refs.ts` 的 `checkRefs()` 用 VRF CLI 反编译目标，广度优先遍历 `resource:` 引用，深度上限 `max_depth`（默认 3）+ visited 集合防环。每个引用两级解析：addon 侧（`content/dota_addons/{addon}/` 源 + `game/dota_addons/{addon}/` 编译产物，产物 = 源 + `_c`）→ 引擎侧（`game/dota/`）。按 #10 契约分四桶：`ok`（源与产物都在）、`uncompiled`（源在产物缺——「改了没编译」信号）、`engine_refs`（game/dota 下解析成功；合法引擎资产、不下钻）、`broken`（哪里都找不到）。输出 JSON 键排序去重、diff 稳定。工具离线不门控；复用 asset-inspect 的 `extractRefs`。

## Alternatives considered

- **全 addon 扫描。** 否决：地图 #7 Q6 把工具范围定为单资产递归遍历；扫描是后续切片。
- **只查存在性、不查编译状态。** 否决：地图 #10 Q3 明确要 uncompiled 桶——特效工作流最高频错误。

## Consequences

- `scripts/test-asset-check-refs.mjs` 用临时 addon 树 + fake VRF CLI 钉住离线契约：ok/uncompiled/broken/engine 四桶 + 自引用证明 visited 防环。
- 工具数 28 → 29。

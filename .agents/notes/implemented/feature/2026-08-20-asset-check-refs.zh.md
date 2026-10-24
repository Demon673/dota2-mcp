# Agent Note: asset_check_refs 引用完整性遍历

[English](2026-08-20-asset-check-refs.md) | 中文

Status: implemented

## Problem

资产间断裂或过期的引用（vmdl→vmat→vtex、vpcf→vmat）在游戏加载时以不透明的引擎错误失败。Agent 需要一个离线检查：遍历单个资产的引用链并精确报告断裂位置（wayfinder #10）。

## Decision

`src/tools/asset-check-refs.ts` 的 `checkRefs()` 用 VRF CLI 反编译目标，广度优先遍历 `resource:` 引用，深度上限 `max_depth`（默认 3）+ visited 集合防环。每个引用依次检查当前 addon（`content/dota_addons/{addon}/` 源 + `game/dota_addons/{addon}/` 编译产物，产物 = 源 + `_c`）、`game/dota/`、其他 addon 共享的编译产物，最后按精确路径查询 `pak01_dir.vpk`。按 #10 契约分四桶：`ok`（源与产物都在）、`uncompiled`（源在产物缺——「改了没编译」信号）、`engine_refs`（核心或共享引擎资产、不下钻）、`broken`（哪里都找不到，或明确的 VPK 查询失败）。VPK 查询使用 VRF `--vpk_list`，15 秒超时并按文件 mtime 缓存，而不是建立整包索引。VRF 与 VPK 子进程都在临时工作目录运行，`exceptions.txt` 不会泄漏到调用方仓库。VRF pin 为 20.1，支持当前引擎的 KV 类型 26。输出 JSON 键排序去重、diff 稳定。工具离线不门控；复用 asset-inspect 的 `extractRefs`。

## Alternatives considered

- **只查磁盘或只补共享 addon。** 否决：两者都会把官方打包资产误报为 broken。
- **每次检查都建立完整 VPK 索引。** 否决：按引用精确查询并用 mtime 缓存，避免整包清单成本；首次未命中缓存仍需支付进程启动时间。
- **全 addon 扫描。** 否决：地图 #7 Q6 把工具范围定为单资产递归遍历；扫描是后续切片。
- **只查存在性、不查编译状态。** 否决：地图 #10 Q3 明确要 uncompiled 桶——特效工作流最高频错误。

## Consequences

- `scripts/test-asset-check-refs.mjs` 用临时 addon 树 + fake VRF CLI 钉住离线契约：ok/uncompiled/broken/engine 四桶、共享 addon 与 VPK 解析，以及自引用证明 visited 防环。使用 VRF 20.1 的活体检查中，可见测试光晕的 `basic_glow.vtex` 解析为引擎引用，不再是 `not_found`；`basic_explosion_bits` 的 `sparks.vtex` 没有独立或共享产物，也通过核心 VPK 正确解析，broken 为空。
- 工具数 28 → 29。

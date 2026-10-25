# Agent Note: asset_check_refs reference integrity walk

English | [中文](2026-08-20-asset-check-refs.zh.md)

Status: implemented

## Problem

Broken or stale references between assets (vmdl→vmat→vtex, vpcf→vmat) fail at game load with opaque engine errors. Agents needed an offline check that walks one asset's chain and reports exactly where it breaks (wayfinder #10).

## Decision

`checkRefs()` in `src/tools/asset-check-refs.ts` decompiles the target with the VRF CLI and walks `resource:` references breadth-first, up to `max_depth` (default 3) with a visited-set cycle guard. Per reference, resolution checks the current addon (`content/dota_addons/{addon}/` source + `game/dota_addons/{addon}/` compiled output, where compiled = source + `_c`), `game/dota/`, compiled outputs shared by other addons, and finally the exact path in `pak01_dir.vpk`. Four buckets per the #10 contract: `ok` (source + compiled output present), `uncompiled` (source present, compiled output missing — the "edited but not compiled" signal), `engine_refs` (core or shared engine assets, depth not walked), `broken` (not found anywhere, or an explicit VPK lookup failure). VPK queries use VRF `--vpk_list` with a 15 s timeout and a bounded mtime-keyed FIFO cache rather than a whole-archive index. VRF and VPK subprocesses run in temporary working directories with a credential-scrubbed environment, keeping `exceptions.txt` out of the caller's repository. The pinned VRF is 20.1, which accepts the current engine's KV type 26. Output JSON is key-sorted and deduped for diff stability. The tool is offline and ungated; it reuses `extractRefs` from asset-inspect.

## Alternatives considered

- **Disk-only or shared-addon-only resolution.** Rejected: both misclassify official packed assets as broken.
- **Build a whole-VPK index for every check.** Rejected: exact per-reference lookup plus an mtime-keyed cache avoids the large manifest cost; the first uncached lookup still pays process startup.
- **Full addon scan.** Rejected: map #7 Q6 scoped the tool to single-asset recursive walking; a scan is a later slice.
- **Check existence only, ignore compiled state.** Rejected: map #10 Q3 explicitly wanted the uncompiled bucket — the most common vfx workflow error.

## Consequences

- `scripts/test-asset-check-refs.mjs` pins the offline contract with a temp addon tree + fake VRF CLI: ok/uncompiled/broken/engine buckets, shared-addon and VPK resolution, and a self-reference proving the visited guard breaks cycles. Live with VRF 20.1, the visible test glow's `basic_glow.vtex` resolves as an engine reference instead of `not_found`; `basic_explosion_bits`' `sparks.vtex`, which has no loose/shared output, also resolves through the core VPK with no broken references.
- Tool count 28 → 29.

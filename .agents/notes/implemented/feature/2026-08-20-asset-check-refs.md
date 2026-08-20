# Agent Note: asset_check_refs reference integrity walk

English | [中文](2026-08-20-asset-check-refs.zh.md)

Status: implemented

## Problem

Broken or stale references between assets (vmdl→vmat→vtex, vpcf→vmat) fail at game load with opaque engine errors. Agents needed an offline check that walks one asset's chain and reports exactly where it breaks (wayfinder #10).

## Decision

`checkRefs()` in `src/tools/asset-check-refs.ts` decompiles the target with the VRF CLI and walks `resource:` references breadth-first, up to `max_depth` (default 3) with a visited-set cycle guard. Per reference, two-level resolution: addon side (`content/dota_addons/{addon}/` source + `game/dota_addons/{addon}/` compiled output, where compiled = source + `_c`) → engine side (`game/dota/`). Four buckets per the #10 contract: `ok` (source + compiled output present), `uncompiled` (source present, compiled output missing — the "edited but not compiled" signal), `engine_refs` (resolved under game/dota; legit engine assets, depth not walked), `broken` (not found anywhere). Output JSON is key-sorted and deduped for diff stability. The tool is offline and ungated; it reuses `extractRefs` from asset-inspect.

## Alternatives considered

- **Full addon scan.** Rejected: map #7 Q6 scoped the tool to single-asset recursive walking; a scan is a later slice.
- **Check existence only, ignore compiled state.** Rejected: map #10 Q3 explicitly wanted the uncompiled bucket — the most common vfx workflow error.

## Consequences

- `scripts/test-asset-check-refs.mjs` pins the offline contract with a temp addon tree + fake VRF CLI: ok/uncompiled/broken/engine buckets, and a self-reference proving the visited guard breaks cycles.
- Tool count 28 → 29.

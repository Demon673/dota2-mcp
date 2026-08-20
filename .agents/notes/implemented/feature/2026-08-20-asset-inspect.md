# Agent Note: asset_inspect structured summary

English | [中文](2026-08-20-asset-inspect.zh.md)

Status: implemented

## Problem

Agents needed a stable, diff-friendly, structured view of single Source 2 assets (vpcf/vmdl/vmat/vtex) without drowning in full decompiled text (wayfinder #8 schema).

## Decision

`inspectAsset()` in `src/tools/asset-inspect.ts` runs the VRF CLI (`ensureVrf`-managed Source2Viewer-CLI) with `-i <asset> -d` (plus `-o <png>` for vtex) and scans the decompiled text with a lightweight KV3/KV1 regex layer — no full KV parser. The JSON output follows the #8 schema: `{asset_type, source, summary, notes[, raw_decompiled]}` with alphabetically sorted keys (stable, diff-friendly) and deduped/sorted reference lists. Type summaries: vpcf (particle_system/emitter/operator/initializer counts via `_class` names, `resource:` refs split into child_refs and material_refs, `m_nMaxParticles`), vmdl (CMesh count, material refs, `m_refLODGroup`, skeleton ref), vmat (`m_shader`, texture refs mapped key→path, param count), vtex (PNG header width/height/format + exported path; `mip_count` is null with a note — the PNG export is single-layer so mips are not recoverable), unknown (pass-through only). `raw_decompiled` is opt-in via `include_raw`, truncated to 4000 chars. The tool is offline and ungated; the asset type comes from the target extension (`_c` stripped).

## Alternatives considered

- **Full KV parser.** Rejected: regex over the decompiled text is enough for the summary fields, and a parser is a maintenance liability for marginal accuracy gains.
- **Return raw text always.** Rejected: decompiled assets can be thousands of lines; opt-in keeps MCP output lean (map #8 Q1).

## Consequences

- `scripts/test-asset-inspect.mjs` pins the contract with a fake VRF CLI (env `VRF_CACHE_DIR`/`VRF_VERSION`) and typed fixtures: all five asset types plus raw truncation.
- Tool count 27 → 28.

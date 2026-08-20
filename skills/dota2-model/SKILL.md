---
name: dota2-model
description: Use when creating, editing, compiling, or validating Dota 2 model assets (.vmdl/.vmat/.vtex) — writing model/material sources with file_write/file_edit, compiling with dota_compile_asset, inspecting structure with asset_inspect, and checking reference integrity with asset_check_refs.
---

# Dota 2 Model Assets — Model Assets

This skill owns the model-asset workflow of the dota2-mcp toolchain: authoring `.vmdl` / `.vmat` / `.vtex` sources, compiling them, and validating structure and references. All structural facts below are verified against the official corpus (`dota2_skill` data='model-stats.json': 3,161 vmdl + 2,549 vmat decompiles, 100% success).

## Core mental model: asset pipeline

Same split as particles (see dota2-vfx): sources live under `content/dota_addons/<addon>/` (`.vmdl` KV3-modeldoc, `.vmat` quoted-KeyValues), compiled outputs under `game/dota_addons/<addon>/` (`_c` suffix). The engine loads only the compiled side. Texture sources (`.tga`/`.psd`) compile into `.vtex_c`.

## .vmdl authoring quick reference (modeldoc28)

**The official corpus is 100% modeldoc node graphs, not m_meshList.** The root carries `rootNode`/`children` — never `m_meshList` / `m_material` / `m_refLODGroup` (those field names appear 0 times in 18,405 official models).

```
<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:modeldoc28:version{...} -->
{
  rootNode =
  {
    _class = "RootNode"
    children =
    [
      {
        _class = "ModelDocNode"
        name = "hero"
        meshes =
        [
          { _class = "RenderMeshFile" filename = "models/hero/hero.dmx" },
        ]
      },
    ]
  }
  LODGroupList = [ /* 61.6% of models; p50 = 2 LOD groups */ ]
  Skeleton = { /* 92.7% of models; p50 = 15 bones, p90 = 60 */ }
  AnimationList = [ /* 48.3% of models; p90 = 16 anims */ ]
  AttachmentList = [ ]
  HitboxSetList = [ /* 57.6% of models */ ]
  MaterialGroupList = [ /* 9.9% of models: style variants */ ]
}
```

- **Meshes are imported `.dmx` files** — `RenderMeshFile.filename` (100% of meshes; no inline mesh data, no `m_smdl` field).
- **Materials are bound in the mesh, not the model** — the `.vmdl` carries no material assignment; style variants use `MaterialGroupList` → `BaseMaterialRemap { from, to }`.
- Mesh count p50 = 2 (typical: base mesh + LOD1), max 58.

## .vmat authoring quick reference (quoted KeyValues)

**vmat is quoted KeyValues wrapped in "Layer0" { }, not KV3.** Fields: `shader` (not `m_shader`), `F_*` feature flags, `g_fl*`/`g_v*` numeric params, source `Texture*` refs, plus a "Compiled Textures" block of `g_t*` refs.

```
"Layer0"
{
  shader "hero.vfx"
  F_MASKS_1 1
  F_MASKS_2 1
  F_USE_STATUS_EFFECTS_PROXY 1
  TextureColor "materials/models/hero/hero_color"
  TextureNormal "materials/models/hero/hero_normal"
  TextureMasks1 "materials/models/hero/hero_masks1"
  TextureMasks2 "materials/models/hero/hero_masks2"
  "Compiled Textures"
  {
    g_tColor "materials/models/hero/hero_color.vtex"
    g_tNormal "materials/models/hero/hero_normal.vtex"
  }
}
```

- **The canonical shader is `hero.vfx`** (88.9% of materials) — not `dota_hero.vfx`. Runners-up: `global_lit_simple.vfx` (5.5%), `projected_dota.vfx` (3.9%).
- **Source texture params are `Texture*` names** (34,922 instances); the compiled side maps them to `g_t*` (16,014 instances, p50 = 7 per material).
- **Canonical hero material** = `hero.vfx` + g_tColor + g_tNormal + g_tMasks1 + g_tMasks2 + F_MASKS_1 + F_MASKS_2 + F_USE_STATUS_EFFECTS_PROXY.
- Param count p50 = 43 (p90 = 58). Flags: F_MASKS_2 83% / F_MASKS_1 81% / F_USE_STATUS_EFFECTS_PROXY 80% / F_ALPHA_TEST 54%; two-sided 4.4%, additive 4%, self-illum (TextureSelfIllumMask) 85%.

## .vtex texture notes

Texture sources (`.tga`/`.psd`) compile to `.vtex_c`. `asset_inspect` on a compiled texture exports a PNG and reports its dimensions/format (mip count is not recoverable from the PNG export).

## Complete field reference (official corpus statistics)

Full statistics ship with the skill: `dota2_skill(name='dota2-model', data='model-stats.json')` (machine-readable) and `data='model-official-findings.md'` (readable report, 348 lines). Headline numbers: vmdl 100% modeldoc28; mesh import 100% via RenderMeshFile `.dmx`; LOD 61.6%; skeleton 92.7%; animation 48.3%; physics 1.8%. vmat: shader hero.vfx 88.9%; params p50=43; Texture* source refs vs g_t* compiled refs; F_* flag frequencies.

## Workflow SOP

1. **Write source file** — `file_write` the `.vmdl` (modeldoc) / `.vmat` (quoted KeyValues) under content (offline).
2. **Compile** — `dota_compile_asset` each source; resourcecompiler emits the `_c` outputs under game/. Syntax errors surface as stderr with line info.
3. **Verify structure** — `asset_inspect` the compiled asset (offline): modeldoc node/mesh refs and LOD/skeleton for vmdl; shader + texture refs for vmat; PNG dimensions for vtex.
4. **Verify references** — `asset_check_refs` on the model: every material/texture ref must land in `ok` (or `engine_refs` for engine assets); `broken`/`uncompiled` entries name the exact fix.
5. **Confirm in game** — launch the map and read `console_output` (ResourceSystem/MaterialSystem) after loading: no material errors means the chain compiled and resolved. (There is no model preview tool by design — model validation is compile + inspect + refs + load errors.)

## Tool mapping table

| Step | Tool | Notes |
|------|------|-------|
| Create/edit sources | `file_write` / `file_edit` | offline |
| Compile | `dota_compile_asset` | resourcecompiler |
| Inspect compiled asset | `asset_inspect` | offline; structured summary per type |
| Check reference integrity | `asset_check_refs` | offline; four buckets |
| Load-error check | `console_output` | channels ResourceSystem / MaterialSystem |

## Common errors reference

| Symptom | Cause | Fix |
|---------|-------|-----|
| Compile fails with a KV error line | source syntax | fix the reported line, recompile |
| vmdl written with m_meshList/m_material | wrong format assumptions (pre-corpus) | rewrite as modeldoc rootNode/children + RenderMeshFile; materials bind in the mesh, style variants via MaterialGroupList |
| vmat written as KV3 with m_shader | vmat is quoted KeyValues | wrap in "Layer0" { }, use `shader "hero.vfx"` and `F_*` flags |
| `asset_check_refs` lists a material as `broken` | ref path wrong or file missing | file_write the missing asset or fix the ref path |
| `asset_check_refs` lists `uncompiled` | source exists, `_c` output missing | run dota_compile_asset on the source |
| MaterialSystem error in console on map load | material ref chain broken at runtime | asset_check_refs the model; fix broken/uncompiled buckets |
| `asset_inspect` reports `unknown` | extension not a known asset type | check the target path/extension |
| addon never launches | empty addoninfo | declare maps/IsPlayable in addoninfo.txt (see dota2-vfx Common errors reference) |

## Minimal template

A minimal single-mesh model + material pair (modeldoc + quoted KeyValues):

```
<!-- models/<name>.vmdl — modeldoc28 -->
{
  rootNode =
  {
    _class = "RootNode"
    children =
    [
      { _class = "ModelDocNode" name = "<name>" meshes = [ { _class = "RenderMeshFile" filename = "models/<name>/<name>.dmx" } ] },
    ]
  }
}
```

```
// materials/models/<name>.vmat — quoted KeyValues
"Layer0"
{
  shader "hero.vfx"
  TextureColor "materials/models/<name>/<name>_color"
}
```

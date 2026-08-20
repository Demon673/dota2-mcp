---
name: dota2-model
description: Use when creating, editing, compiling, or validating Dota 2 model assets (.vmdl/.vmat/.vtex) — writing model/material sources with file_write/file_edit, compiling with dota_compile_asset, inspecting structure with asset_inspect, and checking reference integrity with asset_check_refs.
---

# Dota 2 Model Assets — 模型资产

This skill owns the model-asset workflow of the dota2-mcp toolchain: authoring `.vmdl` / `.vmat` / `.vtex` sources, compiling them, and validating structure and references. It is self-contained for everyday model work; deeper reference tables grow in the 完整字段参考 sections.

## 核心心智模型：资产管线

Same split as particles (see dota2-vfx): sources live under `content/dota_addons/<addon>/` (`.vmdl`, `.vmat`, `.vtex` text/KV), compiled outputs under `game/dota_addons/<addon>/` (`_c` suffix). The engine loads only the compiled side. Texture sources (`.tga`/`.psd`) compile into `.vtex_c`; the `.vtex` file in content is the compiled texture output.

## .vmdl 写作速查

Model sources are KV3 text. The core structure:

```
<!-- kv3 encoding:text:... format:generic:... -->
{
  m_meshList =
  [
    { _class = "CMesh" m_material = resource:"materials/models/<name>.vmat" },
  ]
  m_refLODGroup = resource:"models/<name>_lod.vmdl"
}
```

- **`m_meshList`** — array of `CMesh` blocks; each carries `m_material` as a `resource:` ref to a `.vmat`.
- **`m_refLODGroup`** — optional resource ref to the LOD model.
- **Skeleton refs** — resource refs to other `.vmdl` files.

## .vmat 写作速查

Material sources are small KV3 blocks: `m_shader` names the shader, texture parameters map keys to `resource:` refs of `.vtex` files:

```
{
  m_shader = "dota_hero.vfx"
  g_tColor = resource:"materials/models/<name>/<name>_color.vtex"
  g_tNormal = resource:"materials/models/<name>/<name>_normal.vtex"
  g_flRoughness = 0.8
}
```

## .vtex 纹理要点

Texture sources (`.tga`/`.psd`) compile to `.vtex_c`. `asset_inspect` on a compiled texture exports a PNG and reports its dimensions/format (mip count is not recoverable from the PNG export).

## 完整字段参考（字面全量）

TODO(rare): 本章节逐步补全 Valve wiki 的完整 vmdl/vmat/vtex 字段表。当前速查覆盖日常作业；罕见字段在补齐前用 dota_compile_asset 报错 + 全局 dota2-custom-game-dev 快照定位。

## 工作流 SOP

1. **写源文件** — `file_write` the `.vmdl`/`.vmat` under content (offline).
2. **编译** — `dota_compile_asset` each source; resourcecompiler emits the `_c` outputs under game/. Syntax errors surface as stderr with line info.
3. **验证结构** — `asset_inspect` the compiled asset (offline): mesh/material refs, LOD/skeleton refs for vmdl; shader + texture refs for vmat; PNG dimensions for vtex.
4. **验证引用** — `asset_check_refs` on the model: every material/texture ref must land in `ok` (or `engine_refs` for engine assets); `broken`/`uncompiled` entries name the exact fix.
5. **游戏内确认** — launch the map and read `console_output` (ResourceSystem/MaterialSystem) after loading: no material errors means the chain compiled and resolved. (There is no model preview tool by design — model validation is compile + inspect + refs + load errors.)

## 工具映射表

| Step | Tool | Notes |
|------|------|-------|
| Create/edit sources | `file_write` / `file_edit` | offline |
| Compile | `dota_compile_asset` | resourcecompiler |
| Inspect compiled asset | `asset_inspect` | offline; structured summary per type |
| Check reference integrity | `asset_check_refs` | offline; four buckets |
| Load-error check | `console_output` | channels ResourceSystem / MaterialSystem |

## 常见错误对照

| Symptom | Cause | Fix |
|---------|-------|-----|
| Compile fails with a KV error line | source syntax | fix the reported line, recompile |
| `asset_check_refs` lists a material as `broken` | ref path wrong or file missing | file_write the missing asset or fix the `resource:` path |
| `asset_check_refs` lists `uncompiled` | source exists, `_c` output missing | run dota_compile_asset on the source |
| MaterialSystem error in console on map load | material ref chain broken at runtime | asset_check_refs the model; fix broken/uncompiled buckets |
| `asset_inspect` reports `unknown` | extension not a known asset type | check the target path/extension |
| addon never launches | empty addoninfo | declare maps/IsPlayable in addoninfo.txt (see dota2-vfx 常见错误) |

## 最小模板

A minimal single-mesh model + material pair:

```
<!-- models/<name>.vmdl -->
{
  m_meshList =
  [
    { _class = "CMesh" m_material = resource:"materials/models/<name>.vmat" },
  ]
}
```

```
// materials/models/<name>.vmat
{
  m_shader = "dota_hero.vfx"
  g_tColor = resource:"materials/models/<name>/<name>_color.vtex"
}
```

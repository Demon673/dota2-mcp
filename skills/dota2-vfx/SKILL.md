---
name: dota2-vfx
description: Use when creating, editing, compiling, or previewing Dota 2 particle effects (.vpcf) — writing particle KV3 sources with file_write/file_edit, compiling with dota_compile_asset, previewing in-game with vfx_preview, or diagnosing particle load failures.
---

# Dota 2 VFX — 粒子特效

This skill owns the particle-effect workflow of the dota2-mcp toolchain: authoring `.vpcf` sources, compiling them, and verifying the result in a running game. It is self-contained for everyday particle work; deeper reference tables grow in the 完整字段参考 sections.

## 核心心智模型：资产管线

Dota 2 assets split across two trees under the Dota 2 install:

- **content/** — the authored **sources** you edit: `content/dota_addons/<addon>/particles/<name>.vpcf` (KV3 text).
- **game/** — the **compiled outputs** the engine loads: `game/dota_addons/<addon>/particles/<name>.vpcf_c` (binary), produced by resourcecompiler.

The engine loads only `game/` outputs. A particle that exists as source but not as compiled output fails to load at runtime (the `uncompiled` bucket of asset_check_refs). The loop is: **write source → compile → preview in game → read load errors → fix**.

## .vpcf 写作速查（KV3）

Sources are KV3 text: a header comment line, then `{ key = value ... }` blocks. The root is a particle system definition:

```
<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:generic:version{7412167c-06e9-4698-aff2-e63eb59037e7} -->
{
  _class = "CParticleSystemDefinition"
  m_nMaxParticles = 64
  m_Children =
  [
    { m_ChildRef = resource:"particles/<addon>/my_burst.vpcf" },
  ]
}
```

Key vocabulary (verified against a real basic-template addon):

- **`_class`** — the block's engine class. Root system: `CParticleSystemDefinition`. Children are organized by class prefixes: `C_OP_*` are operators (spawn, movement, renderers), `C_INIT_*` are initializers (lifetime, trail length).
- **`m_Children`** — array of child particle systems, each an object with `m_ChildRef = resource:"particles/<path>.vpcf"`.
- **`m_nMaxParticles`** — particle budget of this system.
- **References** use KV3 `resource:"path"` syntax. Material/texture refs point into `materials/` (e.g. `resource:"materials/particle/basic_glow.vtex"`). Paths are relative to the content root and carry no addon prefix.
- **Emitters** appear as `_class = "C_OP_InstantaneousEmitter"` blocks with rate fields (e.g. `m_flSpawnRate`).

Common emitter/operator/initializer classes seen in the basic template: `C_OP_InstantaneousEmitter`, `C_OP_BasicMovement`, `C_OP_Decay`, `C_OP_FadeOutSimple`, `C_OP_InterpolateRadius`, `C_OP_RenderTrails`, `C_INIT_RandomLifeTime`, `C_INIT_RandomTrailLength`.

## 完整字段参考（字面全量）

TODO(rare): 本章节逐步补全 Valve wiki 的完整 vpcf 字段表（全部 C_OP_*/C_INIT_*/renderer 类型与字段）。当前速查覆盖日常作业；罕见的操作器字段在补齐前用 dota_compile_asset 报错 + 全局 dota2-custom-game-dev 快照定位。

## 工作流 SOP

1. **写源文件** — `file_write` to `content/dota_addons/<addon>/particles/<name>.vpcf` (KV3 as above), or `file_edit` to tweak an existing one. Editing a source does not require the game; FileOps tools are offline.
2. **编译** — `dota_compile_asset` with the source path. resourcecompiler emits `game/dota_addons/<addon>/particles/<name>.vpcf_c`. Non-zero exit or stderr means a source syntax error — read the reported line.
3. **预览** — with the game running (launch your map via `dota_launch_game` if needed) call `vfx_preview` with `particle_path: "particles/<name>.vpcf"` (content-root relative, no `_c`, no addon prefix) and `attach: 8` (PATTACH_WORLDORIGIN) plus an optional `position`. It returns a runtime particle id.
4. **验证** — do not trust the id alone: read `console_output` for load errors in the Particles/ResourceSystem channels. `pid=0` means the engine rejected the create call; a missing file prints a load failure line.
5. **停止预览** — `vfx_preview_stop` with the id (runtime instance only; the asset file stays).
6. **删除资产** — `file_delete` on the source (and recompile or leave stale outputs to `asset_check_refs`).

## 工具映射表

| Step | Tool | Notes |
|------|------|-------|
| Create/edit source | `file_write` / `file_edit` | offline; addon-scoped paths only |
| Delete source | `file_delete` | offline |
| Compile | `dota_compile_asset` | resourcecompiler; sources → game/ `_c` |
| Inspect compiled asset | `asset_inspect` | offline; VRF decompile + summary |
| Check reference integrity | `asset_check_refs` | offline; ok/uncompiled/engine_refs/broken |
| Preview in game | `vfx_preview` | gated (needs game + vconsole); returns pid |
| Stop preview | `vfx_preview_stop` | gated |
| Read load errors | `console_output` | channels Particles / ResourceSystem |

## 常见错误对照

| Symptom | Cause | Fix |
|---------|-------|-----|
| `dota_launch_game` stuck at `(unknown)` / menu | addon not launchable | declare the map in `game/dota_addons/<addon>/addoninfo.txt` (`AddonInfo { maps "<map>" IsPlayable "1" }`) — the basic template generates an empty KV3 `{}` |
| Map never loads after addoninfo fixed | map not compiled | run resourcecompiler on `content/.../maps/<map>.vmap` (emits `game/maps/<map>.vpk`) before launching |
| `vfx_preview` returns `pid=0` | engine rejected the create call (file missing/uncompiled/wrong path) | check the path is content-root relative without `_c`; compile the source; read console_output Particles/ResourceSystem for the load failure line |
| Game stuck in `CUSTOM_GAME_SETUP` | addon never calls `GameRules:FinishCustomGameSetup()` (basic template doesn't) | `dota_run_lua` with code `GameRules:FinishCustomGameSetup()` |
| Particle loads but shows nothing | control point position off-screen | pass a `position` to vfx_preview or use PATTACH_POINT with a control point |
| `asset_check_refs` reports `uncompiled` | source exists, compiled output missing | run dota_compile_asset on the source |

## 最小模板

A minimal world-origin burst system you can file_write and compile as a starting point:

```
<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:generic:version{7412167c-06e9-4698-aff2-e63eb59037e7} -->
{
  _class = "CParticleSystemDefinition"
  m_nMaxParticles = 32
  m_Children =
  [
    {
      _class = "CParticleSystemDefinition"
      m_flConstantRadius = 4.0
      m_Operators =
      [
        { _class = "C_OP_InstantaneousEmitter" m_flSpawnRate = 32 },
        { _class = "C_INIT_RandomLifeTime" m_fLifetimeMin = 0.4 m_fLifetimeMax = 0.8 },
        { _class = "C_OP_Decay" },
        { _class = "C_OP_BasicMovement" },
      ]
    },
  ]
}
```

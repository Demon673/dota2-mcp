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

**第一原则：对照现成源，不要凭猜写结构。** Every structural fact below is verified against real engine-accepted sources. When you need a shape you haven't seen, copy a working source and change parameters — a guessed field name or a misplaced block can crash the engine on preview.

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
- **Emitters** live in their own `m_Emitters` block (never inside `m_Operators`): `C_OP_InstantaneousEmitter` takes `m_nParticlesToEmit` (count), `C_OP_ContinuousEmitter` takes `m_flEmitRate` (per second). Wrong field names are silently dropped and fall back to engine defaults (100) — no compile error.

Common emitter/operator/initializer classes seen in the basic template: `C_OP_InstantaneousEmitter`, `C_OP_BasicMovement`, `C_OP_Decay`, `C_OP_FadeOutSimple`, `C_OP_InterpolateRadius`, `C_OP_RenderTrails`, `C_INIT_RandomLifeTime`, `C_INIT_RandomTrailLength`.

## 完整字段参考（字面全量·第一批：模板实证结构）

Based on a deep-dive of 18 real template sources, 7 VRF decompiles, and the engine's particle schemas (research/vpcf-structure/findings.md).

### 顶层区块（引擎执行序）

`m_PreEmissionOperators → m_Emitters → m_Initializers → m_Operators → m_ForceGenerators → m_Constraints → m_Renderers → m_Children`

Root scalars: `m_nMaxParticles`, `m_nInitialParticles`, `m_ConstantColor` [R,G,B,A], `m_flConstantRadius`, `m_flConstantLifespan`, `m_nConstantSequenceNumber`, `m_BoundingBoxMin/Max`, `m_bShouldSort`.

`m_Children` entries: `m_ChildRef = resource:"particles/<name>.vpcf"`, `m_flDelay`, `m_bEndCap`, `m_bDisableChild`, `m_nDetailLevel`. Prefer external `m_ChildRef` links over inlining child systems.

### 发射器（m_Emitters，5 类，模板用前二）

| Class | Key field | Preview behavior |
|-------|-----------|------------------|
| `C_OP_ContinuousEmitter` | `m_flEmitRate`（每秒；`m_flEmissionDuration` 0=无限） | 静态预览可见 |
| `C_OP_InstantaneousEmitter` | `m_nParticlesToEmit`（数量，默认 100） | t=0 一次，静态预览看不见（要 play/进游戏） |
| `C_OP_MaintainEmitter` / `C_OP_NoiseEmitter` / `C_OP_RenderVolumetricEmitter` | — | — |

### 渲染器（m_Renderers，38 类，模板用 4）

- `C_OP_RenderSprites`：源里写单 `m_hTexture = resource:"materials/…vtex"`（编译后变 `m_vecTexturesInput` 数组）；`m_bAdditive = true`（编译后 `m_nOutputBlendMode = "PARTICLE_OUTPUT_BLEND_MODE_ADD"`）、`m_flAnimationRate`、`m_flSelfIllumAmount`、`m_flDiffuseAmount`。
- `C_OP_RenderTrails`：`m_flLengthScale`，纹理同上（源单 m_hTexture）。
- `C_OP_RenderRopes`：`m_flTextureVWorldSize`、`m_flTextureVScrollRate`。
- `C_OP_RenderDeferredLight`：**保持单 `m_hTexture`**；`m_ColorScale`（源）/ `m_vecColorScale`（编译后）；`m_flRadiusScale`、`m_flAlphaScale`、`m_flStartFalloff`。

### 常用 Initializers（m_Initializers）

- `C_INIT_CreateWithinSphere`：`m_fRadiusMin/Max`、`m_fSpeedMin/Max`、`m_LocalCoordinateSystemSpeedMin/Max`、`m_nControlPointNumber`。
- `C_INIT_CreateWithinBox`：`m_vecMin` / `m_vecMax`。
- `C_INIT_CreateSequentialPath`：`m_flNumToAssign`、`m_PathParams`。
- **Random* 是编辑器快捷方式**，编译成通用 `C_INIT_InitFloat` 写标量属性：RandomLifeTime→字段1（寿命）、RandomRadius→0（半径）、RandomRotation→4、RandomRotationSpeed→5、RandomAlpha→7（存 0..1）。另有 RandomColor / RandomYawFlip / RandomTrailLength / InitialVelocityNoise / RemapParticleCountToScalar。

### 常用 Operators（m_Operators）与 ForceGenerators

- Movement/外观：`C_OP_BasicMovement`（`m_Gravity`、`m_fDrag`）、`C_OP_MaxVelocity`、`C_OP_PositionLock`、`C_OP_OscillateVector`、`C_OP_SpinUpdate`。
- 寿命/淡入淡出：`C_OP_Decay`（`m_nOpEndCapState`）、`C_OP_InterpolateRadius`（`m_flStartScale/EndScale/Bias`）、`C_OP_FadeInSimple`、`C_OP_FadeOutSimple`、`C_OP_ColorInterpolate`（`m_ColorFade`、`m_flFadeStartTime`）。
- 控制点：`C_OP_SetChildControlPoints`（`m_nFirstControlPoint`）、`C_OP_SetSingleControlPointPosition`（pre-emission 类会被编译器自动挪进 `m_PreEmissionOperators`）。
- 力：`C_OP_RandomForce`、`C_OP_TurbulenceForce`、`C_OP_AttractToControlPoint`。

### 坑清单（全部实证）

1. 错误的字段名被**静默丢弃**回退引擎默认（如写 `m_flSpawnRate` → 实际 m_nParticlesToEmit=100），无编译错误。
2. 编译器**不会**把放错区块的 emitter/initializer 挪走——区块放错 = 行为错。
3. 用 `m_ChildRef` 外链，不要内联 child 系统。
4. `m_flConstantLifespan`（常量）与 `C_INIT_RandomLifeTime`（随机）二选一，别混用。
5. 纹理引用必须 `resource:"materials/…vtex"` 写法。
6. InstantaneousEmitter 在 Particle Editor 静态预览不显示。
7. 源里写 `m_hTexture`，不是 `m_vecTexturesInput`（那是编译产物形态）。
8. 反编译输出比源胖约 40 倍是引擎补默认值，不是错误。

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
| Particle Editor preview shows nothing | `C_OP_InstantaneousEmitter` fires once at t=0 and the editor's static preview is past it | use `C_OP_ContinuousEmitter` for editor-visible particles; burst-style particles only show in the live game (or the editor's simulate/play) |
| Editor preview shows nothing, asset crashes on preview | hand-written structure with guessed fields (e.g. `m_vecTexturesInput` on RenderSprites — that's RenderTrails' field; emitter placed in m_Operators instead of m_Emitters) | copy a known-good source asset and change parameters; never hand-write a structure you haven't seen in a working source |
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
        { _class = "C_OP_Decay" },
        { _class = "C_OP_BasicMovement" },
      ]
      m_Initializers =
      [
        { _class = "C_INIT_RandomLifeTime" m_fLifetimeMin = 0.4 m_fLifetimeMax = 0.8 },
      ]
      m_Emitters =
      [
        { _class = "C_OP_ContinuousEmitter" m_flEmitRate = 16 },
      ]
    },
  ]
}
```

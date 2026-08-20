---
name: dota2-vfx
description: Use when creating, editing, compiling, or previewing Dota 2 particle effects (.vpcf) — writing particle KV3 sources with file_write/file_edit, compiling with dota_compile_asset, previewing in-game with vfx_preview, or diagnosing particle load failures.
---

# Dota 2 VFX — Particle Effects

This skill owns the particle-effect workflow of the dota2-mcp toolchain: authoring `.vpcf` sources, compiling them, and verifying the result in a running game. It is self-contained for everyday particle work; deeper reference tables grow in the Complete Field Reference sections.

## Core mental model: asset pipeline

Dota 2 assets split across two trees under the Dota 2 install:

- **content/** — the authored **sources** you edit: `content/dota_addons/<addon>/particles/<name>.vpcf` (KV3 text).
- **game/** — the **compiled outputs** the engine loads: `game/dota_addons/<addon>/particles/<name>.vpcf_c` (binary), produced by resourcecompiler.

The engine loads only `game/` outputs. A particle that exists as source but not as compiled output fails to load at runtime (the `uncompiled` bucket of asset_check_refs). The loop is: **write source → compile → preview in game → read load errors → fix**.

## .vpcf authoring quick reference (KV3)

**First principle: work from existing sources, don't guess the structure.** Every structural fact below is verified against real engine-accepted sources. When you need a shape you haven't seen, copy a working source and change parameters — a guessed field name or a misplaced block can crash the engine on preview.

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

## Complete field reference (full literal · batch 1: template-verified structure)

Based on a deep-dive of 18 real template sources, 7 VRF decompiles, and the engine's particle schemas (research/vpcf-structure/findings.md).

### Top-level blocks (engine execution order)

`m_PreEmissionOperators → m_Emitters → m_Initializers → m_Operators → m_ForceGenerators → m_Constraints → m_Renderers → m_Children`

Root scalars: `m_nMaxParticles`, `m_nInitialParticles`, `m_ConstantColor` [R,G,B,A], `m_flConstantRadius`, `m_flConstantLifespan`, `m_nConstantSequenceNumber`, `m_BoundingBoxMin/Max`, `m_bShouldSort`.

`m_Children` entries: `m_ChildRef = resource:"particles/<name>.vpcf"`, `m_flDelay`, `m_bEndCap`, `m_bDisableChild`, `m_nDetailLevel`. Prefer external `m_ChildRef` links over inlining child systems.

### Emitters (m_Emitters, 5 classes, template uses the first two)

| Class | Key field | Preview behavior |
|-------|-----------|------------------|
| `C_OP_ContinuousEmitter` | `m_flEmitRate` (per second; `m_flEmissionDuration` 0=infinite) | visible in static preview |
| `C_OP_InstantaneousEmitter` | `m_nParticlesToEmit` (count, default 100) | fires once at t=0, not visible in static preview (needs play/in-game) |
| `C_OP_MaintainEmitter` / `C_OP_NoiseEmitter` / `C_OP_RenderVolumetricEmitter` | — | — |

### Renderers (m_Renderers, 38 classes, template uses 4)

- `C_OP_RenderSprites`: write a single `m_hTexture = resource:"materials/…vtex"` in source (compiles to the `m_vecTexturesInput` array); `m_bAdditive = true` (compiles to `m_nOutputBlendMode = "PARTICLE_OUTPUT_BLEND_MODE_ADD"`), `m_flAnimationRate`, `m_flSelfIllumAmount`, `m_flDiffuseAmount`.
- `C_OP_RenderTrails`: `m_flLengthScale`, texture as above (single m_hTexture in source).
- `C_OP_RenderRopes`: `m_flTextureVWorldSize`, `m_flTextureVScrollRate`.
- `C_OP_RenderDeferredLight`: **keep a single `m_hTexture`**; `m_ColorScale` (source) / `m_vecColorScale` (compiled); `m_flRadiusScale`, `m_flAlphaScale`, `m_flStartFalloff`.

### Common Initializers (m_Initializers)

- `C_INIT_CreateWithinSphere`: `m_fRadiusMin/Max`, `m_fSpeedMin/Max`, `m_LocalCoordinateSystemSpeedMin/Max`, `m_nControlPointNumber`.
- `C_INIT_CreateWithinBox`: `m_vecMin` / `m_vecMax`.
- `C_INIT_CreateSequentialPath`: `m_flNumToAssign`, `m_PathParams`.
- **Random* are editor shortcuts**, compiled to the generic `C_INIT_InitFloat` writing scalar properties: RandomLifeTime→field 1 (lifetime), RandomRadius→0 (radius), RandomRotation→4, RandomRotationSpeed→5, RandomAlpha→7 (stores 0..1). Also RandomColor / RandomYawFlip / RandomTrailLength / InitialVelocityNoise / RemapParticleCountToScalar.

### Common Operators (m_Operators) and ForceGenerators

- Movement/appearance: `C_OP_BasicMovement` (`m_Gravity`, `m_fDrag`), `C_OP_MaxVelocity`, `C_OP_PositionLock`, `C_OP_OscillateVector`, `C_OP_SpinUpdate`.
- Lifetime/fade: `C_OP_Decay` (`m_nOpEndCapState`), `C_OP_InterpolateRadius` (`m_flStartScale/EndScale/Bias`), `C_OP_FadeInSimple`, `C_OP_FadeOutSimple`, `C_OP_ColorInterpolate` (`m_ColorFade`, `m_flFadeStartTime`).
- Control points: `C_OP_SetChildControlPoints` (`m_nFirstControlPoint`), `C_OP_SetSingleControlPointPosition` (the pre-emission class is auto-moved by the compiler into `m_PreEmissionOperators`).
- Forces: `C_OP_RandomForce`, `C_OP_TurbulenceForce`, `C_OP_AttractToControlPoint`.

### Official corpus statistics (13,553 official particle samples, 16.5%, 100% decompiled successfully)

Source: stratified-sample decompile of pak01_dir.vpk. **Full machine-readable statistics ship with the skill**: `dota2_skill(name='dota2-vfx', data='vpcf-stats.json')` returns the complete JSON (all 263 class frequencies, all combo signatures, 962 materials, full parameter quantiles); human-readable version `data='vpcf-official-findings.md'`.

- **Class frequency Top 5** (191,161 instances / 263 classes): `C_INIT_InitFloat` 39,889 → `C_OP_Decay` 11,513 → `C_OP_BasicMovement` 9,812 → `C_OP_InterpolateRadius` 9,114 → `C_OP_RenderSprites` 8,597. **No `C_INIT_RandomLifeTime` or other Random* classes exist in the official corpus** — after compilation they are all the generic `C_INIT_InitFloat` writing property indices.
- **Standard recipe** (the most common combo signature, 1,065 files): `ContinuousEmitter + RenderSprites + [BasicMovement, ColorInterpolate, Decay]`.
- **Typical parameter values**: `m_nMaxParticles` p50=20 / p75=64 / p90=128 / p99=500; `m_flEmitRate` p50=30/s (p90=256); random lifetime (InitFloat field 1, PF_TYPE_RANDOM_UNIFORM) min p50=0.5s, max p50=1.0s (5,903 cases); `m_flConstantLifespan` p50=0.74s; `m_flConstantRadius` p50=20 (p90=180).
- **Material Top** (962 paths): particle_glow_05(486), sparks(466), smoke1(374), particle_glow_04(335), yellowflare2(288).
- **Advanced technique usage**: child particle chains (`m_Children`) 26.6% (average 3.41 direct children, max chain depth 6); control points 79.9%; `m_Constraints` 2.8%; sequence frames (`m_nConstantSequenceNumber`) 8.1%.

### Official recipe library (drop-in combo signatures, sorted by occurrence count)

Source: combo statistics from 12,108 signable files among the 13,553 official samples (stats.json e_combos), with typical parameters (c_params quantiles).

| # | Recipe (Emitter | Renderer | Operators) | Count | Use |
|---|------|------|------|------|
| 1 | ContinuousEmitter | RenderSprites | [BasicMovement, ColorInterpolate, Decay] | 1065 | continuous glow/smoke body |
| 2 | InstantaneousEmitter | RenderSprites | [BasicMovement, ColorInterpolate, Decay] | 738 | burst flash |
| 3 | ContinuousEmitter | RenderSprites | [BasicMovement, Decay, FadeInSimple] | 590 | continuous fade-in glow |
| 4 | InstantaneousEmitter | RenderSprites | [BasicMovement, Decay, FadeOutSimple] | 549 | burst fade-out |
| 5 | InstantaneousEmitter | RenderSprites | [BasicMovement, Decay, FadeInSimple] | 275 | burst fade-in |
| 6 | ContinuousEmitter | RenderRopes | [BasicMovement, ColorInterpolate, Decay] | 254 | light beam/rope trail |
| 7 | ContinuousEmitter | RenderSprites | [BasicMovement, Decay, FadeOutSimple] | 192 | continuous fade-out |
| 8 | ContinuousEmitter | RenderRopes | [BasicMovement, Decay, FadeInSimple] | 157 | rope fade-in |
| 9 | ContinuousEmitter | RenderSprites | [SetFloat, BasicMovement, Decay] | 149 | continuous particles + property-driven |
| 10 | ContinuousEmitter | RenderSprites | [BasicMovement, Decay, InterpolateRadius] | 140 | radius-gradient particles |

Typical parameters (official quantiles): `m_nMaxParticles` 20 (p90=128), `m_flEmitRate` 30/s (p90=256), random lifetime 0.5~1.0s, `m_flConstantRadius` 20 (p90=180), preferred materials particle_glow_05 / sparks / smoke1.

### Full class field reference (263 classes, field-level documentation)

The complete field tables ship with the skill, read via the `dota2_skill` data parameter:

- **Machine-readable**: `data='vpcf-class-fields.json'` (1.6MB: type/default value/source/corpus count and Top values for each field of the 263 classes)
- **Human-readable volumes**: `data='class-ref/operators.md'`, `class-ref/initializers.md`, `class-ref/renderers.md`, `class-ref/emitters.md`, `class-ref/forces.md`, `class-ref/constraints.md`, `class-ref/preemission.md`, `class-ref/enums.md`, `class-ref/base-classes.md` (read `class-ref/README.md` first)

Source: GameTracking-Dota2 engine schema (507 header files, cross-validated against the 13,553 official corpus samples with 0 deviations). Three iron rules of use:

1. **"Corpus set %" is the proportion covered by defaults, not the usage rate** — VRF only outputs fields that differ from the class defaults. If 80% of files omit a field, it usually means 80% want the default (e.g. `RenderSprites.m_nOrientationType` defaults to screen-aligned).
2. **12 in-use classes have been removed from the engine schema** (including rank #10 `C_INIT_CreateWithinSphere`) — successors use `CParticleTransformInput` instead of raw CP indices (`C_INIT_CreateWithinSphereTransform`, etc.). Prefer the new classes when hand-writing.
3. **18 schema classes carry legacy fields** (official assets still write them but the schema removed them, e.g. `C_OP_PositionLock.m_nControlPointNumber` appears 1,418 times) — **it is unsafe to copy decompiled-output field names directly into hand-written sources**; the full legacy table is in `class-ref/README.md`.

### Pitfalls (all verified)

1. Wrong field names are **silently dropped** and fall back to engine defaults (e.g. writing `m_flSpawnRate` → actual m_nParticlesToEmit=100), with no compile error.
2. The compiler does **not** move an emitter/initializer placed in the wrong block — wrong block = wrong behavior.
3. Use `m_ChildRef` external links, don't inline child systems.
4. Choose one of `m_flConstantLifespan` (constant) or `C_INIT_RandomLifeTime` (random), don't mix them.
5. Texture references must use the `resource:"materials/…vtex"` form.
6. InstantaneousEmitter does not show in the Particle Editor static preview.
7. Write `m_hTexture` in source, not `m_vecTexturesInput` (that's the compiled-output form).
8. Decompiled output being ~40x larger than source is the engine filling in defaults, not an error.

## Workflow SOP

1. **Write source file** — `file_write` to `content/dota_addons/<addon>/particles/<name>.vpcf` (KV3 as above), or `file_edit` to tweak an existing one. Editing a source does not require the game; FileOps tools are offline.
2. **Compile** — `dota_compile_asset` with the source path. resourcecompiler emits `game/dota_addons/<addon>/particles/<name>.vpcf_c`. Non-zero exit or stderr means a source syntax error — read the reported line.
3. **Preview** — with the game running (launch your map via `dota_launch_game` if needed) call `vfx_preview` with `particle_path: "particles/<name>.vpcf"` (content-root relative, no `_c`, no addon prefix) and `attach: 8` (PATTACH_WORLDORIGIN) plus an optional `position`. It returns a runtime particle id.
4. **Verify** — do not trust the id alone: read `console_output` for load errors in the Particles/ResourceSystem channels. `pid=0` means the engine rejected the create call; a missing file prints a load failure line.
5. **Stop preview** — `vfx_preview_stop` with the id (runtime instance only; the asset file stays).
6. **Delete asset** — `file_delete` on the source (and recompile or leave stale outputs to `asset_check_refs`).

## Tool mapping table

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

## Common errors reference

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

## Minimal template

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

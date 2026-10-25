---
name: dota2-vfx
description: Use when creating, editing, compiling, or previewing Dota 2 particle effects (.vpcf) — writing particle KV3 sources with file_write/file_edit, compiling with dota_compile_asset, previewing in-game with vfx_preview, or diagnosing particle load failures.
---

# Dota 2 VFX — Particle Effects

This skill owns the particle-effect workflow of the dota2-mcp toolchain: authoring `.vpcf` sources, compiling them, and verifying the result in a running game. It is self-contained for everyday particle work; deeper reference tables grow in the Template-verified field reference section.

**Context budget:** start with `outline`, retrieve only the needed `section`, and use `data_path` for JSON statistics. The full body and full data files are compatibility paths, not the default authoring workflow.

## Core mental model: asset pipeline

Dota 2 assets split across two trees under the Dota 2 install:

- **content/** — the authored **sources** you edit: `content/dota_addons/<addon>/particles/<name>.vpcf` (KV3 text).
- **game/** — the **compiled outputs** the engine loads: `game/dota_addons/<addon>/particles/<name>.vpcf_c` (binary), produced by resourcecompiler.

The engine loads only `game/` outputs. A particle that exists as source but not as compiled output fails to load at runtime (the `uncompiled` bucket of asset_check_refs). The loop is: **write source → compile → preview in game → read load errors → fix**.

## .vpcf authoring quick reference (KV3)

**First principle: work from existing sources.** Every structural fact below is verified against real engine-accepted sources. When you need a shape you haven't seen, copy a working source and change parameters — a guessed field name or a misplaced block can crash the engine on preview.

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
- **Emitters** live in their own `m_Emitters` block: `C_OP_InstantaneousEmitter` takes `m_nParticlesToEmit` (count), `C_OP_ContinuousEmitter` takes `m_flEmitRate` (per second). Wrong field names are silently dropped and fall back to engine defaults (100) — no compile error.

Common emitter/operator/initializer classes seen in the basic template: `C_OP_InstantaneousEmitter`, `C_OP_BasicMovement`, `C_OP_Decay`, `C_OP_FadeOutSimple`, `C_OP_InterpolateRadius`, `C_OP_RenderTrails`, `C_INIT_RandomLifeTime`, `C_INIT_RandomTrailLength`.

## Template-verified field reference

Based on a deep-dive of 18 real template sources, 7 VRF decompiles, and the engine's particle schemas (repo-only `research/vpcf-structure/findings.md`; the research corpus is not part of the npm package).

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

- `C_INIT_CreateWithinSphere`: position fields `m_fRadiusMin/Max`, velocity `m_fSpeedMin/Max`, `m_LocalCoordinateSystemSpeedMin/Max`. Bind the spawn transform with a full `m_TransformInput` struct (`m_bUseOrientation`, `m_nControlPoint`); the legacy `m_nControlPointNumber` and any short struct form are dropped by the compiler (see Pitfalls).
- `C_INIT_CreateWithinBox`: `m_vecMin` / `m_vecMax`.
- `C_INIT_CreateSequentialPath`: `m_flNumToAssign`, `m_PathParams`.
- **Random* are editor shortcuts**, compiled to the generic `C_INIT_InitFloat` writing scalar properties: RandomLifeTime→field 1 (lifetime), RandomRadius→0 (radius), RandomRotation→4, RandomRotationSpeed→5, RandomAlpha→7 (stores 0..1). The full attribute index, with its empirical verification, is `dota2_skill(name='dota2-vfx', data='vpcf-official-findings.md', section='3.4 Random lifetime — there is no C_INIT_RandomLifeTime')`; keep the two in step. Also RandomColor / RandomYawFlip / RandomTrailLength / InitialVelocityNoise / RemapParticleCountToScalar.

### Common Operators (m_Operators) and ForceGenerators

- Movement/appearance: `C_OP_BasicMovement` (`m_Gravity`, `m_fDrag`), `C_OP_MaxVelocity`, `C_OP_PositionLock`, `C_OP_OscillateVector`, `C_OP_SpinUpdate`.
- Lifetime/fade: `C_OP_Decay` (`m_nOpEndCapState`), `C_OP_InterpolateRadius` (`m_flStartScale/EndScale/Bias`), `C_OP_FadeInSimple`, `C_OP_FadeOutSimple`, `C_OP_ColorInterpolate` (`m_ColorFade`, `m_flFadeStartTime`).
- Control points: `C_OP_SetChildControlPoints` (`m_nFirstControlPoint`), `C_OP_SetSingleControlPointPosition` (the pre-emission class is auto-moved by the compiler into `m_PreEmissionOperators`).
- Forces: `C_OP_RandomForce`, `C_OP_TurbulenceForce`, `C_OP_AttractToControlPoint`.

### Official corpus statistics (13,553 official particle samples, 16.5%, 100% decompiled successfully)

Source: stratified-sample decompile of pak01_dir.vpk. **Machine-readable statistics ship with the skill**: use `dota2_skill(name='dota2-vfx', data='vpcf-stats.json', data_path='e_combos.top10')` for only the recipe table, or another JSON dot-path for class frequencies, materials, or parameter quantiles. The human-readable report supports `data='vpcf-official-findings.md', section='<heading>'`; request only the relevant section rather than the full report.

- **Advanced techniques**: child systems (`m_Children`) and control points are common in official content; constraints and forces are rare.

### Official recipe library (drop-in combo signatures, sorted by occurrence count)

Source: combo statistics from 12,108 signable files among the 13,553 official samples (the `e_combos` section of [vpcf-stats.json](data/vpcf-stats.json)), with typical parameters (c_params quantiles).

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

The complete field tables are research artifacts, kept out of the npm package (see the owning Agent Note): machine-readable `vpcf-class-fields.json` (type/default value/source/corpus count and Top values for each field of the 263 classes) plus nine human-readable volumes, under [`research/vpcf-field-reference/`](../../research/vpcf-field-reference/class-ref/README.md) in this repo — read the class-ref README first; 143 schema classes are never used by official content (the appendix there).

Source: GameTracking-Dota2 engine schema (507 header files, cross-validated against the 13,553 official corpus samples with 0 deviations). Three iron rules of use:

1. **"Corpus set %" is the proportion covered by defaults, not the usage rate** — VRF only outputs fields that differ from the class defaults. If 80% of files omit a field, it usually means 80% want the default (e.g. `RenderSprites.m_nOrientationType` defaults to screen-aligned).
2. **12 in-use classes have been removed from the engine schema** (including rank #10 `C_INIT_CreateWithinSphere`) — successors use `CParticleTransformInput` instead of raw CP indices (`C_INIT_CreateWithinSphereTransform`, etc.). Prefer the new classes when hand-writing.
3. **18 schema classes carry legacy fields** (official assets still write them but the schema removed them, e.g. `C_OP_PositionLock.m_nControlPointNumber` appears 1,418 times) — **it is unsafe to copy decompiled-output field names directly into hand-written sources**; the full legacy table is in `research/vpcf-field-reference/class-ref/README.md`.

### Pitfalls (all verified)

1. Wrong field names are **silently dropped** and fall back to engine defaults (e.g. writing `m_flSpawnRate` → actual m_nParticlesToEmit=100), with no compile error.
2. **`m_nControlPointNumber` is one of those dropped names**, and so is any struct written short. Use `m_TransformInput` with its full field set (`m_bUseOrientation`, `m_nControlPoint`). Without the binding the system never follows the control point, so `SetParticleControl(pid, 0, position)` does nothing and the effect stays at the world origin — while the create call still returns a valid id and the system still appears in `cl_particles_dumpsimlist`. Verify by decompiling your own `.vpcf_c`: the initializer must carry `m_TransformInput` with a control point.
3. **Precache decides whether anything is drawn.** The client renders only systems it loaded at map start, so the path must appear in the addon's `Precache(context)` as `PrecacheResource( "particle", "particles/…vpcf", context )`. Precaching runs at load time, so a runtime `PrecacheResource` call leaves the asset unloaded. A missing entry shows a valid id, a live entry in `cl_particles_dumpsimlist`, and an empty screen.
4. The compiler does **not** move an emitter/initializer placed in the wrong block — wrong block = wrong behavior.
5. Use `m_ChildRef` external links to compose child systems.
6. Choose one of `m_flConstantLifespan` (constant) or `C_INIT_RandomLifeTime` (random) for a given system.
7. Texture references must use the `resource:"materials/…vtex"` form.
8. InstantaneousEmitter does not show in the Particle Editor static preview.
9. Write `m_hTexture` in source, not `m_vecTexturesInput` (that's the compiled-output form).
10. Decompiled output being ~40x larger than source is the engine filling in defaults, not an error.

## Workflow SOP

1. **Write source file** — `file_write` to `content/dota_addons/<addon>/particles/<name>.vpcf` (KV3 as above), or `file_edit` to tweak an existing one. Editing a source does not require the game; FileOps tools are offline.
2. **Compile** — `dota_compile_asset` with the source path. resourcecompiler emits `game/dota_addons/<addon>/particles/<name>.vpcf_c`. Non-zero exit or stderr means a source syntax error — read the reported line.
3. **Precache** — add `PrecacheResource( "particle", "particles/<name>.vpcf", context )` to the addon's `Precache(context)` in `scripts/vscripts/addon_game_mode.lua`, then reload the map. A missing entry produces a valid id, a live entry in `cl_particles_dumpsimlist`, and an empty screen, because the client renders only what the map load registered — so the fix is the load-time entry plus a reload, where a later runtime precache call leaves the client without the asset.
4. **Preview** — with the game running (launch your map via `dota_launch_game` if needed) call `vfx_preview` with `particle_path: "particles/<name>.vpcf"` (content-root relative, no `_c`, no addon prefix) and `attach: 8` (PATTACH_WORLDORIGIN) plus a visible `position`, such as the player's hero origin. It returns a runtime particle id; the call executes server Lua through the `dota_run_lua` channel.
5. **Verify visually and in the console** — confirm the effect in a screenshot before treating the preview as successful. Read `console_output` for load errors in the Particles/ResourceSystem channels; `pid=0` means the create call failed. Take `dota_screenshot` with the effect visible, then call `vfx_preview_stop` and take another to confirm the runtime instance disappeared. A nonzero id proves creation only, so check the renderer, the control-point binding, the precache entry, and the camera. A screenshot marked `stale: true` is an old frame: capture again, and when the game window is unfocused, temporarily set `r_always_render_all_windows 1` and restore it to `0` afterward. Use an addon-precached particle as the control, because engine particles render without an addon precache and say nothing about your own asset. When a live frame shows nothing, decompile the compiled `_c` and confirm the initializer carries the control point before touching any other field.
6. **Stop preview** — `vfx_preview_stop` with the id (runtime instance only; the asset file stays).
7. **Delete asset** — `file_delete` on the source (and recompile or leave stale outputs to `asset_check_refs`).

## Tool mapping table

| Step | Tool | Notes |
|------|------|-------|
| Create/edit source | `file_write` / `file_edit` | offline; addon-scoped paths only |
| Delete source | `file_delete` | offline |
| Compile | `dota_compile_asset` | resourcecompiler; sources → game/ `_c` |
| Inspect compiled asset | `asset_inspect` | offline; VRF decompile + summary |
| Check reference integrity | `asset_check_refs` | offline; ok/uncompiled/engine_refs/broken |
| Preview in game | `vfx_preview` | gated (needs game + vconsole + `sv_cheats=1`); returns pid |
| Stop preview | `vfx_preview_stop` | gated (same requirements) |
| Verify visibility | `dota_screenshot` | compare before/after and after stop; does not need console |
| Read load errors | `console_output` | channels Particles / ResourceSystem |

## Common errors reference

| Symptom | Cause | Fix |
|---------|-------|-----|
| `dota_launch_game` stuck at `(unknown)` / menu | addon not launchable | declare the map in `game/dota_addons/<addon>/addoninfo.txt` (`AddonInfo { maps "<map>" IsPlayable "1" }`) — the basic template generates an empty KV3 `{}` |
| Map never loads after addoninfo fixed | map not compiled | run resourcecompiler on `content/.../maps/<map>.vmap` (emits `game/maps/<map>.vpk`) before launching |
| `vfx_preview` returns `pid=0` | engine rejected the create call (file missing/uncompiled/wrong path) | check the path is content-root relative without `_c`; compile the source; read console_output Particles/ResourceSystem for the load failure line |
| Game stuck in `CUSTOM_GAME_SETUP` | addon never calls `GameRules:FinishCustomGameSetup()` (basic template doesn't) | `dota_run_lua` with code `GameRules:FinishCustomGameSetup()` |
| Particle loads but shows nothing | missing renderer, control point position off-screen, or effect not in camera view | include `m_Renderers` (the minimal template shows `C_OP_RenderSprites`), pass a visible `position`, and compare `dota_screenshot` before/after creation |
| Particle Editor preview shows nothing | `C_OP_InstantaneousEmitter` fires once at t=0 and the editor's static preview is past it | use `C_OP_ContinuousEmitter` for editor-visible particles; burst-style particles only show in the live game (or the editor's simulate/play) |
| Editor preview shows nothing, asset crashes on preview | hand-written structure with guessed fields (e.g. `m_vecTexturesInput` on RenderSprites — that's RenderTrails' field; emitter placed in m_Operators instead of m_Emitters) | copy a known-good source asset and change parameters |
| `asset_check_refs` reports `uncompiled` | source exists, compiled output missing | run dota_compile_asset on the source |

## Minimal template

A minimal continuous glow. The renderer is required: emitters create simulation particles, but without `m_Renderers` nothing is drawn. The initializer binds control point 0, so the position passed to the preview actually places the effect, and the file must be listed in the addon's `Precache(context)`, because the client draws only what the map load registered. Retrieve only this section with `dota2_skill(name='dota2-vfx', section='Minimal template')`; use `outline` and `section` for other prose, and `data_path` for small slices of JSON statistics instead of reading the whole skill or data file.

```
<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:generic:version{7412167c-06e9-4698-aff2-e63eb59037e7} -->
{
  _class = "CParticleSystemDefinition"
  m_ConstantColor = [ 255, 0, 255, 255 ]
  m_flConstantRadius = 160.0
  m_flConstantLifespan = 10.0
  m_nMaxParticles = 4
  m_Operators =
  [
    { _class = "C_OP_BasicMovement" },
    { _class = "C_OP_Decay" },
  ]
  m_Renderers =
  [
    {
      _class = "C_OP_RenderSprites"
      m_bAdditive = true
      m_hTexture = resource:"materials/particle/basic_glow.vtex"
    },
  ]
  m_Initializers =
  [
    {
      _class = "C_INIT_CreateWithinSphere"
      m_TransformInput =
      {
        m_bUseOrientation = false
        m_nControlPoint = 0
      }
    },
  ]
  m_Emitters =
  [
    { _class = "C_OP_ContinuousEmitter" m_flEmitRate = 1.0 },
  ]
}
```

`m_TransformInput` is what makes the effect follow control point 0. It must be written as the full struct shown above: a short form such as `m_TransformInput = { m_nControlPoint = 0 }` is dropped by the compiler without a warning, the system then stays at the world origin, and you get a valid id and a live simulation entry for an effect nobody can see.

## Recipe: AoE telegraph + impact

A ground marker that pins an exact radius for a fixed wind-up, then fires a short burst. Retrieve with `dota2_skill(name='dota2-vfx', section='Recipe: AoE telegraph + impact')`.

**Assets** — one parent, two children, one texture:

| File | Role |
|------|------|
| `particles/<addon>/aoe_telegraph/aoe.vpcf` | Parent, owns only `m_Children` |
| `.../telegraph.vpcf` | The ground ring |
| `.../impact.vpcf` | The burst at the marker |
| `materials/particle/<ring>.vtex` | Ring sprite: alpha peaks at radius 0.90 with a 0.22 fill inside |

The parent carries no particles of its own:

```
m_Children =
[
  { m_ChildRef = resource:"particles/<addon>/aoe_telegraph/telegraph.vpcf" },
  { m_ChildRef = resource:"particles/<addon>/aoe_telegraph/impact.vpcf" m_flDelay = 1.5 },
]
```

**Runtime mapping** — control point 0 is the ground position; the caller sets it with `SetParticleControl(pid, 0, position)` using the entity's `GetAbsOrigin()`, so the ring lands where the unit stands. No attachment index and no orientation control point are needed.

**Telegraph child** — one sprite, sized to the gameplay radius, laid flat:

```
m_flConstantRadius = 500.0        // sprite radius = the ability's radius
m_flConstantLifespan = 1.5        // equals the parent's m_flDelay
m_Emitters = [ { _class = "C_OP_InstantaneousEmitter" m_nParticlesToEmit = 1 } ]
m_Renderers = [ { _class = "C_OP_RenderSprites" m_bAdditive = true
                  m_nOrientationType = "PARTICLE_ORIENTATION_WORLD_Z_ALIGNED"
                  m_hTexture = resource:"materials/particle/<ring>.vtex" } ]
```

`WORLD_Z_ALIGNED` is what makes it a ground marker: the default screen-aligned sprite stands upright at ground height and its lower half disappears under the terrain. Add `C_OP_FadeInSimple 0.15` and `C_OP_FadeOutSimple 0.35` so the ring arrives and leaves instead of popping.

**Impact child** — a one-shot burst inside the marked circle: `m_nParticlesToEmit = 10`, `C_INIT_RandomRadius` 90–170, `C_INIT_RandomLifeTime` 0.3–0.55, `C_INIT_CreateWithinSphere` with `m_fRadiusMax` equal to the ring radius, `C_OP_FadeOutSimple 0.4`, lifespan 0.5.

**Integration** — create on the ability/modifier and destroy with it:

```lua
function modifier_<name>:OnCreated()
  if not IsServer() then return end
  self.pid = ParticleManager:CreateParticle("particles/<addon>/aoe_telegraph/aoe.vpcf", PATTACH_WORLDORIGIN, nil)
  ParticleManager:SetParticleControl(self.pid, 0, self:GetParent():GetAbsOrigin())
end
function modifier_<name>:OnDestroy()
  if IsServer() and self.pid then
    ParticleManager:DestroyParticle(self.pid, false)
    self.pid = nil
  end
end
```

**Budget and evidence** — peak 11 additive sprites in two collections (1 ring + 10 burst), all with a shared texture and no deferred light; per-frame cost is not yet measured, so treat the sprite count as the budget and re-measure before stacking several telegraphs. Timed capture at 0.7 s shows the flat ring at the control point, at 1.6 s the ring is gone and the burst is centred on it, at 2.1 s the scene is clear again. Both files must be listed in the addon's `Precache(context)`.

## Recipe: Projectile + trail + impact

A moving source that leaves a trail and bursts where it lands. Retrieve with `dota2_skill(name='dota2-vfx', section='Recipe: Projectile + trail + impact')`.

**Assets** — one parent, three children: `projectile.vpcf` (children only), `head.vpcf`, `trail.vpcf`, `impact.vpcf`.

The parent is the moving system; it owns no particles:

```
m_Children =
[
  { m_ChildRef = resource:"particles/<addon>/projectile/head.vpcf" },
  { m_ChildRef = resource:"particles/<addon>/projectile/trail.vpcf" },
]
```

**Why the head moves and the trail stays.** Both children spawn particles at control point 0, and neither uses a follow or lock operator. The difference is lifetime:

| Child | Emit rate | Lifetime | Result |
|-------|-----------|----------|--------|
| `head` | 45/s | 0.08 s | every particle dies and respawns on CP0, so the glow rides the control point |
| `trail` | 70/s | 0.35 s | particles stay where they spawned, so moving CP0 leaves them behind |

A long lifetime on the head turns it into a second trail; a short lifetime on the trail breaks the ribbon. Size the head above the trail (55 vs 34 here) so the leading edge reads as the head.

**Runtime mapping** — control point 0 is the projectile position, and the ability updates it every frame:

```lua
function modifier_<name>:OnIntervalThink()
  ParticleManager:SetParticleControl(self.pid, 0, self:GetParent():GetAbsOrigin())
end
```

Create the system with `PATTACH_WORLDORIGIN` and set CP0 in the same call that creates it — a system whose CP0 is never set sits at the world origin, off-screen.

**Impact is spawned separately, not as a delayed child.** The landing point depends on how far the projectile travels, so the hit creates its own instance at the arrival position and the ability destroys both.

```lua
local hit = ParticleManager:CreateParticle("particles/<addon>/projectile/impact.vpcf", PATTACH_WORLDORIGIN, nil)
ParticleManager:SetParticleControl(hit, 0, landing)
```

`impact.vpcf` is a one-shot: `m_nParticlesToEmit = 14`, `C_INIT_CreateWithinSphere` with a 120 radius around CP0, `C_OP_InterpolateRadius` from 0.4, `C_OP_FadeOutSimple 0.35`, lifespan 0.45.

**Budget and evidence** — peak ≈ 4 head + 25 trail + 14 impact ≈ 43 additive sprites across four collections, one shared texture, no deferred light; per-frame cost is not yet measured. A travel capture shows the bright head with the trail behind it, and a separate capture shows the burst at the impact position. The test harness stepped CP0 by hand every ~90 ms, so its trail appears as discrete blobs; at frame rate the same asset draws a continuous ribbon.

Both children and the impact must be listed in the addon's `Precache(context)`.

## Recipe: Persistent buff/debuff aura

A looping effect attached to a unit that lasts as long as the modifier does. Retrieve with `dota2_skill(name='dota2-vfx', section='Recipe: Persistent buff/debuff aura')`.

**One asset, no parent.** `aura.vpcf` is a single continuous system; nothing orbits or moves independently, so a parent with children would only add collections.

**Runtime mapping** — attach it to the unit rather than positioning it:

```lua
self.pid = ParticleManager:CreateParticle("particles/<addon>/aura/aura.vpcf", PATTACH_ABSORIGIN_FOLLOW, self:GetParent())
```

`PATTACH_ABSORIGIN_FOLLOW` makes the engine re-anchor the system every frame, so the aura follows movement, teleports and turns with no `SetParticleControl` calls at all. This is the difference from the telegraph and projectile recipes: those own their control point because the position is gameplay data, while an aura's position is the entity it is attached to.

**Loop lifecycle** — a continuous emitter with no end and a lifetime shorter than any buff:

```
m_flConstantLifespan = 0.9
m_Emitters = [ { _class = "C_OP_ContinuousEmitter" m_flEmitRate = 34.0 } ]
m_Operators = [ C_OP_BasicMovement, C_OP_Decay,
                C_OP_InterpolateRadius (m_flStartScale 0.4),
                C_OP_FadeInSimple (0.15), C_OP_FadeOutSimple (0.45) ]
m_Initializers = [ C_INIT_CreateWithinSphere (m_fRadiusMax 70, full m_TransformInput),
                   C_INIT_InitialVelocityNoise (30–65 upward) ]
```

The fade-in and fade-out on every particle make the loop read as breathing rather than as a hard particle churn; the upward velocity drift stops it from looking like a static sphere.

**Team colour.** Colour lives in the asset (`m_ConstantColor`), so a buff and a debuff are two files that differ only in that line. A single asset tinted per team through a control point needs a colour operator the project has not verified yet; until then, ship one asset per colour role and keep the durations in data.

**Stop and cleanup** — destroy on modifier removal, with `true` for an instant cut and `false` to let the existing particles fade:

```lua
function modifier_<name>:OnDestroy()
  if IsServer() and self.pid then
    ParticleManager:DestroyParticle(self.pid, true)
    self.pid = nil
  end
end
```

**Budget and evidence** — peak ≈ 34/s × 0.9 s ≈ 31 additive sprites in one collection with one shared texture; per-frame cost is not yet measured, and an aura is usually on several units at once, so re-measure with a full team before shipping. Captures: the aura sits on the unit, it stays on the unit after a 260-unit teleport, and the scene is clear after `DestroyParticle`.

The asset must be listed in the addon's `Precache(context)`.

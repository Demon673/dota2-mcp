# Dota 2 .vpcf Particle System — Structure Reference

Deep-dive into the Dota 2 vpcf (KV3 particle) format, distilled for writing the
built-in `dota2-vfx` skill. Every claim carries a source tag resolved in
[Sources](#sources).

## TL;DR — the single most important insight

A hand-authored `.vpcf` is a **loose KV3 shorthand**. The resourcecompiler
normalizes it into a **canonical schema**: plain numbers become typed
`ParticleFloat`/`ParticleVec` values, enum-ints become enum strings,
and a single texture field becomes an array. The VRF decompiler
(`asset_inspect`) shows the *canonical, default-injected* form, so a
decompiled file always looks much fatter than the source you wrote. This is
normal, not an error.

- Source header: `format:generic:version{7412167c-…}` — the `generic` is a
  placeholder the compiler replaces with a concrete `format:vpcfNN` (observed
  `vpcf45` for the basic templates, `vpcf66` for a later-authored file).
  [decompiled: basic_ambient.vpcf_c / test_burst.vpcf_c]
- `m_flConstantRadius = 90.000000` (source) → `m_flConstantRadius = 90.0`
  (decompiled): only float formatting changes. [src/decompiled: basic_ambient]
- `m_flEmitRate = 16.0` (source, plain float) → `m_flEmitRate = { m_nType = "PF_TYPE_LITERAL", m_flLiteralValue = 16.0 }` (decompiled): emitter rate is a
  *ParticleFloat*, not a plain float. [src/decompiled: basic_ambient]

---

## A. Top-level block list (KV3 root = `CParticleSystemDefinition`)

Authoritative block order comes from the engine schema's KV3 defaults
[`schema: CParticleSystemDefinition.h`]. The root object is
`_class = "CParticleSystemDefinition"`. Its function-vector blocks, in engine
execution order:

| Block | C++ vector type | Role |
|-------|-----------------|------|
| `m_PreEmissionOperators` | `CParticleFunctionPreEmission` | operators that run **once before the first emission** (e.g. set a control point) |
| `m_Emitters` | `CParticleFunctionEmitter` | spawn particles (`C_OP_*Emitter`) |
| `m_Initializers` | `CParticleFunctionInitializer` | set each new particle's attributes (`C_INIT_*`) |
| `m_Operators` | `CParticleFunctionOperator` | per-frame per-particle behavior (`C_OP_*`) |
| `m_ForceGenerators` | `CParticleFunctionForce` | continuous forces (`C_OP_*Force`) |
| `m_Constraints` | `CParticleFunctionConstraint` | positional constraints (none used by the templates) |
| `m_Renderers` | `CParticleFunctionRenderer` | draw particles (`C_OP_Render*`) |
| `m_Children` | `ParticleChildrenInfo_t` | child particle systems |

All eight appear in the schema; the templates exercise all of them **except**
`m_Constraints`. [schema: CParticleSystemDefinition.h; src: all templates]

Other notable root scalars (schema defaults in parentheses):

- `m_nMaxParticles` (1000) — particle budget. Always set explicitly in the
  templates (4…128). [schema; src: all]
- `m_nInitialParticles` (0) — particles emitted at spawn *before* time 0.
  Used once: `basic_projectile_launch.vpcf` = 16. [schema; src: launch]
- `m_ConstantColor` (white) — RGB(A) tint applied to all particles.
  `basic_ambient` = [190,190,190,255]. [schema; src: basic_ambient]
- `m_flConstantRadius` (5.0) — base radius; `m_flConstantRotation`,
  `m_flConstantRotationSpeed`, `m_flConstantLifespan` (1.0) — constant
  fallbacks used when no initializer sets the attribute. [schema]
- `m_nConstantSequenceNumber` (0) — legacy/animation sequence id, used by the
  projectile templates (6, 7). [schema; src: basic_projectile, basic_explosion_bits]
- `m_BoundingBoxMin`/`Max` ([-10,-10,-10]/[10,10,10]) — cull bounds bloat;
  `basic_rope` overrides them. [schema; src: basic_rope]
- `m_bShouldSort` (true) — depth sort; `basic_projectile` sets `false`. [schema; src: basic_projectile]
- `m_nBehaviorVersion` (0) — engine-stamped version id, present in every
  decompiled output but never written by hand. [decompiled: all]
- `m_nFirstMultipleOverride_BackwardCompat` (-1) — engine-stamped backward-compat
  id (decompiled only). [decompiled: basic_ambient, basic_rope]

### m_Children — child particle systems

Each entry is a `ParticleChildrenInfo_t` with defaults
[`schema: ParticleChildrenInfo_t.h`]:

- `m_ChildRef` ("") — `resource:"particles/<path>.vpcf"` to another system
  (content-root relative, **no** addon prefix, **no** `_c` suffix). [src: basic_explosion, basic_projectile]
- `m_flDelay` (0.0) — delay before the child starts. [schema]
- `m_bEndCap` (false) — child plays as the "end cap" when the parent particle
  dies (see `m_nOpEndCapState`). `basic_projectile` marks its explosion child
  `m_bEndCap = true`. [schema; src: basic_projectile]
- `m_bDisableChild` (false), `m_nDetailLevel` (`"PARTICLEDETAIL_LOW"`). [schema]

Two child forms exist:
1. **Reference** (canonical): `{ m_ChildRef = resource:"…" [, m_bEndCap = true] }`.
   Used by every template. [src: basic_explosion, basic_projectile, basic_projectile_explosion]
2. **Inline definition**: `{ _class = "CParticleSystemDefinition", m_Operators = […] }`
   — compiles (the compiler keeps it as an inline child), but is non-idiomatic and
   error-prone; only seen in the deliberately-broken `test_burst.vpcf`. [src/decompiled: test_burst]

A pure container (e.g. `basic_explosion.vpcf`) is a legal system with only
`m_nMaxParticles` + `m_Children`. Its readme explains the purpose: a parent
container gives full control over child sort order. [src: basic_explosion.vpcf + readme]

---

## B. Emitters (`m_Emitters`) — `C_OP_*Emitter`

Inventory (schema dir lists exactly 5 emitter classes)
[`schema-dir`]: `C_OP_ContinuousEmitter`, `C_OP_InstantaneousEmitter`,
`C_OP_MaintainEmitter`, `C_OP_NoiseEmitter`, `C_OP_RenderVolumetricEmitter`.
Only the first two appear in the templates.

### C_OP_InstantaneousEmitter — fire once, then stop
Key fields [schema: C_OP_InstantaneousEmitter.h; src: basic_explosion_bits, basic_trail]:

- `m_nParticlesToEmit` — **count** of particles to emit (a ParticleFloat,
  default literal **100**). Typical template values: 1, 3, 8, 16, 32. [src]
- `m_flStartTime` — delay before emitting (ParticleFloat, default 0). [schema]
- `m_nMaxEmittedPerFrame` (-1 = unlimited). [schema]

> **The field is `m_nParticlesToEmit`, not `m_flSpawnRate`.** `test_burst.vpcf`
> wrote `m_flSpawnRate = 48`; the compiler silently dropped the unknown field and
> fell back to the default 100 (confirmed in the decompiled output). [src/decompiled: test_burst]

### C_OP_ContinuousEmitter — emit at a rate forever
Key fields [schema: C_OP_ContinuousEmitter.h; src: basic_ambient, basic_projectile_trail, glow_burst]:

- `m_flEmitRate` — **rate per second** (ParticleFloat, default literal **100**).
  Template values: 16, 20, 64. [src]
- `m_flEmissionDuration` (ParticleFloat, default 0 = **infinite**) — set a
  non-zero value for a burst-over-time. [schema]
- `m_flStartTime` (ParticleFloat, default 0). [schema]
- `m_bForceEmitOnFirstUpdate` / `m_bForceEmitOnLastUpdate` (false). [schema]

Both emitters also carry `m_nEventType` (`"PARTICLE_EVENT_TYPE_MASK_KILLED"`),
`m_nSnapshotControlPoint` (-1), `m_strSnapshotSubset` (""). [schema]

### Editor preview behavior (the key difference)

- **ContinuousEmitter** emits every frame, so it is visible in the particle
  editor's static/looping preview and keeps adding particles. `basic_ambient`
  is documented as "emit continuously over time and never stop playing on their
  own". [src: basic_ambient_readme.txt]
- **InstantaneousEmitter** fires its `m_nParticlesToEmit` particles **once at
  t=0** and then emits nothing. The editor's static preview is typically past
  t=0, so a burst/explosion shows **nothing** until you press play/simulate or
  see it in the live game. [src: basic_explosion_readme.txt; existing dota2-vfx skill pitfall row]

The m_Emitters block itself is *not* where burst-type particle budgets are
handled — that's `m_nMaxParticles`.

---

## C. Renderers (`m_Renderers`) — `C_OP_Render*`

Renderer inventory from the schema dir (38 classes): sprites, trails, ropes,
models, deferred/omni/standard lights, points, blobs, decals, screen-space
effects, screen shake, sound, cables, cloth force, etc.
[`schema-dir`]. Templates use four.

### Cross-cutting: texture & blend shorthands (all renderers)

- **Source shorthand** `m_hTexture = resource:"materials/…vtex"` (single) is
  compiled into `m_vecTexturesInput = [ { m_hTexture = resource:"…" } ]` (array).
  [src: basic_ambient (RenderSprites), basic_explosion_bits (RenderTrails), basic_rope (RenderRopes)] → [decompiled: same]
- **Source shorthand** `m_bAdditive = true` compiles to
  `m_nOutputBlendMode = "PARTICLE_OUTPUT_BLEND_MODE_ADD"`. Blend enum:
  `ALPHA=0, ADD=1, BLEND_ADD=2, HALF_BLEND_ADD=3, NEG_HALF_BLEND_ADD=4, MOD2X=5, LIGHTEN=6`. [src: basic_trail → decompiled; schema: ParticleOutputBlendMode_t.h]
- `m_flSelfIllumAmount` / `m_flDiffuseAmount` (0..1) control unlit vs lit
  shading; additive glows set selfillum high, diffuse ~0. [src: basic_projectile_trail, basic_explosion_burst]

### C_OP_RenderSprites — billboarded sprites
Common source fields [src: basic_ambient, basic_explosion_flash, glow_burst, basic_projectile_explosion]:

- `m_hTexture` — single texture (compiles to `m_vecTexturesInput`).
- `m_flAnimationRate` — sprite sheet frame rate.
- `m_bAdditive`, `m_flSelfIllumAmount`, `m_flDiffuseAmount`.
- `m_bPerVertexLighting` — lit per vertex (`basic_projectile_explosion`). [src]

Additional schema fields (sprite-specific): `m_nOrientationType`
(`"PARTICLE_ORIENTATION_SCREEN_ALIGNED"` default), `m_flMinSize`/`m_flMaxSize`,
`m_flStartFadeSize`/`m_flEndFadeSize`, `m_flSubPixelAAScale` (0.75),
`m_bBlendFramesSeq0`. [schema: C_OP_RenderSprites.h]

### C_OP_RenderTrails — stretched trails along the velocity/path
Common source fields [src: basic_explosion_bits, basic_trail]:

- `m_hTexture` (compiles to `m_vecTexturesInput`).
- `m_flLengthScale` — trail length multiplier (1.5 in bits). [src]
- `m_flSelfIllumAmount`, `m_flDiffuseAmount`, `m_bAdditive`. [src]
- Trail renderer fields in the schema: `m_flRadiusTaper`, `m_nMinTesselation`
  (1) / `m_nMaxTesselation` (128), `m_flTextureVWorldSize`, `m_flTextureVScrollRate`. [schema: C_OP_RenderTrails.h]

### C_OP_RenderRopes — a rope/ribbon of connected particles
Source fields [src: basic_rope]: `m_hTexture` (→ `m_vecTexturesInput`),
`m_flTextureVWorldSize` (200), `m_flTextureVScrollRate` (800),
`m_flSelfIllumAmount` (0.8), `m_flDiffuseAmount` (0.2), `m_bAdditive`. [src]
The high V-scroll rate is what gives the rope its "turbulent energy" look. [src: basic_rope_readme.txt]

### C_OP_RenderDeferredLight — a deferred light per particle
Source fields [src: basic_explosion_burst]:

- `m_hTexture` — **single** texture (unlike sprites/trails, this renderer keeps
  `m_hTexture` even in canonical form — see schema). [src → decompiled: basic_explosion_burst]
- `m_flRadiusScale` (2.0), `m_flAlphaScale` (4.0), `m_flStartFalloff` (0.5). [src]
- `m_ColorScale = [255,215,45]` (source) → `m_vecColorScale = { m_nType = "PVEC_TYPE_LITERAL_COLOR", m_LiteralColor = [255,215,45] }` (canonical). [src → decompiled: basic_explosion_burst]
- More schema fields: `m_flLightDistance`, `m_flDistanceFalloff`,
  `m_flSpotFoV` (60), `m_nColorBlendType` (`"PARTICLE_COLOR_BLEND_MULTIPLY"`),
  `m_nHSVShiftControlPoint` (-1). [schema: C_OP_RenderDeferredLight.h]

> Multiple renderers per system are normal — `basic_explosion_burst` pairs a
> sprite renderer with a deferred light renderer. [src: basic_explosion_burst + readme]

---

## D. Common initializers (`m_Initializers`) — `C_INIT_*`

The schema dir has ~90 initializer classes. [schema-dir]. Templates use these.

### Position/spawn shape
- **C_INIT_CreateWithinSphere** — spawn in/on a sphere. Fields: `m_fRadiusMin`/
  `m_fRadiusMax` (radius), `m_fSpeedMin`/`m_fSpeedMax` (outward speed),
  `m_LocalCoordinateSystemSpeedMin`/`Max` (a vec3 speed added in the local
  frame, e.g. upward bias [0,0,50]), `m_nControlPointNumber` (which CP is the
  center; 0=origin by default, 3/9 for child systems of a projectile). [src: basic_ambient, basic_explosion_bits, basic_projectile_*]
- **C_INIT_CreateWithinBox** — spawn in an AABB. Fields: `m_vecMin`/`m_vecMax`
  (box corners), `m_nControlPointNumber`. [src: basic_explosion_burst]
- **C_INIT_CreateSequentialPath** — place particles sequentially along a CP path.
  Fields: `m_flNumToAssign`, `m_PathParams = { m_nEndControlPointNumber }`. [src: basic_rope]

### Random attribute shortcuts (each compiles down to a C_INIT_InitFloat)
This is the key decompile finding: the named `Random*` initializers are
**editor shortcuts** that compile into a generic `C_INIT_InitFloat` writing one
particle float attribute via `m_nOutputField`. [src → decompiled: basic_ambient, basic_explosion_burst, basic_rope]

| Shortcut initializer | Source fields | Compiles to `m_nOutputField` (attribute) |
|----------------------|---------------|-------------------------------------------|
| `C_INIT_RandomLifeTime` | `m_fLifetimeMin/Max` | **1** (lifetime) |
| `C_INIT_RandomRadius` | `m_flRadiusMin/Max` | **0** (radius, default) |
| `C_INIT_RandomRotation` | (none) | **4** (rotation, 0..360 with sign flip) |
| `C_INIT_RandomRotationSpeed` | `m_flDegreesMax` (and `m_flDegreesMin`) | **5** (rotation speed, sign flip) |
| `C_INIT_RandomAlpha` | `m_nAlphaMin/Max` (0–255) | **7** (alpha; values stored 0..1, e.g. 120/255=0.4706) |

[src: basic_ambient, basic_explosion_burst; decompiled: basic_ambient, basic_explosion_burst]

The generic form they expand to:
`{ _class = "C_INIT_InitFloat", m_InputValue = { m_nType = "PF_TYPE_RANDOM_UNIFORM", m_flRandomMin = …, m_flRandomMax = …, m_nRandomMode = "PF_RANDOM_MODE_CONSTANT", [m_bHasRandomSignFlip = true] }, m_nOutputField = N }`. [decompiled: basic_ambient]

So the **particle scalar attribute index** (confirmed empirically):
`0 = radius, 1 = lifetime, 4 = rotation, 5 = rotation speed, 7 = alpha`.
Schema defaults corroborate the same index space (`m_nScalarFieldForTextureCoordinate = 8`,
`m_nAlphaTestPointField = 13`, `m_nAlpha2Field = 16`, `m_nVectorFieldForOrientation = 21`). [decompiled + schema]

### Other initializers used
- **C_INIT_RandomColor** — `m_ColorMin`/`m_ColorMax` (RGBA 0–255). [src: basic_explosion_bits, basic_projectile_*, basic_trail]
- **C_INIT_RandomYawFlip** — no fields; flips sprite yaw randomly. [src: basic_ambient, basic_explosion_burst, glow_burst]
- **C_INIT_RandomTrailLength** — `m_flMinLength`/`m_flMaxLength` (trail length). [src: basic_explosion_bits]
- **C_INIT_InitialVelocityNoise** — `m_vecOutputMin`/`Max`, `m_flNoiseScale`,
  `m_flNoiseScaleLoc`. [src: basic_projectile_trail]
- **C_INIT_RemapParticleCountToScalar** — remap a particle's index-in-emission to
  a scalar attribute. Fields: `m_nFieldOutput` (7=alpha), `m_nInputMin/Max`,
  `m_flOutputMin/Max`, `m_bActiveRange` (ignore inputs outside the local
  range instead of clamping). `basic_rope` uses three of them to fade the rope's
  two ends. [src: basic_rope + readme]
- **C_INIT_InitFloat** — the generic typed writer (see table above); write it
  directly when you need a non-uniform distribution or a different attribute. [decompiled]

---

## E. Common operators (`m_Operators`) — `C_OP_*`

The schema dir has ~250 operator classes. [schema-dir]. Templates use these.

### Movement / dynamics
- **C_OP_BasicMovement** — integrates velocity + gravity + drag. Fields:
  `m_Gravity` (vec3, e.g. [0,0,-400..-600]), `m_fDrag` (0.02..0.12). [src: basic_ambient, basic_explosion_bits, basic_trail, …]
- **C_OP_MaxVelocity** — clamps speed; `m_flMaxVelocity` (600), `m_nOverrideCP`
  (2 = the engine feeds projectile speed via CP2). Marked "do not modify" for
  projectile templates. [src: basic_projectile + readme]
- **C_OP_PositionLock** — locks a particle to a control point for a time window;
  `m_nControlPointNumber`, `m_flStartTime_min/max`, `m_flEndTime_min/max`. [src: basic_projectile_trail]
- **C_OP_OscillateVector** — oscillates a vector; `m_RateMin/Max`,
  `m_FrequencyMax` (all vec3). [src: basic_projectile_launch]
- **C_OP_SpinUpdate** — advances rotation from rotation-speed; no fields. [src: basic_ambient, glow_burst]

### Lifetime / radius / alpha / color
- **C_OP_Decay** — kills the particle at end of life; `m_nOpEndCapState`
  (source int `1` → canonical `"PARTICLE_ENDCAP_ENDCAP_ON"`). Endcap enum:
  `ALWAYS_ON=-1, ENDCAP_OFF=0, ENDCAP_ON=1`. [src: basic_projectile → decompiled; schema: ParticleEndcapMode_t.h]
- **C_OP_InterpolateRadius** — scales radius over life; `m_flStartScale`,
  `m_flEndScale` (default 0 = shrink to nothing), `m_flBias`. [src: many]
- **C_OP_FadeInSimple** / **C_OP_FadeOutSimple** — `m_flFadeInTime` /
  `m_flFadeOutTime` (seconds). [src: basic_ambient, …]
- **C_OP_ColorInterpolate** — `m_ColorFade` (RGBA target), `m_flFadeStartTime`
  (when the fade to that color starts). [src: basic_trail]

### Control-point setup (projectiles/ropes)
- **C_OP_SetChildControlPoints** — creates CPs for child effects from particle
  positions; `m_nFirstControlPoint` (3). "Do not modify" for projectiles. [src: basic_projectile + readme]
- **C_OP_SetSingleControlPointPosition** — `m_vecCP1Pos` (vec3). Note: although
  written in `m_Operators` in the source, the compiler moves this class into
  `m_PreEmissionOperators` — it is a **pre-emission operator**. [src: basic_rope → decompiled: basic_rope]

### Force generators (`m_ForceGenerators`) — `C_OP_*Force`
- **C_OP_RandomForce** — `m_MinForce`/`m_MaxForce` (vec3). [src: basic_ambient]
- **C_OP_TurbulenceForce** — `m_flNoiseCoordScale0..3`,
  `m_vecNoiseAmount0..3` (vec3). [src: basic_ambient]
- **C_OP_AttractToControlPoint** — pulls particles toward a CP;
  `m_fForceAmount`, `m_fFalloffPower`, `m_nControlPointNumber`,
  `m_flOpEndFadeOutTime`. [src: basic_projectile, basic_projectile_launch]

---

## F. Common errors / pitfalls

1. **Wrong emitter field name.** The burst emitter field is `m_nParticlesToEmit`
   (count), the continuous one is `m_flEmitRate` (rate). `m_flSpawnRate` is
   **not** a valid field — writing it is silently ignored and the emitter falls
   back to 100 particles. [src/decompiled: test_burst]
2. **Block misplacement.** The compiler does **not** relocate emitters into
   `m_Emitters` or initializers into `m_Initializers`. `test_burst.vpcf`
   put an emitter and a lifetime initializer inside `m_Operators` and they
   stayed there in the compiled binary. (Only genuinely *pre-emission* classes
   like `C_OP_SetSingleControlPointPosition` are auto-moved to
   `m_PreEmissionOperators`.) [src/decompiled: test_burst; src/decompiled: basic_rope]
3. **Inline children instead of `m_ChildRef`.** Idiomatic children are
   `{ m_ChildRef = resource:"…" }` referencing a separate `.vpcf`; inlining a
   full system in `m_Children` compiles but is easy to break (and was the
   broken example's shape). [src: all templates vs. test_burst]
4. **Constant vs random lifetime.** `m_flConstantLifespan` at the root gives
   *every* particle the same lifetime; `C_INIT_RandomLifeTime` (`m_fLifetimeMin/Max`)
   gives a per-particle random lifetime. The constant is only a fallback when no
   initializer writes lifetime. [schema; src: basic_explosion_bits (constant) vs basic_ambient (random)]
5. **Material/texture reference syntax.** Use `resource:"materials/…vtex"`
   (content-root relative, no addon prefix). Pointing at a missing/uncompiled
   `.vtex` is the usual cause of "particle loads but is invisible". [src: all renderers]
6. **Editor preview visibility.** An `InstantaneousEmitter` fires once at t=0,
   so the particle editor's static preview shows nothing; use
   `ContinuousEmitter` (or press play/simulate) to see particles in the editor. [src: basic_ambient_readme, basic_explosion_readme; existing dota2-vfx skill]
7. **m_hTexture vs m_vecTexturesInput.** In *source* you always write the single
   `m_hTexture` (even for trails/ropes); the engine stores it as
   `m_vecTexturesInput` internally. Don't hand-write `m_vecTexturesInput` in
   source — that's the canonical/decompiled form, not the authoring form. [src → decompiled: basic_ambient, basic_trail, basic_rope]
8. **Engine-injected defaults make decompiles look wrong.** A decompiled
   operator is ~40× larger than what you wrote (every `m_flOpStrength`, fade
   time, time offset, and the full ParticleFloat/ParticleVec field soup). This is
   the engine filling schema defaults, not your mistake. [decompiled: test_burst]

---

## The universal typed-value structures (engine-injected)

Every numeric input in canonical vpcf is a **ParticleFloat** (`m_flOpStrength`,
`m_flEmitRate`, `m_InputValue`, `m_fDrag`, …), and every vec3 is a
**ParticleVec** (`m_Gravity`, `m_vecColorScale`, …). Writing a plain number in
source is shorthand for `{ m_nType = "PF_TYPE_LITERAL", m_flLiteralValue = N }`.

ParticleFloat field set (all defaults) [decompiled: test_burst; schema: C_OP_ContinuousEmitter.h]:
`m_nType` (`PF_TYPE_LITERAL`), `m_nMapType` (`PF_MAP_TYPE_DIRECT`),
`m_flLiteralValue`, `m_NamedValue` (""), `m_nControlPoint` (0),
`m_nScalarAttribute` (3), `m_nVectorAttribute` (6), `m_nVectorComponent` (0),
`m_bReverseOrder` (false), `m_flRandomMin/Max` (0/1),
`m_bHasRandomSignFlip` (false), `m_nRandomSeed` (-1), `m_nRandomMode`
(`PF_RANDOM_MODE_CONSTANT`), `m_strSnapshotSubset` (""), `m_flLOD0..3` (0),
`m_nNoiseInputVectorAttribute` (0), `m_flNoiseOutputMin/Max` (0/1),
`m_flNoiseScale` (0.1), `m_vecNoiseOffsetRate` ([0,0,0]), `m_flNoiseOffset` (0),
`m_nNoiseOctaves` (1), `m_nNoiseTurbulence` (`PF_NOISE_TURB_NONE`),
`m_nNoiseType` (`PF_NOISE_TYPE_PERLIN`), `m_nNoiseModifier`
(`PF_NOISE_MODIFIER_NONE`), `m_flNoiseTurbulenceScale` (1),
`m_flNoiseTurbulenceMix` (0.5), `m_flNoiseImgPreviewScale` (1),
`m_bNoiseImgPreviewLive` (true), `m_flNoCameraFallback` (0),
`m_bUseBoundsCenter` (false), `m_nInputMode` (`PF_INPUT_MODE_CLAMPED`),
`m_flMultFactor` (1), `m_flInput0/1` (0/1), `m_flOutput0/1` (0/1),
`m_flNotchedRangeMin/Max` (0/1), `m_flNotchedOutputOutside/Inside` (0/1),
`m_nRoundType` (`PF_ROUND_TYPE_NEAREST`), `m_nBiasType`
(`PF_BIAS_TYPE_STANDARD`), `m_flBiasParameter` (0), `m_Curve` (empty spline).

ParticleVec field set [decompiled: test_burst; schema: C_OP_RenderDeferredLight.h]:
`m_nType` (`PVEC_TYPE_LITERAL` / `PVEC_TYPE_LITERAL_COLOR`),
`m_vLiteralValue` / `m_LiteralColor`, `m_NamedValue`, `m_bFollowNamedValue`,
`m_nVectorAttribute` (6), `m_vVectorAttributeScale`, `m_nControlPoint` /
`m_nDeltaControlPoint`, `m_vCPValueScale` / `m_vCPRelativePosition` /
`m_vCPRelativeDir`, `m_FloatComponentX/Y/Z` + `m_FloatInterp` (each a full
ParticleFloat), `m_flInterpInput0/1`, `m_vInterpOutput0/1`, `m_Gradient`,
`m_vRandomMin/Max`.

Every function block (operator/initializer/emitter/renderer) also carries the
`CParticleFunction` base fields [decompiled: test_burst]: `m_flOpStrength`
(ParticleFloat, 1.0), `m_nOpEndCapState` (`PARTICLE_ENDCAP_ALWAYS_ON`),
`m_nToolsState` (`PARTICLE_TOOLS_STATE_ALWAYS_ON`), `m_flOpStartFadeInTime` /
`m_flOpEndFadeInTime` / `m_flOpStartFadeOutTime` / `m_flOpEndFadeOutTime` (0),
`m_flOpFadeOscillatePeriod` (0), `m_bNormalizeToStopTime` (false),
`m_flOpTimeOffsetMin/Max` (0), `m_nOpTimeOffsetSeed` / `m_nOpTimeScaleSeed` (0),
`m_flOpTimeScaleMin/Max` (1), `m_bDisableOperator` (false), `m_Notes` ("").
Initializers additionally get `m_nAssociatedEmitterIndex` (-1), `m_nSetMethod`
(`PARTICLE_SET_REPLACE_VALUE`), `m_InputStrength` (ParticleFloat).

---

## Sources

**1. Real template sources (primary, engine-accepted)**
`/mnt/d/Repositories/dota2mcptest/content/particles/`
— `basic_ambient/basic_ambient.vpcf` (+readme), `basic_explosion/{basic_explosion,basic_explosion_bits,basic_explosion_burst,basic_explosion_flash}.vpcf` (+readme),
`basic_projectile/{basic_projectile,basic_projectile_explosion,basic_projectile_explosion_flash,basic_projectile_launch,basic_projectile_trail}.vpcf`
(+readme), `basic_rope/basic_rope.vpcf` (+readme), `basic_trail/basic_trail.vpcf`,
`test_vfx/{glow_burst,test_burst}.vpcf`.

**2. Compiled + VRF-decompiled samples (source↔compiled comparison)**
`/mnt/d/SteamLibrary/steamapps/common/dota 2 beta/game/dota_addons/dota2mcptest/particles/**/*.vpcf_c`,
decompiled with `Source2Viewer-CLI -i <f> -o <out> -d` (v20.0). Decompiled:
`basic_ambient`, `basic_trail`, `basic_rope`, `basic_explosion_burst`,
`basic_explosion`, `basic_projectile`, `test_burst`.

**3. Engine schema dumps (authoritative field/enum/class inventory)**
SteamTracking/GameTracking-CS2, `DumpSource2/schemas/particles/` (507 headers):
`CParticleSystemDefinition.h`, `ParticleChildrenInfo_t.h`,
`ParticleOutputBlendMode_t.h`, `ParticleEndcapMode_t.h`,
`C_OP_ContinuousEmitter.h`, `C_OP_InstantaneousEmitter.h`,
`C_OP_RenderSprites.h`, `C_OP_RenderTrails.h`, `C_OP_RenderRopes.h`,
`C_OP_RenderDeferredLight.h`, `CParticleFunctionEmitter.h`, plus the full
directory listing (emitter/renderer/initializer/operator class names).
`https://github.com/SteamTracking/GameTracking-CS2/tree/master/DumpSource2/schemas/particles`

**4. Vendor snapshot (checked, largely a dead-end for format knowledge)**
`/home/mac/.agents/skills/dota2-custom-game-dev/references/` — the vendor
`dota_script_help2.json` / `cl_panorama_script_help_2.json` only reference the
runtime `CScriptParticleManager` API and `ParticleAttachment_t` enum, **not**
the vpcf file format; no particle-structure docs present. (Per task, that API
surface is out of scope here.)

**5. Web references**
- Source2 wiki Particle Editor Guide: `http://www.source2.wiki/EngineTools/ParticleEditor/particle-editor-guide`
- Valve wiki Particle System Overview: `https://developer.valvesoftware.com/wiki/Dota_2_Workshop_Tools/Particles/Particle_System_Overview`
- ValveResourceFormat (the decompiler used above): `https://github.com/ValveResourceFormat/ValveResourceFormat`

> Note: `#3` is the CS2 dump; Dota 2 and CS2 share the Source 2 particle
> format, and every field observed in the dota2mcptest templates matches this
> schema exactly.

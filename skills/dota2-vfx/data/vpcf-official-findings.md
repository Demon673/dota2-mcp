# Dota 2 Official Particle Corpus — Statistical Reverse-Engineering Report

Large-scale sampling, decompilation, and statistical analysis of the built-in
particle systems shipped in Dota 2's pak01_dir.vpk, produced to feed
authoritative knowledge into the dota2-vfx skill.

Every number in this document was computed by parsing the **decompiled**
(.vpcf text) output of Valve Resource Format (VRF / Source 2 Viewer) over a
13,553-file stratified sample. The raw machine-readable statistics are in
stats.json next to this file.

---

## TL;DR — the ten numbers that matter most

| # | Finding | Evidence |
|---|---------|----------|
| 1 | A Dota 2 particle is overwhelmingly **sprites driven by generic float ops** | C_OP_RenderSprites is 63% of all renderers; C_INIT_InitFloat is the single most-used function (39,889 of 191,161 instances) |
| 2 | The canonical "hero ability" shape is **1 emitter + 1 sprite renderer + 3 operators (BasicMovement, ColorInterpolate, Decay)** | top combination = 1,065 files (8.8% of eligible) |
| 3 | **~93%** of systems use all three core blocks — emitter, initializer, operator | m_Emitters 92.9%, m_Initializers 93.1%, m_Operators 93.3% |
| 4 | Particle budgets are tiny: **median m_nMaxParticles = 20** (p75 = 64, p90 = 128) |
| 5 | Continuous emission is tuned for **median 30 particles/sec** (p90 = 256); burst emission median **6 particles** |
| 6 | Typical lifetime is **0.5–1.0 second** (random-uniform via C_INIT_InitFloat field 1) |
| 7 | There is **no C_INIT_RandomLifeTime** in the decompiled corpus — it is an editor shortcut that compiles to C_INIT_InitFloat + m_nOutputField = 1 |
| 8 | **~80%** of systems touch a control point; **~27%** spawn child systems (avg 3.4 children, max chain depth 6) |
| 9 | The shared material vocabulary is tiny: **~10 textures** (particle_glow_05, sparks, smoke1, …) cover the top of the distribution |
| 10 | Constraints and forces are **rare** (2.8% and 13.3% of files) — Dota 2 favors operators over physical sims |

---

## 0. Methodology

### 0.1 Source

- VPK: pak01_dir.vpk under the official game/dota tree.
- File inventory: /tmp/vpk-particles.txt — **82,280** .vpcf_c entries, one per line
  as "path.vpcf_c CRC:… size:…".
- Decompiler: VRF CLI Source2Viewer-CLI (v20.0), invoked as
  "-i <vpk> -d -f <prefix> -o <outdir> --threads 8" with
  DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1.

### 0.2 Stratified sample (6 strata, 13,553 files = 16.5% of the corpus)

| Stratum | Prefixes | Files |
|---------|----------|------:|
| Hero ability FX | particles/units/heroes/<40 dirs> | 9,014 |
| Item FX | particles/items_fx/ | 733 |
| Neutral / jungle FX | particles/neutral_fx/ | 613 |
| UI / main-menu FX | particles/ui/ | 1,423 |
| World / environment / creature | particles/econ/world/, base_static, dire_fx, world_tower, addons_gameplay, base_destruction_fx, environment_dynamic, creatures, econ/creeps | 1,165 |
| Gameplay / projectile / status | particles/generic_gameplay/, base_attacks/, abilities/, customgames/, vr_env/ | 605 |
| **Total** | | **13,553** |

The 40 hero directories were chosen to prioritize famous, ability-rich heroes:
hero_juggernaut, hero_invoker, hero_ember_spirit, hero_stormspirit,
hero_phantom_assassin, hero_axe, hero_pudge, hero_rubick, hero_brewmaster,
hero_earthshaker, hero_lina, hero_lion, hero_nevermore (Shadow Fiend),
hero_antimage, hero_faceless_void, hero_sven, hero_crystalmaiden,
hero_queenofpain, hero_windrunner, hero_zeus, plus the 20 highest-file-count
heroes (hero_void_spirit 728, hero_rubick 430, hero_brewmaster 428,
hero_invoker 377, hero_ringmaster, hero_techies, hero_kez, heroes_underlord,
hero_muerta, hero_grimstroke, hero_dark_willow, hero_oracle,
hero_keeper_of_the_light, hero_monkey_king, hero_arc_warden, hero_snapfire,
hero_furion, hero_hoodwink, hero_dawnbreaker, hero_phoenix, hero_drow,
hero_lich, hero_earth_spirit).

Note: the task's suggested particles/environment/ and particles/ambient/
prefixes do **not** exist in this VPK (0 entries each). The closest real analogues
are particles/environment_dynamic/ (1 file), particles/base_static/,
particles/dire_fx/ and particles/econ/world/, which are folded into the
"World / environment" stratum above.

### 0.3 Decompile result

| Stratum | Files | Elapsed |
|---------|------:|--------:|
| heroes | 9,014 | 20.8 s |
| items_fx | 733 | 5.0 s |
| neutral_fx | 613 | 4.5 s |
| ui | 1,423 | 6.2 s |
| world | 1,165 | 5.4 s |
| gameplay | 605 | 4.2 s |
| **Total** | **13,553** | **46.2 s** |

- **Success rate: 100%** — every one of the 13,553 selected .vpcf_c files
  decompiled to a .vpcf text file (0 failures, 0 empty outputs).
- Throughput ≈ **293 files/second** at 8 threads.
- The -f prefix filter is prefix-based and also pulled in 6 .vsnap
  (particle-snapshot) files; those were excluded from analysis.

---

## 1. Class inventory (a) — frequency and category breakdown

Across 13,553 files the parser extracted **191,161 function instances** spanning
**263 distinct _class names**.

### 1.1 Instances per category (by which block they live in)

| Category | Block | Instances | % of all |
|----------|-------|----------:|---------:|
| Initializer | m_Initializers | 82,557 | 43.2% |
| Operator | m_Operators | 76,851 | 40.2% |
| Renderer | m_Renderers | 13,625 | 7.1% |
| Emitter | m_Emitters | 13,271 | 6.9% |
| Pre-emission op | m_PreEmissionOperators | 2,333 | 1.2% |
| Force generator | m_ForceGenerators | 2,117 | 1.1% |
| Constraint | m_Constraints | 407 | 0.2% |

Initializers + operators are the workhorses — together **82.4%** of all
instances. A typical system spends its budget describing *how particles are
born* and *how they age*, not how they are drawn or how forces act on them.

### 1.2 Top 25 classes overall

| Rank | Class | Instances | Category |
|-----:|-------|----------:|----------|
| 1 | C_INIT_InitFloat | 39,889 | Initializer |
| 2 | C_OP_Decay | 11,513 | Operator |
| 3 | C_OP_BasicMovement | 9,812 | Operator |
| 4 | C_OP_InterpolateRadius | 9,114 | Operator |
| 5 | C_OP_RenderSprites | 8,597 | Renderer |
| 6 | C_INIT_RandomColor | 6,973 | Initializer |
| 7 | C_OP_FadeOutSimple | 6,826 | Operator |
| 8 | C_OP_InstantaneousEmitter | 6,774 | Emitter |
| 9 | C_OP_ContinuousEmitter | 6,168 | Emitter |
| 10 | C_INIT_CreateWithinSphere | 5,843 | Initializer |
| 11 | C_INIT_PositionOffset | 5,316 | Initializer |
| 12 | C_OP_FadeInSimple | 5,051 | Operator |
| 13 | C_OP_ColorInterpolate | 4,455 | Operator |
| 14 | C_INIT_RandomSequence | 3,909 | Initializer |
| 15 | C_OP_PositionLock | 3,812 | Operator |
| 16 | C_OP_SetFloat | 3,159 | Operator |
| 17 | C_INIT_InitialVelocityNoise | 3,093 | Initializer |
| 18 | C_OP_RampScalarLinearSimple | 2,989 | Operator |
| 19 | C_INIT_RandomYawFlip | 2,750 | Initializer |
| 20 | C_OP_SpinUpdate | 2,230 | Operator |
| 21 | C_INIT_RingWave | 2,132 | Initializer |
| 22 | C_OP_RenderRopes | 2,064 | Renderer |
| 23 | C_INIT_RemapParticleCountToScalar | 1,911 | Initializer |
| 24 | C_INIT_CreateWithinSphereTransform | 1,825 | Initializer |
| 25 | C_OP_VectorNoise | 1,372 | Operator |

C_INIT_InitFloat deserves emphasis: it is a *generic* initializer that writes
an arbitrary float attribute, and it is used **4× more often** than the next
class. Nearly every "RandomX" editor shortcut (random lifetime, random radius,
random rotation, random alpha) compiles down to C_INIT_InitFloat with a
random-uniform input and a target field (see §3.4).

### 1.3 Top classes per category

**Emitter** (13,271): C_OP_InstantaneousEmitter 6,774 · C_OP_ContinuousEmitter 6,168 · C_OP_NoiseEmitter 275 · C_OP_MaintainEmitter 54.

**Initializer** (82,557): C_INIT_InitFloat 39,889 · C_INIT_RandomColor 6,973 · C_INIT_CreateWithinSphere 5,843 · C_INIT_PositionOffset 5,316 · C_INIT_RandomSequence 3,909 · C_INIT_InitialVelocityNoise 3,093 · C_INIT_RandomYawFlip 2,750 · C_INIT_RingWave 2,132.

**Operator** (76,851): C_OP_Decay 11,513 · C_OP_BasicMovement 9,812 · C_OP_InterpolateRadius 9,114 · C_OP_FadeOutSimple 6,826 · C_OP_FadeInSimple 5,051 · C_OP_ColorInterpolate 4,455 · C_OP_PositionLock 3,812 · C_OP_SetFloat 3,159.

**Renderer** (13,625): C_OP_RenderSprites 8,597 (63%) · C_OP_RenderRopes 2,064 · C_OP_RenderTrails 1,161 · C_OP_RenderModels 933 · C_OP_RenderDeferredLight 585 · C_OP_RenderProjected 200 · C_OP_RenderScreenShake 43 · C_OP_RenderBlobs 20.

**ForceGenerator** (2,117): C_OP_AttractToControlPoint 1,229 · C_OP_RandomForce 343 · C_OP_TwistAroundAxis 251 · C_OP_CurlNoiseForce 167 · C_OP_TurbulenceForce 76 · C_OP_ExternalWindForce 23.

**Constraint** (407): C_OP_ConstrainDistance 124 · C_OP_WorldTraceConstraint 105 · C_OP_ConstrainDistanceToPath 97 · C_OP_PlanarConstraint 64 · C_OP_RopeSpringConstraint 15 · C_OP_BoxConstraint 2.

**PreEmissionOperator** (2,333): C_OP_SetSingleControlPointPosition 832 · C_OP_SetControlPointPositions 277 · C_OP_HSVShiftToCP 275 · C_OP_SetControlPointOrientation 233 · C_OP_StopAfterCPDuration 224 · C_OP_SetParentControlPointsToChildCP 89.

> **Key takeaway for authoring**: if a hand-written effect needs random lifetime,
> radius, rotation or alpha, write the generic C_INIT_InitFloat with a
> PF_TYPE_RANDOM_UNIFORM input and the right m_nOutputField — do not look
> for C_INIT_RandomLifeTime / C_INIT_RandomRadius etc. in the decompiled
> form; they only exist as source-level shortcuts.

---

## 2. Top-level block usage (b)

Percentage of the 13,553 files whose block is **non-empty**:

| Block | Files | Usage |
|-------|------:|------:|
| m_Operators | 12,642 | **93.3%** |
| m_Initializers | 12,623 | **93.1%** |
| m_Emitters | 12,590 | **92.9%** |
| m_Renderers | 12,144 | **89.6%** |
| m_Children | 3,599 | **26.6%** |
| m_ForceGenerators | 1,806 | 13.3% |
| m_PreEmissionOperators | 1,680 | 12.4% |
| m_Constraints | 381 | 2.8% |

Notes:

- m_Children is measured by m_ChildRef entries (child objects contain a
  resource reference, not a _class), hence it is absent from the _class
  counts in §1 but appears here at 26.6%.
- The "core four" (m_Emitters / m_Initializers / m_Operators / m_Renderers)
  each appear in ~90–93% of systems — a Dota 2 particle is essentially
  *emitter + initializers + operators + renderer*.
- Only 10.4% of files (m_Renderers 89.6% ⇒ complement) have **no** renderer;
  these are usually child "logic" systems, control-point helpers, or data carriers.

Representative root (Juggernaut Blade Fury — hero_juggernaut/juggernaut_blade_fury.vpcf):

~~~
<!-- kv3 encoding:text:version{…} format:vpcf45:version{…} -->
{
    _class = "CParticleSystemDefinition"
    m_bShouldHitboxesFallbackToRenderBounds = false
    m_nMaxParticles = 8
    m_nInitialParticles = 1
    m_Renderers =
    [
        {
            _class = "C_OP_RenderSprites"
            m_bRefract = true
            m_flRefractAmount = 0.01
            m_nOrientationType = "PARTICLE_ORIENTATION_WORLD_Z_ALIGNED"
            m_vecTexturesInput =
            [
                { m_hTexture = resource:"materials/particle/warp_ripple3_normal.vtex" },
            ]
            m_nOutputBlendMode = "PARTICLE_OUTPUT_BLEND_MODE_LIGHTEN"
        },
    ]
    m_Operators =
    [
        { _class = "C_OP_BasicMovement"  m_Gravity = [ 0.0, 0.0, 15.0 ]  m_fDrag = 0.05 },
        { _class = "C_OP_PositionLock" },
        { _class = "C_OP_Decay" },
        { _class = "C_OP_InterpolateRadius"  m_flStartScale = 2.0  m_flEndScale = 5.0  m_flBias = 0.35 },
    ]
}
~~~

---

## 3. Key parameter distributions (c)

### 3.1 m_nMaxParticles (particle budget) — 13,259 files

| | Value |
|--|------|
| min / p25 | 0 / 6 |
| **median (p50)** | **20** |
| p75 / p90 | 64 / 128 |
| p95 / p99 | 200 / 500 |
| max | 10,000 |
| mean | 53.2 |

Particle budgets are deliberately small. **Half of all systems cap at ≤20
particles**; only 1% exceed 500. The 10,000 maximum is an outlier (fullscreen UI
snow/ember fields).

### 3.2 m_flConstantRadius — 5,547 files

| | Value |
|--|------|
| p25 / **p50** | 8 / **20** |
| p75 / p90 | 64 / 180 |
| p95 / p99 | 300 / 640 |
| max | 10,000,000 |

Median world-space radius is 20 units (≈ the footprint of a creep). p99 of 640
shows occasional large ambient/area effects; the 10M maximum is an
"infinite"-style fill.

### 3.3 m_flConstantLifespan (constant lifetime) — 1,281 files

Only ~9.5% of systems set an explicit constant lifetime; most systems instead
let an initializer write per-particle lifetime (see §3.4).

| | Value |
|--|------|
| p25 / **p50** | 0.5 / **0.74 s** |
| p75 / p90 | 2 / 5 s |
| p95 / p99 | 10 / 600 s |
| max | 99,999 s |

### 3.4 Random lifetime — there is no C_INIT_RandomLifeTime

The decompiled corpus contains **zero** instances of C_INIT_RandomLifeTime.
Random lifetime is expressed as C_INIT_InitFloat writing **m_nOutputField = 1**
(Dota 2's lifetime attribute) with a PF_TYPE_RANDOM_UNIFORM input. 5,903 such
initializers were found; their m_flRandomMin / m_flRandomMax distributions:

| | m_flRandomMin | m_flRandomMax |
|--|--:|--:|
| p25 | 0.25 | 0.5 |
| **p50** | **0.5 s** | **1.0 s** |
| p75 | 1 | 2 |
| p90 | 2 | 3 |
| p99 | 5 | 7 |
| max | 50 | 60 |

**The canonical random lifetime is 0.5–1.0 seconds.** (p99 of 5–7 s covers
lingering ambient/fire effects.)

The attribute field map (verified empirically and matching the existing
dota2-vfx skill / vpcf-structure research):

| m_nOutputField | Attribute |
|----------------|-----------|
| 0 | radius |
| 1 | **lifetime** |
| 4 | rotation (yaw) |
| 5 | rotation speed |
| 7 | alpha (0..1) |

Representative random-lifetime initializer:

~~~
{
    _class = "C_INIT_InitFloat"
    m_InputValue =
    {
        m_nType = "PF_TYPE_RANDOM_UNIFORM"
        m_flRandomMin = 1.0
        m_flRandomMax = 8.0
        m_nRandomMode = "PF_RANDOM_MODE_CONSTANT"
    }
    m_nOutputField = 1   // 1 = lifetime
}
~~~

### 3.5 m_flEmitRate (continuous emitters) — 5,588 literal values

m_flEmitRate is a ParticleFloat; only its m_flLiteralValue was aggregated
(control-point-driven rates excluded).

| | Value |
|--|------|
| p25 / **p50** | 10 / **30 /s** |
| p75 / p90 | 85 / 256 |
| p95 / p99 | 500 / 1,200 |
| max | 500,000 |

### 3.6 m_nParticlesToEmit (burst / instantaneous) — 6,364 literal values

m_nParticlesToEmit **does** exist — but as a ParticleFloat struct, so a naive
integer-key grep misses it. It drives C_OP_InstantaneousEmitter.

| | Value |
|--|------|
| p25 / **p50** | 1 / **6** |
| p75 / p90 | 24 / 48 |
| p95 / p99 | 64 / 170 |
| max | 2,256 |

Representative instantaneous (burst) emitter:

~~~
{
    _class = "C_OP_InstantaneousEmitter"
    m_flStartTime = { m_nType = "PF_TYPE_LITERAL"  m_flLiteralValue = 0.1 }
    m_nParticlesToEmit = { m_nType = "PF_TYPE_LITERAL"  m_flLiteralValue = 300.0 }
}
~~~

---

## 4. Material / texture references (d)

962 distinct material paths were referenced. The shared vocabulary is small and
dominated by a handful of generic materials/particle/* textures.

### 4.1 Top 30 material paths (by reference count)

| # | Material | Refs |
|--:|----------|-----:|
| 1 | materials/particle/particle_glow_05.vtex | 486 |
| 2 | materials/particle/sparks/sparks.vtex | 466 |
| 3 | materials/particle/smoke1/smoke1.vtex | 374 |
| 4 | materials/particle/particle_glow_04.vtex | 335 |
| 5 | materials/particle/yellowflare2.vtex | 288 |
| 6 | materials/particle/smoke3/smoke3b.vtex | 284 |
| 7 | materials/particle/particle_flares/aircraft_white.vtex | 240 |
| 8 | materials/particle/impact/fleks3.vtex | 227 |
| 9 | materials/particle/beam_generic_2.vtex | 198 |
| 10 | materials/particle/yellowflare.vtex | 180 |
| 11 | materials/particle/beam_hotwhite.vtex | 148 |
| 12 | materials/particle/impact/fleks.vtex | 144 |
| 13 | materials/particles/light_flare/light_glow_01.vtex | 144 |
| 14 | materials/particle/smoke/steam/steam.vtex | 144 |
| 15 | materials/particle/spray1/spray1.vtex | 142 |
| 16 | materials/particle/particle_glow_08.vtex | 135 |
| 17 | materials/particle/smoke/static/static_smoke.vtex | 133 |
| 18 | materials/particle/lens_flare/lens_flare.vtex | 123 |
| 19 | materials/particle/vistasmokev1/vistasmokev1.vtex | 120 |
| 20 | materials/particle/fire_particle_10/fire_particle_10_low.vtex | 119 |
| 21 | materials/particle/particle_flares/particle_flare_004b_mod.vtex | 116 |
| 22 | materials/particle/particle_glow_01.vtex | 114 |
| 23 | materials/particle/particle_flares/aircraft_blue2.vtex | 111 |
| 24 | materials/particle/particle_flares/aircraft_white_v3.vtex | 111 |
| 25 | materials/particle/particle_flares/particle_flare_001.vtex | 104 |
| 26 | materials/particle/beam_generic_7.vtex | 100 |
| 27 | materials/particle/particle_flares/aircraft_red.vtex | 99 |
| 28 | materials/particle/dust/large_swirl_dust.vtex | 98 |
| 29 | materials/particle/particle_flares/aircraft_white_v2.vtex | 90 |
| 30 | materials/particle/particle_ring_wavy4.vtex | 88 |

Texture references appear inside renderer objects as
m_hTexture = resource:"materials/…" (see the Blade Fury excerpt in §2) or, for
model renderers, as m_model = resource:"models/…".

Model renderer example (hero_juggernaut/juggernaut_omni_slash_trail_scepter_model_afterimage.vpcf):

~~~
{
    _class = "C_OP_RenderModels"
    m_ModelList =
    [
        { m_model = resource:"models/heroes/juggernaut/juggernaut.vmdl" },
    ]
}
~~~

---

## 5. Common combination patterns (e)

A "combination signature" was computed for the 12,108 files that have at least
one emitter, one renderer, and one operator: "E:<emitters> | R:<renderers> |
O:<top-3 operators>".

### 5.1 Top 10 signatures

| # | Signature | Files |
|--:|-----------|------:|
| 1 | E:C_OP_ContinuousEmitter · R:C_OP_RenderSprites · O:BasicMovement+ColorInterpolate+Decay | 1,065 |
| 2 | E:C_OP_InstantaneousEmitter · R:C_OP_RenderSprites · O:BasicMovement+ColorInterpolate+Decay | 738 |
| 3 | E:C_OP_ContinuousEmitter · R:C_OP_RenderSprites · O:BasicMovement+Decay+FadeInSimple | 590 |
| 4 | E:C_OP_InstantaneousEmitter · R:C_OP_RenderSprites · O:BasicMovement+Decay+FadeOutSimple | 549 |
| 5 | E:C_OP_InstantaneousEmitter · R:C_OP_RenderSprites · O:BasicMovement+Decay+FadeInSimple | 275 |
| 6 | E:C_OP_ContinuousEmitter · R:C_OP_RenderRopes · O:BasicMovement+ColorInterpolate+Decay | 254 |
| 7 | E:C_OP_ContinuousEmitter · R:C_OP_RenderSprites · O:BasicMovement+Decay+FadeOutSimple | 192 |
| 8 | E:C_OP_ContinuousEmitter · R:C_OP_RenderRopes · O:BasicMovement+Decay+FadeInSimple | 157 |
| 9 | E:C_OP_ContinuousEmitter · R:C_OP_RenderSprites · O:SetFloat+BasicMovement+Decay | 149 |
| 10 | E:C_OP_ContinuousEmitter · R:C_OP_RenderSprites · O:BasicMovement+Decay+InterpolateRadius | 140 |

The dominant recipe is unmistakable: **ContinuousEmitter or InstantaneousEmitter
→ RenderSprites, with the operator trio BasicMovement (physics),
ColorInterpolate/Fade* (alpha) and Decay (lifetime)**. Nine of the top ten are
sprite renderers; ropes appear as the second renderer of choice.

---

## 6. Advanced techniques (f)

### 6.1 Child particle chains (m_Children)

- **26.56%** of files (3,599) declare at least one child system.
- 12,273 total m_ChildRef references → **3.41 children on average** per
  child-having file.
- 98.81% of child references resolve to a file inside the same VPK (i.e. they are
  real, in-package systems).
- Transitive **chain depth**: average max depth **1.45**, **maximum depth 6**
  (a system whose child has a child … six levels down).

Children are declared by resource reference — they are *not* inlined:

~~~
m_Children =
[
    { m_ChildRef = resource:"particles/units/heroes/hero_invoker/invoker_exort_orb_dapple.vpcf" },
    { m_ChildRef = resource:"particles/units/heroes/hero_invoker/invoker_wex_orb_lightning_a.vpcf" },
    { m_ChildRef = resource:"particles/units/heroes/hero_invoker/invoker_wex_orb_lightning_b.vpcf" },
    { m_ChildRef = resource:"particles/units/heroes/hero_invoker/invoker_wex_orb_bloom.vpcf" },
    { m_ChildRef = resource:"particles/units/heroes/hero_invoker/invoker_wex_orb_rings.vpcf" },
    { m_ChildRef = resource:"particles/units/heroes/hero_invoker/invoker_wex_orb_light.vpcf" },
]
~~~

(This is hero_invoker/invoker_wex_sphere.vpcf — a six-child composite used by
Invoker's orbs.)

### 6.2 Control points

- **79.93%** of files (10,833) reference a control point somewhere — either via
  m_nControlPoint* / m_nCurrentControlPointNumber keys inside operators, or via
  a top-level m_controlPointConfigurations block.

Control points are the primary data-passing mechanism between game code and
particles (and between a parent and its children). Configuration block example
(particles/environment_dynamic/glow_soft_01.vpcf):

~~~
m_controlPointConfigurations =
[
    {
        m_name = "game"
        m_drivers =
        [
            { m_iAttachType = "PATTACH_WORLDORIGIN"  m_entityName = "self" },
        ]
    },
    {
        m_name = "preview"
        m_drivers =
        [
            { m_iAttachType = "PATTACH_WORLDORIGIN"  m_entityName = "self" },
            { m_iControlPoint = 1  m_iAttachType = "PATTACH_WORLDORIGIN"  m_vecOffset = [ 1.0, 0.0, 0.0 ]  m_entityName = "self" },
            { m_iControlPoint = 2  m_iAttachType = "PATTACH_WORLDORIGIN"  m_vecOffset = [ 1.0, 0.0, 0.0 ]  m_entityName = "self" },
        ]
    },
]
~~~

Pre-emission operators are almost always control-point setters (see §1.3), and
they run once before emission to pin control points to bones/entities.

### 6.3 Constraints (m_Constraints)

- Only **2.81%** of files (381) use a constraint — constraints are the rarest of
  the eight blocks. The dominant constraint is C_OP_ConstrainDistance (124),
  then C_OP_WorldTraceConstraint (105, used for ground collision) and
  C_OP_ConstrainDistanceToPath (97, used by rope/trail systems).

Representative (from items_fx/witch_blade/witch_blade_trail_sploosh.vpcf):

~~~
m_Constraints =
[
    { _class = "C_OP_WorldTraceConstraint"  … },
]
~~~

### 6.4 Sequence number (m_nConstantSequenceNumber)

- **8.12%** of files (1,101) set a non-zero m_nConstantSequenceNumber.

This is the legacy/animation sequence selector. Its low adoption (8%) confirms it
is a niche mechanism — modern Dota 2 effects overwhelmingly rely on
C_INIT_RandomSequence + sprite-sheet animation instead of the legacy sequence id.

---

## 7. What this means for authoring dota2-vfx content

1. **Start from the canonical recipe.** Continuous/instant emitter →
   C_OP_RenderSprites → C_OP_BasicMovement + C_OP_ColorInterpolate +
   C_OP_Decay. This one shape is the single most common Dota 2 particle
   (1,065 occurrences) and covers most "glow / spark / smoke" needs.
2. **Keep budgets small.** Median m_nMaxParticles = 20; median continuous rate
   = 30/s; median burst = 6. Big numbers are the exception, not the rule.
3. **Set lifetime through C_INIT_InitFloat field 1** (random-uniform 0.5–1.0 s)
   or m_flConstantLifespan — never through C_INIT_RandomLifeTime, which does not
   survive compilation.
4. **Reuse the shared material vocabulary.** particle_glow_05, sparks, smoke1,
   yellowflare2 and friends are the lingua franca; reaching for them matches how
   the official effects are actually built.
5. **Use control points for everything** — 80% of systems do; they are the bridge
   between Lua/game logic and particles, and between parents and children.
6. **Prefer child systems over monolithic systems** for composability (~27% do),
   and reserve constraints/forces for the rare cases that genuinely need them.

---

## Sources

- Corpus: official pak01_dir.vpk (game/dota), 82,280 .vpcf_c files.
- Sample manifest: 40 hero dirs + 5 category prefixes (13,553 files).
- Decompiler: ValveResourceFormat Source2Viewer-CLI v20.0
  (-d -f <prefix> -o <dir> --threads 8).
- Analysis: this repository's parsing script (block/class/param extraction) —
  see stats.json for the machine-readable output.
- Cross-reference: research/vpcf-structure/findings.md and
  skills/dota2-vfx/SKILL.md (attribute-field map and Random* shortcut
  semantics) — this report's empirical field map (§3.4) agrees with both.

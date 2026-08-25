# Dota 2 particle classes — field-level reference

Field-level reference for **every one of the 263 particle `_class` names** that
appear in Valve's shipped Dota 2 particle systems: field name, type, default
value, editor label, and how often official content actually sets that field.

Two independent sources are joined per class:

| Axis | Source | What it gives |
|---|---|---|
| Authoritative | Dota 2 engine schema dump (`SteamTracking/GameTracking-Dota2`, `DumpSource2/schemas/particles` + `particleslib`, 507 + 39 `.h` files, commit `6c875ca54c25e6fa98bbabbab1c3b1f78b46dde5`, 2026-08-19) | class inheritance, every field's C++ type, engine default (`MGetKV3ClassDefaults`), editor label / group, advanced+hidden flags, suppress expressions, GPU / obsolete / replacement markers, enum literals |
| Empirical | 13,553 official `.vpcf` files decompiled from `{dota2Path}/game/dota/pak01_dir.vpk` (the same stratified sample as [vpcf-official-findings.md](../../skills/dota2-vfx/data/vpcf-official-findings.md)) | per-class instance and file counts, per-field override frequency, the literal values Valve actually uses |

## Files

| File | Contents | Classes | Lines |
|---|---|---:|---:|
| [emitters.md](emitters.md) | `m_Emitters` classes | 4 | 135 |
| [initializers.md](initializers.md) | `m_Initializers` classes | 80 | 1,611 |
| [operators.md](operators.md) | `m_Operators` classes | 126 | 2,570 |
| [forces.md](forces.md) | `m_ForceGenerators` classes | 12 | 255 |
| [constraints.md](constraints.md) | `m_Constraints` classes | 6 | 168 |
| [renderers.md](renderers.md) | `m_Renderers` classes | 12 | 560 |
| [preemission.md](preemission.md) | `m_PreEmissionOperators` classes | 23 | 469 |
| [base-classes.md](base-classes.md) | function base classes, composite field types (`CParticleFloatInput` family), and the system root `CParticleSystemDefinition` | 39 | 669 |
| [enums.md](enums.md) | every enum type used by a particle field, with literal names | 91 enums | 1,222 |
| [appendix-unused.md](appendix-unused.md) | function classes the engine knows but the official corpus never uses | 143 | 154 |
| [vpcf-class-fields.json](../vpcf-class-fields.json) | the whole reference, machine-readable | 263 | — |

Total: **263 / 263** corpus classes documented (100%), **2,506 field rows**, 7,813
lines of generated Markdown (this README excluded). Every class — not only the top 100 — carries a full field
table; the only class with no rows is `C_OP_EndCapDecay`, which genuinely has no
fields of its own.

## How to read a class section

```
### C_OP_InterpolateRadius
- Corpus   9,114 instances in 8,683 files (11.9% of Operator instances) · overall rank #4/263
- Schema   DumpSource2/schemas/particles/C_OP_InterpolateRadius.h · base CParticleFunctionOperator → CParticleFunction
- Fields   6 own · 17 inherited · GPU-capable
```

| Column | Meaning |
|---|---|
| Field | Field name as written in `.vpcf` KV3 |
| Type | Schema C++ type. Enum types link to [enums.md](enums.md); struct types link to [base-classes.md](base-classes.md) |
| Default | Engine default from the schema's `MGetKV3ClassDefaults` block. Composite structs are abbreviated `{ k=v, …+N }`; the full struct is in [base-classes.md](base-classes.md) |
| Corpus set | Share of this class's instances that write the field explicitly, with the raw count |
| Common values | Up to three most frequent literal values with counts, then `+N more` distinct values. For composite inputs the cell instead reports which sub-keys are written: `m_flLiteralValue set 6364× (top 1)` |
| Editor label · group | `MPropertyFriendlyName` and `MPropertyStartGroup` — the names shown in the Particle Editor |

Row markers:

| Marker | Meaning |
|---|---|
| `↑` | Inherited field (defined on a base class), listed here because official content sets it on this class |
| `⚠` | Field observed in shipped assets but **absent from the current schema** — a legacy field from an older `.vpcf` version; the current compiler may ignore it |
| `adv` | `MParticleAdvancedField` — hidden behind the editor's advanced toggle |
| `hidden` | `MPropertySuppressField` — not shown in the editor at all |

Class-level flags: `GPU-capable` (`MGPUParticleFunction`), `obsolete`
(`MObsoleteParticleFunction`), `replaced by X` (`MParticleReplacementOp`),
`min/max vpcf version`.

## Caveats

- **`Corpus set` measures overrides, not use.** VRF's decompiled text only emits
  fields whose compiled value differs from the class default, so a low share means
  "most sampled files left the default", not "the field does nothing":
  `C_OP_RenderSprites.m_nOrientationType` is written by only 19.6% of instances
  because the remaining 80% want its default `PARTICLE_ORIENTATION_SCREEN_ALIGNED`.
- **Only own + observed-inherited fields are tabulated per class.** The full
  inherited set (17–18 fields for most functions, 84–92 for the sprite, rope and
  trail renderers) is documented once in [base-classes.md](base-classes.md)
  instead of being repeated 263 times. The class header states how many inherited fields exist.
- **12 of the 263 classes have no schema entry** — see below. Their tables are
  reconstructed from shipped assets only, so type and default columns are empty.
- **The schema is a dump of one Dota 2 build.** Fields, defaults and enum
  literals move between builds; re-run the reproduction steps against a newer
  commit when precision matters.
- **The corpus is a 16.5% stratified sample** (13,553 of 82,280 `.vpcf_c`
  entries), weighted toward hero, item, neutral, UI, world and gameplay effects.
  Frequencies are representative of gameplay-facing content, not of every asset
  in the VPK.
- Percentages in a class header are shares of that **category's** instances
  (`Operator`, `Renderer`, …), not of all 191,161 instances.

## Cross-cutting findings

**251 of 263 classes are in the current schema; 12 are not.** These 12 are still
referenced by shipped compiled assets and are absent from the CS2 schema dump as
well (all twelve return 404 there), i.e. they are engine-wide removals, not
Dota-specific ones:

`C_INIT_CreateWithinSphere` (5,843 instances — rank #10 overall),
`C_OP_DistanceToCP`, `C_INIT_RemapCPtoVector`,
`C_INIT_RemapInitialCPDirectionToRotation`,
`C_INIT_RemapInitialDirectionToCPToVector`, `C_OP_PercentageBetweenCPs`,
`C_OP_PercentageBetweenCPsVector`, `C_OP_RemapCPVisibilityToScalar`,
`C_OP_RemapCPOrientationToRotations`, `C_INIT_RemapCPOrientationToRotations`,
`C_OP_RemapCPOrientationToYaw`, `C_OP_DistanceBetweenCPs`. Current schema
successors exist for several (`C_INIT_CreateWithinSphereTransform`,
`C_OP_DistanceToTransform`, `C_OP_PercentageBetweenTransforms`,
`C_OP_RemapTransformOrientationToRotations`, …): the modern classes take a
`CParticleTransformInput` where the legacy ones took a raw control-point index.

**18 schema-backed classes carry legacy fields** — a field shipped assets set that
the current schema no longer declares. The dominant case is the same
control-point-to-transform migration:

| Class | Kind | Legacy field(s) (instances) |
|---|---|---|
| `C_INIT_CreateInEpitrochoid` | Initializer | `m_nControlPointNumber` (15) |
| `C_INIT_CreateOnModel` | Initializer | `m_nControlPointNumber` (80) |
| `C_INIT_CreateSpiralSphere` | Initializer | `m_nDensity` (21), `m_nOverrideCP` (8), `m_nControlPointNumber` (6) |
| `C_INIT_InitialVelocityNoise` | Initializer | `m_bLocalSpace` (637), `m_nControlPointNumber` (212) |
| `C_INIT_NormalAlignToCP` | Initializer | `m_nControlPointNumber` (164) |
| `C_INIT_PositionOffset` | Initializer | `m_nControlPointNumber` (476) |
| `C_INIT_RemapQAnglesToRotation` | Initializer | `m_nCP` (1) |
| `C_INIT_RingWave` | Initializer | `m_nControlPointNumber` (457) |
| `C_INIT_VelocityFromCP` | Initializer | `m_nControlPoint` (66), `m_nControlPointCompare` (21) |
| `C_OP_AttractToControlPoint` | ForceGenerator | `m_nControlPointNumber` (470), `m_bScaleLocal` (7) |
| `C_OP_LockToBone` | Operator | `m_nControlPointNumber` (52) |
| `C_OP_MaxVelocity` | Operator | `m_nOverrideCP` (152) |
| `C_OP_MovementRotateParticleAroundAxis` | Operator | `m_nCP` (58) |
| `C_OP_MoveToHitbox` | Operator | `m_nControlPointNumber` (9) |
| `C_OP_PositionLock` | Operator | `m_nControlPointNumber` (1,418) |
| `C_OP_RenderModels` | Renderer | `m_nModelCP` (50), `m_bUseRawMeshGroup` (6), `m_nSkinCP` (4) |
| `C_OP_RenderProjected` | Renderer | `m_hProjectedMaterial` (166) |
| `C_OP_SetSingleControlPointPosition` | PreEmissionOperator | `m_nHeadLocation` (159), `m_bUseWorldLocation` (69) |

Copying these field names out of a decompiled official effect into a new
hand-written `.vpcf` is therefore not safe; use the class's current schema field
(usually a `m_TransformInput`) instead.

**Other schema signals visible in the tables:** 37 of the 263 classes are marked
GPU-capable; one in-use class is marked obsolete (`C_OP_RenderScreenVelocityRotate`,
3 instances); three in-use classes declare a replacement
(`C_INIT_CreateSequentialPath` → `…V2`, `C_OP_InheritFromParentParticles` → `…V2`,
`C_OP_LockToSavedSequentialPath` → `…V2`). 143 function classes the engine knows
are never used by the sampled official content ([appendix-unused.md](appendix-unused.md)).

**Particle attribute indices.** `ParticleAttributeIndex_t` fields
(`m_nOutputField`, `m_nFieldOutput`, `m_nScalarAttribute`, …) are boxed `int32`
with no enum in the schema; the index space is documented empirically in
[vpcf-structure findings](../../vpcf-structure/findings.md) —
`0 = radius, 1 = lifetime, 4 = rotation, 5 = rotation speed, 7 = alpha, 8 = texture-coordinate scalar, 13 = alpha-test point, 16 = alpha2, 21 = orientation vector`.

## class-fields.json

One object per class, keyed by `_class`:

```
classes["C_OP_RenderSprites"] = {
  kind, block, rank, instances, files, blocks,           // corpus placement
  schema: { header, base, chain, annotations } | null,   // null = legacy class
  fields: [ { name, type, origin: "own"|"inherited"|"legacy", default,
              friendly, group, advanced, suppressed, suppressExpr,
              corpus: { count, pct, distinct, top: [[value, count], …] } } ]
}
```

## Reproduction

```bash
# 1. authoritative schema (partial clone: only the two schema dirs)
git clone --filter=blob:none --no-checkout --depth 1 \
  https://github.com/SteamTracking/GameTracking-Dota2.git gt-dota2
cd gt-dota2 && git sparse-checkout init --cone \
  && git sparse-checkout set DumpSource2/schemas/particles DumpSource2/schemas/particleslib \
  && git checkout

# 2. official corpus (VRF / Source2Viewer-CLI v20.0, the strata of ../../skills/dota2-vfx/data/vpcf-official-findings.md)
DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 Source2Viewer-CLI \
  -i "{dota2Path}/game/dota/pak01_dir.vpk" -d -f "<stratum prefixes>" -o corpus/ --threads 8
```

Cross-checks that passed while building this reference: the corpus re-decompile
reproduced **13,553 files, 263 distinct classes and 191,161 function instances**,
matching `../../skills/dota2-vfx/data/vpcf-stats.json` exactly, including all 80 per-class counts
it records; every class's schema-declared category agrees with the block it is
found in (0 disagreements over 263 classes); all 45 root fields observed in the
corpus exist in `CParticleSystemDefinition`.

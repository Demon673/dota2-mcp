# Dota 2 Official Model Corpus — Statistical Reverse-Engineering Report

Large-scale sampling, decompilation, and statistical analysis of the built-in
models and materials shipped in Dota 2's `pak01_dir.vpk`, produced to feed
authoritative knowledge into the `dota2-model` skill.

Every number in this document was computed by parsing the **decompiled** text
output of Valve Resource Format (VRF / Source 2 Viewer) over a stratified
sample of **3,161 `.vmdl`** and **2,549 `.vmat`** files. The raw
machine-readable statistics are in `stats.json` next to this file.

---

## TL;DR — the ten numbers that matter most

| # | Finding | Evidence |
|---|---------|----------|
| 1 | **Every** decompiled model is `format:modeldoc28` (a `rootNode`/`children` node graph) — **zero** use the legacy `m_meshList` format | 3,161/3,161 files |
| 2 | The canonical model is **2 meshes** (LOD0 + LOD1) | mesh count mean 1.73, p50 = 2, p90 = 2 |
| 3 | Meshes are **always imported from an external `.dmx`** — never inline | 5,479/5,479 mesh refs end in `.dmx` |
| 4 | **No `m_material` anywhere in a `.vmdl`** — materials are separate `.vmat` files bound by the mesh, plus a `MaterialGroupList` style-remap node in 9.9% of models | 0 `m_material`; 314 files with `MaterialGroupList` |
| 5 | LOD is explicit and near-universal | 61.6% carry `LODGroupList` (p50 = 2 LOD groups) |
| 6 | Models are skeletal: 92.7% have a `Skeleton` (mean 27.5 bones, p90 = 60) | 2,930/3,161 files |
| 7 | Physics is rare: only 1.8% of models declare physics shapes | 57 files, mostly `PhysicsShapeCapsule` |
| 8 | The single dominant shader is **`hero.vfx`** (88.9%) — *not* `dota_hero.vfx` | 2,266/2,549 materials; runner-up `global_lit_simple.vfx` (5.5%) |
| 9 | A hero material is **~43 parameters**: ~7 compiled textures (`g_t*`), ~5 feature flags (`F_*`), ~14 source `Texture*` refs | p50 param count 43, p50 `g_t*` count 7, p50 flag count 5 |
| 10 | The universal hero flags are `F_MASKS_1` (81%) + `F_MASKS_2` (83%) + `F_USE_STATUS_EFFECTS_PROXY` (80%); special effects are a minority | translucent 27%, additive 4%, double-sided (`F_RENDER_BACKFACES`) 4.4%, self-illum mask present 85% |

---

## 0. Methodology

### 0.1 Source and decompiler

- **VPK**: `game/dota/pak01_dir.vpk` (the directory/index VPK over the
  `pak01_000` … `pak01_675` chunk VPKs). File inventory produced with `-l`:
  **18,405 `.vmdl_c`** and **28,510 `.vmat_c`** entries.
- **Decompiler**: ValveResourceFormat `Source2Viewer-CLI` v20.0, invoked as
  `-i <vpk> -d -f <prefix> -o <dir> --threads 8` with
  `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`.
- Text output is the default: `--gltf_export_format` defaults to `null`, so
  `-d` writes decompiled **text** (`.vmdl` / `.vmat`), not glTF.

### 0.2 Stratified sample

**Models (`.vmdl_c`) — 3,134 targeted, 3,161 decompiled** (27 extra files are
dependency models VRF followed through cross-references):

| Stratum | Prefixes | Files |
|---------|----------|------:|
| Hero base models | 30 hero dirs under `models/heroes/` | 305 |
| Creep / lane / neutral models | `models/creeps/` | 228 |
| Cosmetic item models | 11 item dirs under `models/items/` (courier, drow, pudge, …) | 2,601 |

**Materials (`.vmat_c`) — 2,549 decompiled** (concentrated on model materials,
the skill's domain; stickers/vgui — non-model UI materials — excluded):

| Stratum | Files |
|---------|------:|
| Hero materials (`materials/models/heroes/`) | 1,651 |
| Creep materials (`materials/models/creeps/`) | 221 |
| Courier materials (`materials/models/courier/`) | 265 |
| Item materials (`materials/models/items/drow/`, representative) | 292 |
| Particle materials (`materials/particle/` sprays + items) | 120 |

### 0.3 Decompiler behaviors that matter for any future corpus work

These are hard-won operational facts, not incidental:

1. **`-d` always follows dependencies.** Decompiling a model also writes its
   animations as `.dmx` (a 30–60 file fan-out per hero model); decompiling a
   material also decodes its referenced textures to `.png`.
2. **No flag disables texture export.** `--texture_decode_flags none` only
   changes decode *flags*, not *whether* it decodes; `-e` only filters the
   `-l` listing, **not** the `-d` decompile. The only mitigation is a
   background janitor that deletes `.png`/`.dmx` while the run proceeds
   (`/tmp` here is a 7.8 GB tmpfs — unbounded texture export would overflow it).
3. The compiled model is **self-contained** in one `.vmdl_c` (meshes and
   animations are embedded / referenced by logical name); there are no separate
   `.vmesh_c` / `.vanim_c` files under `models/…/`.

---

## 1. Headline: the model format is `modeldoc`, not `m_meshList`

The `dota2-model` skill currently documents the **legacy** `.vmdl` source
shape (`m_meshList` → `CMesh` → `m_material`, `m_refLODGroup`, `m_smdl`). That
shape **does not exist** in the official corpus. Every one of the 3,161
decompiled models is the **modeldoc** format — a typed node graph:

```kv3
<!-- kv3 encoding:text:version{...} format:modeldoc28:version{...} -->
{
	rootNode =
	{
		_class = "RootNode"
		children =
		[
			{ _class = "BoneMarkupList" ... }
			{ _class = "RenderMeshList" children = [ { _class = "RenderMeshFile" name = "abaddon_model" filename = "models/heroes/abaddon/abaddon_abaddon_model.dmx" } ] }
			{ _class = "LODGroupList" ... }
			{ _class = "Skeleton" ... }
			{ _class = "AnimationList" ... }
		]
	}
}
```

The modeldoc node vocabulary observed across the corpus (full counts in
`stats.json → a_vmdl.classCounts`):

| Node class | Files with it | Purpose |
|------------|---------------|---------|
| `RootNode` / `BoneMarkupList` | 100% | graph root; bone-cull markup |
| `RenderMeshList` → `RenderMeshFile` | 99.9% | meshes (imported from `.dmx`) |
| `Skeleton` → `Bone` | 92.7% | bone hierarchy |
| `LODGroupList` → `LODGroup` | 61.6% | LOD switch thresholds |
| `HitboxSetList` → `HitboxSet` → `Hitbox` | 57.6% | collision |
| `AnimationList` → `Folder` → `AnimFile` | 48.3% | animations + anim events |
| `AttachmentList` → `Attachment` | 40.3% | weapon/fx/prop attach points |
| `PoseParamList` | 13.9% | pose-space params (turn, etc.) |
| `MaterialGroupList` → `MaterialGroup`/`DefaultMaterialGroup` | 9.9% | style / material remaps |
| `WeightListList` | 9.0% | weight lists |
| `BodyGroupList` | 2.5% | body groups |
| `PhysicsShapeList` → `PhysicsShapeCapsule` | 1.8% | physics shapes |

---

## 2. Model (`.vmdl`) structure

### 2.1 Mesh count

Most models are **one or two meshes** — a base mesh plus a single LOD mesh:

- mean 1.73, **p50 = 2, p90 = 2**, p99 = 6, max 58.
- Distribution: 1,167 files with 1 mesh, 1,898 with 2 meshes, 31 with 3, and
  only 4 with zero meshes.

### 2.2 Mesh import method (the `m_smdl` equivalent)

Meshes are **never inline**. All 5,479 `RenderMeshFile.filename` references end
in `.dmx` (100%). The legacy `m_smdl` "import a static mesh document" concept
maps to `RenderMeshFile.filename` pointing at a compiled mesh `.dmx`:

```kv3
{ _class = "RenderMeshFile" name = "abaddon_model_lod1" filename = "models/heroes/abaddon/abaddon_abaddon_model_lod11.dmx" }
```

### 2.3 LOD

61.6% of models carry an explicit `LODGroupList`; LOD group count mean 1.22,
**p50 = 2** (a "default" group and one LOD), max 3. Each `LODGroup` holds a
`switch_threshold` and `mesh_references`:

```kv3
{ _class = "LODGroup" switch_threshold = 1.0 mesh_references = [ { mesh_name = "abaddon_model_lod1" } ] }
```

### 2.4 Skeleton

92.7% of models are skeletal. Bone count mean 27.5, **p50 = 15, p90 = 60**,
max 284. Bones are a nested hierarchy (`Bone` nodes with `origin`/`angles` and
child `Bone` nodes), each typically flagged `do_not_discard = true`.

### 2.5 Animation

48.3% of models carry an `AnimationList`. `AnimFile` count mean 6.8,
**p50 = 0, p90 = 16**, max 315. Animations are grouped in `Folder`s, each
`AnimFile` naming `source_filename` (a `.dmx`), `activity_name`
(`ACT_DOTA_IDLE`, `ACT_DOTA_SPAWN`, …), fade times, and looping/worldSpace
flags. Animation events are abundant (18,856 `AnimEvent`): cloth effects
(`AE_CL_CLOTH_EFFECT` 5,912), sounds (`AE_CL_PLAYSOUND` 10,139), and particle
spawns (`AE_CL_CREATE_PARTICLE_EFFECT[_CFG]` 1,315).

### 2.6 Collision

57.6% carry `HitboxSetList`; mean 8 hitboxes (p50 = 2, p90 = 29) across
`HitboxSet` groups.

### 2.7 Attachments, weight lists, pose params

- `AttachmentList` in 40.3% (mean 1.6 attachments); an `Attachment` binds
  `parent_bone`, `relative_origin`/`relative_angles` (attach points like
  `attach_hitloc`, `attach_eye_r`, `attach_attack1`).
- `WeightListList` in 9.0%, `PoseParamList` in 13.9% (e.g. the `turn`
  pose-space parameter).

### 2.8 Material binding

There is **no per-mesh `m_material` and no `m_materialGroups`** in the
decompiled `.vmdl` — the modeldoc assigns materials at the mesh level (inside
the compiled mesh `.dmx`), not in the model file. The only material-related
node is `MaterialGroupList` (9.9% of models), used for **style remaps**:

```kv3
{ _class = "MaterialGroupList" children =
  [
    { _class = "DefaultMaterialGroup" name = "default" remaps = [  ] }
    { _class = "MaterialGroup" name = "1" remaps =
        [ { _class = "BaseMaterialRemap"
            from = "materials/models/items/windrunner/windrunner_arcana/windranger_arcana_flowers.vmat"
            to   = "materials/models/items/windrunner/windrunner_arcana/windranger_arcana_flowers_style1.vmat" } ] }
  ] }
```

### 2.9 Physics

Physics is a niche: **1.8%** (57 files) declare `PhysicsShapeList` (455
`PhysicsShapeCapsule`, 1 `PhysicsShapeSphere`, 5 `PhysicsHullFile`). The vast
majority of models are kinematic/skinned with no rigid-body shapes.

---

## 3. Material (`.vmat`) structure

### 3.1 Format — KeyValues, not KV3

Decompiled materials are **quoted KeyValues**, wrapped in a `Layer0` block —
*not* the KV3 `m_shader = "…"` shape the skill documents:

```
"Layer0"
{
	"shader"	"hero.vfx"
	"F_ALPHA_TEST"	"1"
	"g_flSpecularExponent"	"20"
	"TextureColor"	"materials/models/heroes/zuus/zuus_color.png"
	"Compiled Textures"
	{
		"g_tColor"	"materials/models/heroes/zuus/zuus_color_psd_40f4f8c0.vtex"
		"g_tNormal"	"materials/models/heroes/zuus/zuus_normal_psd_5d33a388.vtex"
	}
}
```

The sample is single-layer (layer count mean 1, max 1). A material therefore
has: a `shader`, feature flags (`F_*`), numeric params (`g_fl*`/`g_v*`/`g_b*`),
source texture refs (`Texture*` → `.png`/`.tga`), and a `Compiled Textures`
block (`g_t*` → `.vtex`).

### 3.2 Shader (`shader`, not `m_shader`) — Top 10

| Shader | Files | % |
|--------|------:|--:|
| `hero.vfx` | 2,266 | 88.9% |
| `global_lit_simple.vfx` | 140 | 5.5% |
| `projected_dota.vfx` | 100 | 3.9% |
| `spring_meteor.vfx` | 19 | 0.7% |
| `cables.vfx` | 14 | 0.5% |
| `crystal.vfx` | 5 | 0.2% |
| `refract.vfx` | 2 | 0.1% |
| `ice_surface_dota.vfx` | 2 | 0.1% |
| `shadow_receiver.vfx` | 1 | <0.1% |

Hero/creep/courier/item materials are effectively all `hero.vfx`.

### 3.3 Textures — two parallel parameter sets

Every material carries **source** texture refs (`Texture*`, pointing at
`.png`/`.tga`) and a **compiled** block (`g_t*`, pointing at `.vtex`). Compiled
texture count p50 = 7, p90 = 8. Top compiled keys (`g_t*`, across 2,549 files):

| Key | Files | | Key | Files |
|-----|------:|-|-----|------:|
| `g_tColor` | 2,550 | | `g_tDetail2` | 2,026 |
| `g_tNormal` | 2,349 | | `g_tDiffuseWarp` | 884 |
| `g_tFresnelWarp` | 2,266 | | `g_tCubeMap` | 753 |
| `g_tMasks2` | 2,120 | | `g_tDetail` | 558 |
| `g_tMasks1` | 2,067 | | `g_tColorWarp3D` | 110 |

The `g_t*` prefix is therefore the **universal compiled-texture convention**
(16,014 `g_t*` instances vs 34,922 source `Texture*` instances). Top source
keys mirror them: `TextureColor`, `TextureNormal`, `TextureFresnelWarp{Rim,Color,Spec}`,
`TextureSelfIllumMask`, `TextureSpecularMask`, `TextureRimMask`,
`TextureTintByBaseMask`, `TextureSpecularExponent`, `TextureDetailMask`,
`TextureDiffuseWarpMask`, `TextureMetalnessMask`, `TextureTranslucency`.

### 3.4 Parameter budget

- Total params per file: mean 42.5, **p50 = 43, p90 = 58**, max 70.
- Numeric params: `g_fl*` 42,995 and `g_v*` 14,067 instances across the corpus
  (`g_b*` 306) — e.g. `g_flSpecularExponent`, `g_flRimLightScale`,
  `g_vSpecularColor`, `g_vRimLightColor`.

### 3.5 Feature flags (`F_*`) — Top 15

Flag count per file: mean 5.1, **p50 = 5, p90 = 8**. Top flags:

| Flag | Files | % | Meaning |
|------|------:|--:|---------|
| `F_MASKS_2` | 2,120 | 83% | second packed mask texture |
| `F_MASKS_1` | 2,067 | 81% | first packed mask texture |
| `F_USE_STATUS_EFFECTS_PROXY` | 2,026 | 80% | status-effect (frost/silence) tint proxy |
| `F_ALPHA_TEST` | 1,364 | 54% | alpha testing |
| `F_DIFFUSE_WARP` | 884 | 35% | diffuse warp texture |
| `F_SPECULAR_CUBE_MAP` | 758 | 30% | specular cubemap |
| `F_MORPH_SUPPORTED` | 709 | 28% | morph targets |
| `F_TRANSLUCENT` | 678 | 27% | translucent |
| `F_USE_HERO_EFFECTS_PROXY` | 565 | 22% | hero-effect proxy |
| `F_DETAIL` | 558 | 22% | detail layer |
| `F_MASK_CUBE_MAP_BY_METALNESS` | 229 | 9% | cubemap mask from metalness |
| `F_RENDER_BACKFACES` | 112 | 4.4% | **double-sided** |
| `F_ADDITIVE_BLEND` | 101 | 4.0% | **additive** |
| `F_TINT_SELF_ILUM` | 54 | 2.1% | self-illum tint |
| `F_DO_NOT_CAST_SHADOWS` | 25 | 1.0% | no shadow casting |

Special-effect flags are a small minority: double-sided 4.4%, additive 4.0%,
tint self-illum 2.1%. Self-illumination itself is common via the
`TextureSelfIllumMask` slot (present in 2,154 = 85% of materials), not via a
flag.

---

## 4. Most common shader + flag combinations

The corpus is highly stereotyped — every hero material is `hero.vfx` plus a
handful of feature flags. Top 5 combinations (`stats.json → c_combos`):

| Rank | Shader + flags | Files |
|-----:|----------------|------:|
| 1 | `hero.vfx` + ALPHA_TEST, DIFFUSE_WARP, MASKS_1, MASKS_2, TRANSLUCENT, USE_STATUS_EFFECTS_PROXY | 119 |
| 2 | `hero.vfx` + MASKS_1, MASKS_2, USE_STATUS_EFFECTS_PROXY | 115 |
| 3 | `hero.vfx` + ALPHA_TEST, MASKS_1, MASKS_2, TRANSLUCENT, USE_STATUS_EFFECTS_PROXY | 105 |
| 4 | `hero.vfx` + ALPHA_TEST, DIFFUSE_WARP, MASKS_1, MASKS_2, MORPH_SUPPORTED, SPECULAR_CUBE_MAP, USE_STATUS_EFFECTS_PROXY | 102 |
| 5 | `projected_dota.vfx` + USE_COLOR_TEXTURE_ALPHA_CHANNEL | 90 |

The invariant core is `F_MASKS_1` + `F_MASKS_2` + `F_USE_STATUS_EFFECTS_PROXY`;
`F_ALPHA_TEST` / `F_TRANSLUCENT` / `F_DIFFUSE_WARP` are the common add-ons.

---

## 5. What the `dota2-model` skill should change

1. **`.vmdl` is modeldoc, not `m_meshList`.** Replace the `m_meshList` /
   `m_material` / `m_refLODGroup` / `m_smdl` quick-reference with the
   `rootNode`/`children` node graph (RenderMeshList, LODGroupList, Skeleton,
   AnimationList, AttachmentList, HitboxSetList, MaterialGroupList).
2. **Meshes are imported `.dmx` files**, referenced by `RenderMeshFile.filename`
   — there is no inline `m_meshList` and no `m_smdl` field name in the corpus.
3. **Materials are bound in the mesh, not the model.** The `.vmdl` has no
   material assignment; style variants use `MaterialGroupList` →
   `BaseMaterialRemap { from, to }`.
4. **`.vmat` is quoted KeyValues** wrapped in `"Layer0" { }`, with `shader`
   (not `m_shader`), `F_*` feature flags, `g_fl*`/`g_v*` numeric params,
   source `Texture*` refs, and a `"Compiled Textures"` block of `g_t*` refs.
5. **The shader is `hero.vfx`**, not `dota_hero.vfx`. The canonical hero
   material is `hero.vfx` + `g_tColor` + `g_tNormal` + `g_tMasks1` +
   `g_tMasks2` + `F_MASKS_1` + `F_MASKS_2` + `F_USE_STATUS_EFFECTS_PROXY`.

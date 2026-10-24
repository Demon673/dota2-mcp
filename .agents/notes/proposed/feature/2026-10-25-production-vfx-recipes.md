# Agent Note: Production-grade VFX recipes and visual acceptance

English | [中文](2026-10-25-production-vfx-recipes.zh.md)

Status: proposed

## Problem

The current `dota2-vfx` skill proves the asset pipeline with a minimal glow, but it does not teach an agent to produce a usable gameplay effect. A real effect couples visual intent, parent/child systems, materials, control points, attachment, timing, end-cap behavior, performance, and ability integration. Corpus statistics and a list of valid fields cannot supply those decisions, and a visible but generic sprite is not evidence that an agent can build a projectile, telegraph, or buff that works in a game.

## Proposal

Build a small executable curriculum rather than a larger prose reference. Each recipe is a complete, source-safe, engine-verified example with a single gameplay purpose and an acceptance path.

### Recipe contract

Every recipe contains:

- **Intent and readability**: the gameplay cue, shape, color role, radius, duration, and what the player must recognize.
- **Complete assets**: all parent/child `.vpcf` sources and required material/texture references. Author source-safe KV3; do not paste VRF-expanded output as authoring guidance.
- **Runtime mapping**: control-point numbers and meanings, attachment entity/point, position/orientation requirements, and any `SetParticleControl*` calls needed by the preview or ability.
- **Timing and lifecycle**: emitter type, lifetime, delays, fade/end-cap behavior, looping versus burst, and how the instance is stopped without leaking.
- **Integration**: the ability/modifier hook that creates and destroys the effect, team/color/duration parameters that should be data-driven, and the server-authoritative boundary.
- **Budget and evidence**: measured particle count and frame cost relative to a baseline, a documented budget justified by that measurement, known fallbacks, timed expected images, and adaptation pitfalls.

Keep each recipe independently retrievable through `dota2_skill`; an agent requests the recipe matching its intent instead of reading the full skill or corpus.

### Initial curriculum

Implement and validate three recipes before expanding the library:

1. **AoE telegraph + impact**: a ground marker with a precise radius and duration, followed by a short burst. Covers control-point positioning, telegraph readability, timed children, and cleanup.
2. **Projectile + trail + impact**: a moving source with an oriented trail and a terminal effect. Covers origin/forward mapping, travel timing, attachment alternatives, and endpoint cleanup.
3. **Persistent buff/debuff aura**: an entity-attached effect with a clear team role and explicit stop. Covers attachment, loop lifecycle, duration changes, and removal on modifier destruction.

Only after these pass, consider a channelled beam or more specialized recipes. Do not turn the first slice into a catalog of dozens of unverified patterns.

### Preview and integration support

Extend `vfx_preview` only where a recipe exposes a real limitation: multiple control points, orientation, entity attachment, and replay/restart. Verify every ParticleManager API name and signature through the live console before adding it. Keep the existing simple path intact. Timed screenshots are the first acceptance mechanism; a separate decision is required before adding video or sequence capture, because the current screenshot tool is intentionally single-frame.

Validate integration in an actual ability/modifier as well as through the preview tool. A correct world-origin preview does not prove correct hero attachment or ability timing.

## Alternatives considered

- **Add more corpus statistics and prose.** Rejected: they improve reference coverage but cannot teach composition, timing, integration, or acceptance.
- **Ship a large library of raw VRF-decompiled official effects.** Rejected: decompilation fills defaults and can expose legacy fields that are unsafe for hand-written sources. Official effects may be studied, but shipped recipes must be source-safe and verified live.
- **Treat a nonzero particle id or one visible sprite as success.** Rejected: creation does not prove visibility, placement, timing, integration, performance, or cleanup.
- **Start with video generation.** Rejected for the first slice: complete assets and timed visual checkpoints are prerequisites; video is an optional later acceptance aid, not the knowledge source.

## Acceptance criteria

- All three initial recipes compile, pass `asset_check_refs`, and produce the intended visible result in a clean test addon and one live addon. There are no load errors or leaked instances after stop/modifier destruction.
- Each recipe ships every contract listed above, including runtime mapping, timing, integration, measured budget, and expected timed images. No recipe depends on an unstated control point or an unnamed material.
- A fresh agent can follow one recipe to change color, radius, and duration without invalid fields or structural edits, then complete the same compile → preview → visual acceptance → stop loop.
- Retrieval returns only the selected recipe and its required assets, not a full-corpus report. Offline tests cover recipe lookup and schema; live evidence is recorded in the implemented Agent Note.

## Risks

- Particle APIs and accepted KV3 fields vary by engine version; every recipe must be verified against the running engine and marked with its verification context.
- A preview can hide integration mistakes, so ability/modifier validation is mandatory rather than optional.
- Frame-cost measurements are machine- and scene-dependent; budgets must state the measurement context and cannot become universal constants.
- Timed still images can miss motion artifacts. If they cannot evaluate a recipe's key behavior, that recipe needs a separately approved motion-capture path rather than a weaker acceptance claim.

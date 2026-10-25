# Follow-up work

English | [中文](TODO.zh.md)

This is the active follow-up list. Remove items as they are completed; keep the linked Agent Notes as the detailed design owners.

## Screenshot contract decisions

- [ ] **Resolve the WGC build-failure fallback with issue #12.** The spec requests a PrintWindow fallback, but the bounded live experiment showed that PrintWindow can hang with the game. Either implement a separately bounded fallback with an explicit hang limitation, or update the spec and owning note to agree on the no-fallback behavior. Do not silently substitute a full-screen capture.
- [ ] **Find a reliable runtime exclusive-fullscreen signal, or explicitly accept the saved-config limitation.** Live probes showed that `WS_POPUP`, `WS_EX_TOPMOST`, monitor bounds, and DWM attributes can all match between exclusive and borderless windows, so the style heuristic was reverted rather than shipped. Until an engine-supported source exists, unsaved display-mode changes remain a documented limitation.
- [ ] **Define first-ever hang/no-cache behavior.** If WGC has never delivered a frame, a sustained hang can still yield `no_frame`. Either provide a safe, proven fallback or amend the universal-hang user story to state this limitation explicitly.
- [ ] **Decide whether `hung: false` must be printed on every success** to match the metadata contract, rather than only printing `hung: true`.
- [ ] **Complete remaining live checks:** a real timeout while the window is being restored, the capture border, the Windows "not responding" ghost image, and a real window resize. For resize, use a user-driven or otherwise supported resize path; Win32, cvar, and temporary-style attempts were rejected by the current Dota video mode.

## Production-grade VFX authoring

Follow [Production-grade VFX recipes and visual acceptance](../.agents/notes/proposed/feature/2026-10-25-production-vfx-recipes.md).

- [ ] **Measure per-frame cost for the three recipes.** Each recipe records its sprite count; none has a measured frame cost. Measure against a baseline scene and state the measurement context, since a budget cannot become a universal constant.
- [ ] Validate the AoE and projectile recipes inside a real ability/modifier, not only through `vfx_preview`. The aura already runs through a `LinkLuaModifier` modifier with creation, duration expiry and removal captured.
- [ ] Add a fresh-agent evaluation: using only the selected recipe, adapt color, radius, and duration, then complete compile → reference check → preview → timed visual acceptance → stop without structural errors or leaked instances.
- [ ] Decide separately whether motion requires a video/sequence-capture path. Do not weaken the existing single-frame screenshot contract by implication.

## Runtime and tooling follow-ups

- [ ] **Exercise the non-tools cheat guard.** Find a supported way to enable the VConsole listener on 29000 without tools mode, then verify that the addon forces `sv_cheats=0` and how the temporary-enable flow behaves. The tools-mode wrapper experiment passed; the actual non-tools guard remains unverified.
- [ ] **If temporary cheats become a product feature, make it explicit opt-in.** Preserve the original value, wait for deferred Lua completion, and report unconfirmed restoration. Never enable it silently by default or fight an addon's intentional guard.
- [ ] **Restore or replace the local pre-commit hook path** (`Can't find lefthook in PATH`). Keep the manually run offline suite and document gates as the required baseline.
- [ ] **Decide the fate of the test particle** `particles/mcp_preview_test/visible_glow.vpcf` in the current test addon and its compiled output. Keep it as a minimal example or delete it only after explicit confirmation; do not modify unrelated addon files.
- [ ] **Clarify marker ownership** if the console collection code is touched again: `newMcpMarkers()` in `src/index.ts` and `MCP_MARKER_RE` in `vcon-relay.ts` must not drift apart.

## Existing roadmap

- [ ] **BuildTools** — npm/tstl/rollup build integration and scaffolding generation.
- [ ] **[dota_map_error](../.agents/notes/proposed/feature/2026-08-05-dota-map-error-tool.md)** — static generated-Lua-to-TypeScript source-line mapping.
- [ ] Verify the actual output of `script_find` and `script_dump_all` while the game is running.
- [ ] Test `dota_launch_game` across more addon/map combinations.

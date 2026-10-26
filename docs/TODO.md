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

## Panorama debugger and UI operation

Follow [Panorama UI control through the debugger](../.agents/notes/proposed/feature/2026-10-26-panorama-ui-control.md).

- [x] **Panorama bridge lifecycle core (2026-10-26):** `panorama_exec_js` is implemented on a transient addon-content dynamic HUD bridge: two source files are copied into the addon content, compiled on demand, loaded with `CustomUI:DynamicHud_Create`, executed through `RunScriptInPanelContext`, and deleted after a ping; the daemon owns the token/state and the ping/started/done ack protocol, and the bridge is reused idempotently. The bridge also exposes geometry, world/cursor, selection, camera and order helpers, plus background event helpers (`MCP.on`/`emit`/`dispatch`). Verified live: `1+1=2`; long chunked code `42`; `MCP.context()` parent chain/global probe; global selectors from `DotaHud` (`MCP.top/select/$`); probe-panel creation/deletion; `MCP.text/visible/cls/style/snap` round-trip; semantic helper smoke; map reload `rebuilt:true`; old-generation HUD cleanup through the recorded element id; content-junction repository unchanged.
- [ ] **Harden the remaining Panorama bridge lifecycle:** sweep a failed provisioning, measure a full Dota process restart/cache eviction, and cover the full live matrix. A provisioning attempt from the main menu returns `bridge_compile_failed` (the addon content is not mounted until a map loads); in-game provisioning works.
- [x] **MCP output isolation from the vconsole2 GUI (2026-10-26):** the real boundary is the collect-output echo marker pair (`__mcp_<hash>_begin/end`): the relay keeps an open-window set keyed by marker id (a matching end closes only its own window, so concurrent sessions cannot interfere; an unclosed window expires after 15 s), the Lua path prints the end marker after its deferred body, async MCP prefixes are filtered, direct commands open timed holds, and the engine's replayed console backlog is dropped on connect. A live fake-GUI capture showed the human's own echo while status/console/Lua/bridge/API/entity probes stayed out. See the [isolation note](../.agents/notes/implemented/bug-fix/2026-10-26-console-output-isolation.md).
- [x] **Live isolation coverage (2026-10-26):** a stand-in GUI on 29001 captured the raw stream while MCP tools ran against the real engine — status, `dota_api_lua`, `dota_dump_entities`, `dota_run_lua`, `console_send`, `dota_disconnect` → `dota_launch_game`, `panorama_exec_js`, `vfx_preview`/stop, `dota_test_run` and `dota_restart`. Bare-CMND human echo lines before and after the battery stayed visible; every MCP probe signature was absent; Dota survived the stand-in GUI teardown.
- [x] **Live two-session interleaving (2026-10-26):** two MCP sessions fired concurrently — session A a deferred `dota_run_lua`, session B a synchronous collected `console_send`. The stand-in GUI received only the two bare-CMND human echo lines: neither session's output nor markers leaked, and A's deferred print (which runs after B's end marker) stayed hidden, proving B's end cannot close A's window.
- [ ] **Decide multi-root access for Panorama.** The bridge reaches only the HUD top-level window: `DotaHud.GetParent()` is null, `RunScriptInPanelContext` from the bridge is rejected by domain, and the live JS API exposes no root-panel accessor, so sibling top-level windows (dashboard/debugger) cannot be selected by id. Choose between a debugger-assisted per-root context bridge and accepting the HUD boundary; validate with a concrete sibling id.
- [ ] **Evaluate the working console diagnostics as read-only tools.** `panorama_dump_symbols 0|1` (event and file symbol tables) and `panorama_print_cache_status` (layout refcounts) work live; `panorama_print_render_tree` printed nothing for `*` and named roots, and `panorama_dispatch_event` now works with the `EventName(args...)` syntax (`CreateDebuggerWindow()` opens the debugger without a hotkey or game focus; `TextEntrySetText` still needs a creating panel).
- [x] **Define the focus-takeover contract before any interactive tool.** `dota_input` defaults to leaving the game foreground, restores the cursor, and offers `restore_focus` as an opt-in; restoration re-shows a hidden game window without activating it. Measured in `-tools` mode: Dota hides the game window when it loses focus, so keeping the game focused is the usable default.
- [x] **Window and input tools:** `dota_input` provides real mouse/keyboard input with client-area coordinates, bounds rejection, window info and focus/cursor controls. Live checks cover activation, hover enter/leave, Unicode text and key presses.
- [ ] **Add a blocking console wait** (`console_wait`: pattern or regex, timeout, optional trigger command) on the per-session cursor, plus an `errors` filter preset. The reference-project review rated this the most useful debug-loop primitive.
- [ ] **Diagnose hidden modals on capture failure.** When WGC returns `no_window` or `no_new_frames`, enumerate Dota's top-level windows and append assert/stall/dialog text to the error; keep it read-only and never dismiss dialogs.
- [ ] **Evaluate the knowledge-layer absorbs** from the reference-project review: the 77-pattern KB as a `dota2_skill` data file, and base-game KV lookups through VRF. Skip the bundled API snapshot (console stays authoritative) and the hand-written decoders.

## Existing roadmap

- [ ] **BuildTools** — npm/tstl/rollup build integration and scaffolding generation.
- [ ] **[dota_map_error](../.agents/notes/proposed/feature/2026-08-05-dota-map-error-tool.md)** — static generated-Lua-to-TypeScript source-line mapping.
- [ ] Verify the actual output of `script_find` and `script_dump_all` while the game is running.
- [ ] Test `dota_launch_game` across more addon/map combinations.

# Agent Note: Panorama debugger inspection and multi-root access

English | [中文](2026-10-26-panorama-ui-control.zh.md)

Status: proposed

## Problem

The HUD bridge shipped in [the implemented note](../../implemented/feature/2026-10-26-panorama-bridge-and-input.md) reaches the HUD top-level window only. The engine's Panorama Debugger exposes every panel with its position, class, attributes and styles, and its JavaScript console can run code in a selected panel's context, but its inspection data is rendered text and sibling top-level windows (dashboard, debugger) have separate JavaScript contexts. An agent still cannot inspect those roots, read the inspector's tree/styles machine-readably, or decide whether a debugger-assisted path earns its fragility.

## Proposal

### Debugger-driven inspection

- Open the debugger without a hotkey through `panorama_dispatch_event CreateDebuggerWindow()`; no game focus is needed to open it. The console still needs a JavaScript-backed panel selected and typed input while the debugger owns the foreground; the one-slot cache makes the console a fallback, not a primary path.
- Event strings use `Name(args...)` with single-quoted arguments; `panorama_dispatch_event` creates the event with no creating panel, so `TextEntrySetText` is a no-op for the console input.
- The inspector exposes data only as rendered text. A machine-readable readback needs a channel (clipboard, a debugger log, or another engine hook), and that channel decides whether a debugger tool ships at all.
- The console's paste limit is near 128 characters and its first compiled script is cached for the whole process; a stray submission can poison it until the next Dota restart. Any tool on this path must own the first submission or detect the stale cache.

### Multi-root access

- The bridge reaches `DotaHud` and nothing above it: `DotaHud.GetParent()` is null, `RunScriptInPanelContext` from the bridge is rejected by domain, and the live JavaScript API exposes no `GetRootPanel`/`GetAllPanels`. Sibling top-level windows have separate contexts.
- Decide between a debugger-assisted per-root context bridge and accepting the HUD boundary; validate with a concrete sibling id (`MCP.select('#Dashboard')`/`#DashboardCenter` returned null from the HUD root while the dashboard layouts stayed in the layout cache).

### Bridge lifecycle hardening

- The shipped bridge still needs a failed-provisioning sweep after a kill, a measured full Dota process restart/cache-eviction matrix, and large-result/chunk edge cases.
- The fed JavaScript is bounded by the `dota_run_lua` statement limit (~510 bytes wrapped, ~300 bytes of Lua); longer code would need event chunking with client-side reassembly, a file the client reads, or another bridge.
- The process layout cache is keyed by resource path, so a bridge revision at the same path can serve the old source; decide whether a revision needs a new path or one revision per game process.

## Measured behavior

Live measurements on a `-dev -tools` session; every claim below is from the running engine unless marked otherwise. The bridge and input measurements moved to the implemented note.

- The debugger is a second top-level `SDL_app` window in the Dota process titled `Panorama Debugger`; it has no child windows.
- `panorama_toggledebugger_mode` is a hidden ConVar whose help reads "Toggledebugger key operation : 0 = open/inspect, 1 = open/close"; setting it did not create or close a window in the live session. The engine's debugger hotkey does: with the `Dota 2` window focused, a synthetic F6 created the `Panorama Debugger` window; `WM_CLOSE` closes it and a later F6 recreates it.
- `panorama_dispatch_event CreateDebuggerWindow()` also creates the debugger: the window appeared with `panorama/layout/debugger.xml (87 refs)` in `panorama_print_cache_status`; `PrintWindow` captured the blank inspector and its JavaScript Console input. No hotkey or game focus is needed to open it.
- The ConVar's two modes behave as the help says. With `1` (open/close), F6 opens a populated inspector whose tree, style pane and context line are live: clicking a tree row changes the selection, the inspect button plus a click on the game's minimap selected `DOTAMinimap#minimap`, and the search and console fields accept typed text. With `0` (open/inspect), F6 opened a blank window that ignored the same clicks and keys. The earlier empty-window observation was this mode, not a broken window.
- Typing into the JavaScript console works only while the debugger window really owns the foreground. Every submitted line is echoed. When the call returns before V8, the echo is followed by `1`; when it executes, the echo is followed by the script's own output and no `1` appears.
- The console executes when the selected panel belongs to a layout that has a JavaScript context. A minimal addon custom UI (a `custom_ui_manifest.xml`, a layout with `<scripts>`, and a JS file) compiled with `resourcecompiler` and loaded in game; `$.Msg("MCP_UI_TEST_LOADED")` reached the `PanoramaScript` channel. After the debugger's inspect click selected `#McpUiTestLabel`, submitting `McpUiTestPing("HELLO123")` ran the function: the label text changed to `PING HELLO123` and `MCP_UI_TEST_PING HELLO123` appeared on `PanoramaScript`. A base-game dashboard layout also supplied a working context, so a JavaScript-backed layout is sufficient; the addon UI was the convenient one under test.
- The top-level boundary is measured: `DotaHud.GetParent()` returned null; `RunScriptInPanelContext` on `DotaHud` from the bridge threw `RunScriptInPanelContext must be called from a context with a domain that matches this panel`; the live `$` API exposed no root accessor; and `MCP.select('#Dashboard')`/`#DashboardCenter` returned null from the HUD root while dashboard layouts remained in the layout cache. The bridge therefore covers the HUD top-level window, not its sibling windows.
- The console caches the first successfully compiled script for the whole client process. Every later submission — different text, different panel, different context — re-runs that first script instead of compiling the new input; the cache key is the fixed source name `JSConsoleInput`. A full map reload created a new context (the debugger's context pointer changed and the layout's `$.Msg` re-ran), yet the cached script still ran; in a dashboard context it produced `Uncaught ReferenceError: McpUiTestPing is not defined`.
- Closing and reopening the debugger window, `hud_reloadscheme`, and a map reload do not clear the cache. Only restarting the Dota process does. The console's command list exposes no reset: `find panorama`, `find reload`, `find lrucache`, `find v8` and `find script` contain no script-cache command, and `lrucache_flush` covers only the asset-thumbnail and word-filter caches.
- Runtime failures print in the debugger and on the engine console: `JS Exception! *** Skipping rest of script ***`, the `JSConsoleInput` source name and line, the script text, and the stack; `PanoramaScript` carries the same text at verbosity 3. Compile failures were not produced in a JavaScript-backed context, so their output is unverified.
- The console input is a Panorama TextEntry, not a normal edit control. Clipboard paste works when the window is foreground; `Ctrl+A` does not select the existing text (pastes append). The TextEntry drops long pastes: a 113-character script landed and a 133-character script was silently dropped, so the practical limit is near 128 characters; the 109-character bootstrap fits. Multi-chunk pastes are unreliable. The window can open with an empty tree and style pane; opening it while the game window keeps the foreground, selecting a panel with the inspect click, and closing and reopening once produces a populated inspector.
- The debugger's tree and style pane can be empty even in mode `1` when the window was opened while focus moved away during initialization; the same window retains a selection made earlier, and a close/reopen populates it.
- The `1` acknowledgment is not an execution result; successful execution is observed through side effects (panel changes) and `$.Msg` output on `PanoramaScript`.
- Posted `WM_CHAR` and `SendMessageTimeout` text are ignored by the window. `SendKeys`/`SendInput` works once the window is foreground; the foreground sequence `AttachThreadInput` + `BringWindowToTop` + `SetForegroundWindow` + `ShowWindow` succeeds from a helper process.
- `panorama_dump_symbols <type>` works live: `0` prints 14,471 event symbols (`MoveUp`, `JSScheduledFunction`, `ReloadChangedUIFiles`, ...) and `1` prints 581 file symbols; every other type value prints the usage line.
- `panorama_print_cache_status` prints the layout cache summary (267 layouts with refcounts). `panorama_print_render_tree` is a string ConVar — "Print the RenderOperation_t tree for the given root window; set to * to print all" — but the live values `*`, `Dota` and `dota2` printed nothing.
- `panorama_dispatch_event` creates an event from the argument string and dispatches it with no creating panel. The accepted syntax is `EventName(args...)`; the parser requires the `(`, looks up the event name in its symbol table, and splits arguments on commas outside nested parentheses, with single-quoted strings. `CreateDebuggerWindow()` opened the debugger; flat names, brace forms and `TextEntrySetText(...)` without a creating panel did not produce an observable event effect.
- `cl_script_reload_code <name>` executes a client VScript Lua file from `{addon}/game/scripts/vscripts/` (`CL_VM_OK`). An external path outside that mount fails with "type does not match VM type"; a missing extension is searched with `.lua`. Client VScript exposes 154 functions, including `SendToConsole` and `DoIncludeScript`, but no Panorama or JavaScript entry.

## Engine surface

The bridge-side `RunScriptInPanelContext`/`CustomUIManager` surface is recorded in the implemented note; these are the debugger-side facts.

- `panorama_dispatch_event` calls `CUIEngine` vtable slot `+0x330` (`CreateEventFromString`) with a null creating panel, then dispatches the created event through vtable slot `+0x178`. The parser reads the event name up to the first `(`, looks it up in a symbol table, then splits arguments on top-level commas, handling nested parentheses and single-quoted strings.
- The debugger's console submit lives in client.dll (`CPanoramaClientDebugger`), not panorama.dll: a native `TextEntrySubmit` handler for the `JSConsoleInput` TextEntry calls `CUIEngine::RunScript (compile+run)` — UIEngine vtable slot `+0x268` — with the selected panel's context, the text, and the source name `JSConsoleInput`. That fixed source name is also the cache key: the first compiled script is reused for every later submit, so the console runs one script per process.
- `CUIEngine::RunScript` resolves a V8 context through `GetContextForPanel` and returns silently when it gets none (layouts without a JavaScript context). For a JavaScript-backed layout it compiles and runs the text. Only `RunFunction` prints a result (`=> value`) through `JSConsoleOutput`; the console's `RunScript` path prints no return value, so results are observed through side effects and `$.Msg`. `GetContextForPanel` either reuses a context cached per panel or creates a new V8 context, and has an early null path for panels with particular flags.
- Binary strings also expose `JSConsoleOutput`, `ToggleDebugger` and `CreateDebuggerWindow`; they are registered Panorama UI event schemas. `CreateDebuggerWindow` is dispatchable through `panorama_dispatch_event`; the debugger hotkey is the `CDebuggerInputHandler` class, which binds `PanoramaDebuggerHotkey`.
- The debugger layout's JavaScript handlers (`PrevSearch`, `UpdateJSConsolePriorHistory`) exist only as event expressions in `panorama/layout/debugger.vxml_c`; the native submit handler and the `JSConsoleInput`/`JSConsoleText` bindings are compiled into client.dll.

## Open questions

- Remaining bridge hardening: a failed-provisioning sweep after a kill, a measured full Dota process restart, and large-result/chunk edge cases. The bridge is identified by ping, not the one-time `MCP_BRIDGE_READY` marker.
- How should longer fed code travel: split across events with client-side reassembly, a file the client reads, or a dedicated bridge? The current event is bounded by the `dota_run_lua` statement limit.
- Can `TextEntrySetText` or `TextEntrySubmit` be dispatched to a specific panel without focus? `panorama_dispatch_event` creates the event with no creating panel, and the event is a no-op for the debugger input in that form; another event route or a native submit path would remove the focus/typing step from the fallback.
- Can the debugger's rendered inspection data (tree, style pane, context line) be read back machine-readably, through the clipboard or an engine hook, without OCR?
- Can the console be operated without taking the foreground? Posted input is ignored, so the current answer is no.
- Is a debugger-assisted per-root context reachable at all, or is the HUD boundary final? The live API exposes no root accessor, so this needs a concrete sibling-window experiment.

## Alternatives considered

- **Debugger console as the primary execution path.** Rejected: it needs foreground typing, a JavaScript-backed selected panel and a process-wide one-slot script cache. The shipped bridge took this role (implemented note).
- **A debugger-assisted per-root context bridge.** Open: the bridge cannot reach sibling top-level windows, and the debugger can select panels across roots, but reading its result and typing into it remain unsolved.
- **Accept the HUD boundary.** The fallback if no machine-readable inspection channel exists; it leaves dashboard/debugger roots uninspectable.
- **Read the debugger's output pane by screenshot and OCR.** Rejected: fragile, slow, and unnecessary if a console or event channel can carry the result.
- **A native path to sibling roots.** Unverified: the live `$` API exposes no root accessor; a binary-level hook is a larger investment than the debugger route.

## Acceptance criteria

- A concrete decision on multi-root access, validated against a sibling top-level window.
- If a debugger tool ships, a machine-readable inspection result without OCR, with the console cache and foreground typing handled or explicitly bounded.
- The remaining bridge lifecycle matrix is recorded: failed provisioning, a full Dota process restart, and large-result handling.

## Risks

- The debugger and its console are undocumented engine tools; a patch can rename the window, the command or the JavaScript binding. The script cache is a measured, version-specific behavior, so the console must be re-measured each engine version before relying on it.
- The process-wide one-slot cache makes the debugger fallback fragile: a single stray submission — including a developer's manual `$.Msg(1)` — fills it until the next Dota restart. A tool that relies on the fallback must own the first submission or detect the stale cache and ask for a restart.
- The debugger fallback's listener dies with the layout context on a map reload; re-arming means submitting once more in a JavaScript-backed context. A tool must handle that cycle or accept a broken fallback after a reload.
- The TextEntry drops long pastes at roughly 128 characters, and the console only accepts input while it owns the foreground.
- Multi-root access may be unreachable without foreground input, and a native hook would be a much larger surface than the bridge.

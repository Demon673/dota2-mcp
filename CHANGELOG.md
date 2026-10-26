# Changelog

English | [中文](CHANGELOG.zh.md)

## 2.0.0 (2026-10-26)

### Added

- **`dota_screenshot`**: captures the Dota 2 game window in the background and returns the image to the agent, with no console or vconsole needed. Cached frames are marked `stale` with `captured_at`; a minimized window is restored only for the capture and returned to its state afterwards. Windows only.
- **`dota_advance_to_game`**: takes a loaded game from any pre-game phase to GAME_IN_PROGRESS with a hero for every player (random, or a given `hero`). Standard flow: `dota_launch_game` or `dota_restart`, then `dota_advance_to_game`; requires `sv_cheats=1`.
- **Focused skill retrieval**: `dota2_skill` now returns one section, an outline, or one JSON fragment (`data_path`), so VFX and model work no longer needs the whole skill body.
- **`dota2-vfx` recipes**: AoE telegraph + impact, projectile + trail + impact, and persistent buff/debuff aura, each with layout, timing, control-point and modifier wiring.
- **`vfx_preview` reports whether a particle can be drawn**: an addon path missing from `Precache` returns `precache: MISSING` with the line to add, instead of a successful preview that draws nothing.
- **`dota_record`**: records the game window to MP4 even when it is occluded or unfocused and returns path, duration, fps and encoded size. Duration is 1–30 s, 12 fps by default (max 30), Windows and ffmpeg are required, and a minimized window fails explicitly.
- **`dota_perf`**: samples frame times and returns p50/p95/p99 with the sample count and duration; `baseline` compares two runs. Requires an elevated terminal; an unfocused game's empty sample is retried once with `r_always_render_all_windows` and restored.
- **`dota_test_run`**: runs assertion tests from `scripts/vscripts/tests/<name>.lua` inside the real game, one test per statement, with per-test and overall time budgets; returns `{name,status,detail}` rows.
- **`panorama_exec_js`**: inspects and drives the live client UI without editing the addon — panel lookup, geometry, game state and background events. Covers the HUD; a map reload rebuilds the bridge, and concurrent sessions share it.
- **`dota_input`**: sends real OS mouse and keyboard input to the game window in client-area pixels, with bounds rejection and optional focus/cursor restoration; `window_info` reads the window without sending input. Windows only.

### Changed

Every tool now returns one shape: `{"ok":true, ...}` with a `lines`, `text` or `data` payload, or `{"ok":false, "code": "...", "message": "..."}` with `isError`. All 38 tools carry the four MCP annotations, and every description states when to use it, what it does, what it returns, its limits and related tools. Old parameter names keep working as aliases for this release.

| Area | Before 2.0 | 2.0 |
|---|---|---|
| Every result | bare text, or raw JSON for a few tools | `{ok:true, lines\|text\|data}` / `{ok:false, code, message}` |
| Tool metadata | no annotations | four hints on all tools (`readOnly`/`destructive`/`idempotent`/`openWorld`) |
| `console_output` | last N lines; every read repeated them | cursor-incremental; `tail` / `since_seq` / `from_start`, `next_seq` and `dropped` reported; filters never consume unmatched lines; `lines` stays as an alias of `tail`; the first call tails 50 |
| `console_send` | `Sent N command(s)` only | returns the command's own output and advances the cursor; later output stays readable through `console_output` |
| `dota_status` | text summary with `running` / `allMaps` | `data` capability matrix (`daemon`, `vconsole`, `dota`, `phase`, `cheats`, `addon`, `map`, `available_actions`); `running` / `allMaps` removed |
| `dota_restart` | text | 20 s without a change is now a `timeout` failure |
| `file_read` | raw file content | `data:{path,bytes,text}` |
| `dota2_skill` | raw JSON for `data_path` | the JSON lives in the `text` field |

- Commands sent while the thin client is disconnected are dropped instead of replayed after reconnect.

### Fixed

- **Lua output leaked into vconsole**: `dota_run_lua` and `vfx_preview` output and markers no longer appear in the vconsole window, and a Lua runtime error no longer leaves the window muted.
- **Over-long Lua silently did nothing**: `dota_run_lua` now rejects code over the engine's statement limit with a clear error.
- **`dota_launch_game` reported normal map loading as stuck in INIT**, and now reports a launch that left the game at the main menu.
- **`dota_restart` returned before the restart took effect**: it now waits until the reload has begun.
- **Lua tools gave no error when `sv_cheats` was off**: `dota_run_lua`, `dota_advance_to_game` and the VFX tools now fail immediately with an error naming `sv_cheats`.
- **API queries returned full engine dumps**: the API, entity and modifier tools filter matching entries; `dota_dump_modifiers` defaults to active server modifiers.
- **`console_channels` was empty for late thin clients**: the handshake now includes the channels already registered with Dota.
- **Lua and VFX results were misleading**: scalar expression values print directly, and `vfx_preview_stop` no longer reports a void return as `ok=nil`.
- **Hung screenshot failures were ambiguous**: `dota_screenshot` returns the last frame with `stale: true` and `captured_at`, or reports that no frame was ever cached, instead of substituting a screen capture or an unmarked older image.
- **Screenshot timeout budgets were ambiguous**: after setup, each call shares one 5 s deadline for capture, stop and re-minimize; if cleanup cannot finish, the result says so.
- **Screenshot freshness was overstated**: a background frame stays `stale` until the capture session delivers a new one.
- **The VFX starter template could not render anything**: it now includes a verified sprite path, and the workflow requires before/after screenshots in addition to a nonzero particle id.
- **Custom particles never appeared**: an undeclared particle now reports `precache: MISSING`, and the skill documents the precache step and the fields resourcecompiler drops.
- **Asset references were wrong on current assets**: the pinned asset CLI reads the current KV type, `asset_check_refs` resolves shared-addon and core-VPK assets instead of reporting them broken, and `asset_inspect` counts continuous and instantaneous emitters.
- **`file_edit` corrupted files containing `$`**: `$'`, `$&` and `$1` in `new_string` are written literally.
- **FileOps path boundary bypass via `addon`**: addon names that are `.`/`..` or contain path separators or `:` are rejected.
- **Non-ASCII console text**: VConsole2 output and commands are UTF-8, so Chinese `print` output and non-ASCII Lua survive.
- **Stale game state**: `dota_status` and `dota_launch_game` no longer fall back to an old `status_json` when the query gets no answer.
- **Tool results mixed with other output**: console tools keep only the lines between per-call echo markers; each pair closes only its own window, so concurrent sessions cannot cut each other's output.
- **The local fallback relay had no auth on `:29002`**: it now requires the same token handshake as the daemon.
- **Asset tool failures looked like success**: `asset_inspect` and `asset_check_refs` return an error when the asset CLI fails or the root asset cannot be decompiled.
- **`dota_launch_game` launched the requested map even when a different map was already loaded.**
- **vconsole reconnect**: a superseded GUI socket no longer drops the live connection, and toggling MCP suppression no longer mutes the GUI.
- **Stopping the server could crash Dota**: closing the Dota connection during a send could make the game fatal-error; shutdown now waits for quiet, drains and exits cleanly.
- **Linux and macOS Steam detection**: default Steam roots are resolved from the home directory.
- **The standalone executable failed at startup**: the packaged binary now starts with or without a running daemon, falls back to the local relay, and resolves its skills next to the executable. Windows builds keep the `.exe` extension.
- **Subprocesses inherited credentials**: screenshot, recording and asset subprocesses now run with common credential environment variables removed.

## 1.6.0 (2026-08-21)

### Added

- **File tools (offline)**: `file_read`, `file_write`, `file_edit` and `file_delete` read and edit text files inside the addon without the game; paths are limited to the addon.
- **`vrf_ensure`**: downloads, verifies and caches the pinned asset CLI on first use, and goes online only when it is missing.
- **`asset_inspect`**: a stable per-type summary for particles, models, materials, textures and unknown types; raw decompiled text is opt-in and truncated.
- **`asset_check_refs`**: walks an asset's references and reports ok, uncompiled, engine and broken results, with cycle prevention.
- **`vfx_preview` / `vfx_preview_stop`**: spawn and stop a particle preview in the running game and return its id; console load errors are authoritative. Requires the game, vconsole and `sv_cheats=1`.
- **Built-in `dota2-vfx` and `dota2-model` skills**: format references, pipeline model, workflows, tool mapping, common errors and starter templates.
- **`dota2_skill` reads skill data**: `section` and `outline` read part of a skill, and `data` / `data_path` return a bundled JSON or Markdown data file.

### Changed

- **README setup**: documents the Codex desktop configuration and separates AI-assisted from manual installation.
- **Test map prerequisites documented**: the basic template's `addoninfo.txt` must declare `maps` and `IsPlayable`, and the map must be compiled before it can be launched.

### Fixed

- **WSL compatibility**: file and asset tools work under WSL — Windows tool paths are translated, the asset CLI runs from a file output, and a running Dota process is detected.

## 1.5.1 (2026-07-22)

### Changed

- **Install and client setup docs**: npx is the only recommended install path; per-client configuration (Claude Code/Desktop, Cursor, VS Code, Cline, Codex) includes config locations and paste-ready JSON, plus post-startup verification and a troubleshooting table.

## 1.5.0 (2026-07-22)

### Added

- **Auto-open vconsole**: when Dota becomes ready and no vconsole window exists, the server opens it automatically (`DOTA2_VCON_AUTO_OPEN_VCONSOLE=0` disables). A manually closed window is not reopened until the next Dota start.

### Changed

- **Breaking: the vconsole window now gates the connection.** With no window, the server does not connect to Dota, and console tools report that vconsole is not open. Closing the window releases Dota immediately, so the AssetBrowser vconsole button works again. A human can always watch the agent's console activity.
- **Precise connection errors**: tool errors now distinguish "Dota is not running" from "vconsole is not open".

### Fixed

- **Closing the server leaked the control port.**

## 1.4.0 (2026-07-22)

### Added

- **`dota_open_vconsole`**: launches vconsole and waits up to 30 s for it to attach; an existing unattached instance gets a hint.
- **`dota_launch_game` phase guidance**: success means GAME_IN_PROGRESS (timeout 90 s); a phase stuck for 15 s returns the phase, advancement steps, recent errors and a skill pointer.
- **`dota2-game-phases` skill**: normal duration and advancement for each phase, plus a stuck-phase SOP.

### Changed

- **Breaking: console tools require an open vconsole.** They report how to open it when it is missing. The AssetBrowser vconsole button is disabled while the server holds the Dota connection, so open `vconsole2.exe` directly.
- **Breaking: `project_info` merged into `dota_status`.** `dota_status` is the entry point and never throws; it returns status and next-step guidance.
- **`dota_status` output shape changed** (vconsole, maps, allMaps, running), and console tool descriptions state the vconsole prerequisite.

### Fixed

- **A late-opened vconsole was empty**: the server now replays the startup data, so the window works as soon as it opens.
- **A dead connection was never detected**: a silent echo probe is sent after 15 s of silence, and the connection is declared dead after 20 s without a response.
- **The server idled out while Dota was running**: it stays alive while the game runs.
- **GUI state changes were invisible to MCP in daemon mode**: state changes now broadcast immediately.
- **Duplicate reconnect timers**: reconnects use one timer.
- **A healthy engine could be killed during Dota startup**: zombie detection now uses the liveness probe only (about 35 s, with no false kills).
- **Map loading was misreported as stuck**: loading skips the stuck check, and a real timeout still reports ResourceSystem errors.

## 1.3.2 (2026-07-20)

### Changed

- **The relay keeps the Dota connection open permanently** and reconnects on loss; the vconsole GUI is optional, so pure-AI workflows work without it.
- **Cold-start timeout raised to 30 s**, avoiding a false fallback on slow machines.

### Fixed

- **Reconnect stopped after the first failure**: it now backs off indefinitely (capped at 5 s) and resends commands buffered during the outage.
- **A killed daemon left the session disconnected**: the session now restarts it and swaps the connection.
- **Local fallback mode killed the MCP process after 5 minutes**: idle exit now applies only in daemon mode.
- **A transient restart failure left tools disconnected forever**: it falls back locally and retries.
- **Connection timeouts leaked sockets**: the socket is destroyed and the failure counts toward reconnect.
- **A slow daemon could double-bind ports**: a timed-out daemon is stopped before falling back.
- **The fallback relay could start twice and report a false conflict.**

## 1.3.1 (2026-07-18)

### Added

- **`dota2_skill` built-in skills**: skills ship with the server; the first, `dota2-runtime-dev`, covers the long-lived process and hot reload model, generated-code boundaries and KV conventions.

## 1.3.0 (2026-07-17)

### Added

- **`dota_status` entry-point tool**: reports connection, addon and map state and points to the next tool.

### Changed

- **All tool descriptions are task-oriented**, so an agent can match user intent to a tool.

### Fixed

- **The first addon was not detected on attach**: addon and map state now come from the handshake, with a short wait for late data.

## 1.2.1 (2026-07-17)

### Fixed

- **The daemon was never actually launched**: the server now starts a detached daemon that survives the MCP session.
- **Security: the control port accepted commands before authentication.** A token handshake is now enforced.
- **Startup could hang forever when the daemon never answered.**
- **A daemon restart crashed every MCP process**; the session now reconnects and resends buffered commands.
- **Large commands could corrupt the console stream**; frames are reassembled before forwarding.
- **The npm package missed the daemon file**, so an npx install could not start it.
- **Dota install detection failed with current Steam library files**; it now reads the registry, `STEAM_PATH` and the default locations.
- **`dota_compile_asset` failed silently without a Dota install**; it now returns an actionable error.

## 1.2.0 (2026-07-17)

### Added

- **Multiple MCP sessions can share one relay**, and later sessions no longer fail on port conflicts.
- **The relay runs as a detached daemon** and exits after 5 minutes with no client.
- **Port conflicts are reported as another instance**, not as "not connected to Dota".
- **Secure local access**: sessions authenticate with a token, so commands cannot be injected without it.

### Fixed

- **The Dota path was hardcoded**; it now follows auto-detection.

## 1.1.2 (2026-06-25)

### Added

- **Steam-based Dota 2 detection**: the install path is found through Steam appid 570, with no `DOTA2_PATH` setting.
- **Automatic addon detection**: the addon comes from the connected game or a content scan, with no `DOTA2_ADDON` setting.
- **Configurable console ports**: `DOTA2_VCON_DOTA_PORT`, `DOTA2_VCON_GUI_PORT` and `DOTA2_VCON_CTRL_PORT` override the defaults.

### Changed

- **Breaking: `DOTA2_PATH` and `DOTA2_ADDON` are removed**; detection is automatic.
- **Connection requirement**: console tools now explain that Dota must be running and connected when it is not.
- **README setup**: npm install instructions and per-client configuration for Claude Desktop, VS Code, Cline and Codex, with Steam-relative path examples.

### Fixed

- **npm install and global start**: the `bin` field and published files are corrected.
- **Console stability**: unhandled errors no longer corrupt the JSON-RPC stream, and invalid filter patterns return an MCP error.
- **Console and game tool timing**: duplicate or dropped output lines are fixed, and tools no longer report results before the game process finishes.

## 1.1.0 (2026-06-25)

### Added

- Runs on Windows, Linux and macOS.
- Detects the Steam and Dota 2 install automatically.
- Produces a standalone executable for the current platform.
- GitHub Releases include prebuilt binaries for all three platforms.
- MIT license.

## 1.0.0 (2026-06-25)

First usable version.

### Added

- stdio MCP server with 20 tools.
- Console relay: one connection to Dota, with the vconsole GUI kept usable and MCP commands injected separately.
- Console I/O: send, read, list channels, search commands and help.
- Game control: `project_info`, launch, disconnect and restart.
- Runtime API lookup: Lua, Panorama JS, CSS, events and help.
- Debug inspection: entities, modifiers, entity scripts and Lua.
- Asset compilation.
- MCP output hidden from the vconsole GUI by default.
- Standalone Windows executable.

### Fixed

- `console_find`, `console_help` and several API dumps returned empty results due to capture timing.

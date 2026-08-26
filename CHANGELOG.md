# Changelog

English | [中文](CHANGELOG.zh.md)

## 1.6.0 (2026-08-20)

### Added (VFX & model capabilities, 9 new tools, 22 → 31)

- **FileOps (four tools, offline)**: `file_read` / `file_write` / `file_edit` (old_string→new_string exact-one-match) / `file_delete` (returns a content snapshot) — read/write text source files inside the addon; paths are restricted to `content|game/dota_addons/{addon}/`, and a normalized-prefix check rejects `../` escapes and other addons.

- **`vrf_ensure` (offline)**: half-integrated VRF CLI — detect / download the pinned version (default 20.0, self-contained with no .NET dependency) / sha256 verify (tampering rejected and not cached) / cache `os.tmpdir()/dota2-mcp/vrf/`; matches `cli-{os}-{arch}.zip` dynamically from release assets[] and only goes online when missing.

- **`asset_inspect` (offline)**: VRF decompile + five-type structured summary (vpcf/vmdl/vmat/vtex/unknown) with stable key ordering for diffing; `include_raw` explicitly truncated at 4000 characters.

- **`asset_check_refs` (offline)**: single-asset recursive reference integrity — ok / uncompiled (source present, artifact missing) / engine_refs (two-level resolution landing in game/dota) / broken four buckets; `max_depth=3` + visited set to prevent cycles.

- **`vfx_preview` / `vfx_preview_stop` (needs game + vconsole)**: runtime particle instance preview — ParticleManager:CreateParticle (full PATTACH_* enumeration, optional world coordinates) returns a pid; console load errors are the source of truth (an id doesn't prove a successful load); inherits the `dota_run_lua` gating channel (not a new restriction).

- **Built-in skills `dota2-vfx` / `dota2-model`**: vpcf/vmdl/vmat/vtex KV3 writing quick-reference (verified against real templates), pipeline model, SOP, tool mapping, common-error table, minimal templates; the full field-reference section is a TODO(rare) to be filled in incrementally.

- **`dota2_skill` section arguments**: `section` (returns a single `##` section) / `outline` (heading table of contents), to handle the large body of a verbatim full skill.

### Fixed

- **WSL path detection**: `detectDotaPath()` gains `toHostPath()` — on non-win32 platforms Windows drive-letter paths map to `/mnt/<drive>/`; the registry is queried via WSL interop and default locations are probed on all platforms. Fixes all filesystem-class tools being unusable under WSL.

### Dependencies

- Added `adm-zip` (pure JS; unzips VRF release packages, keeping the no-external-binary rule).

### Testing

- New offline scripts: `test-fileops` / `test-vrf-ensure` / `test-asset-inspect` / `test-asset-check-refs`; new live script: `test-vfx-live` (launch → spawn → stop).

- Live tests surfaced and recorded two prerequisites for the test addon: the basic template's `addoninfo.txt` is an empty KV3 that must declare maps/IsPlayable; the map must be compiled first (resourcecompiler → `game/maps/*.vpk`) before it can launch.

## 1.5.1 (2026-07-22)

### Docs

- **README install path narrowed to npx as the sole recommendation** (keeping users always auto-updated), removing the global-install and standalone-exe install instructions (exe keeps a single line for special cases); per-client configuration expanded from a one-line table into full instructions (Claude Code/Desktop, Cursor, VS Code, Cline, Codex TOML, with config file locations and paste-ready JSON); added post-startup verification steps and a connection-troubleshooting table (`--prefer-offline`, cmd wrapping, pointing "not connected"/"vconsole" errors); prerequisites and FAQ synced with the gating model.

## 1.5.0 (2026-07-22)

### Breaking changes

- **Strict vconsole-gated connection model: no window, no Dota connection**. 1.4.0's contract was a "policy fiction" — tools were physically usable (29000 was up) but blocked by rules, so users couldn't tell design from bug. Now the state is physically true: with no GUI the relay only probes `:29000` readiness every 1s (connect once and drop, without holding it); only after vconsole2 connects to `:29001` does the relay connect to `:29000`; when the GUI disconnects it immediately drops 29000. From now on "no window = no connection = no tools", with no exceptions. **Accepted cost: the agent can't work without vconsole** (product philosophy: a human must be able to watch the agent's console activity). By-product: closing the window releases 29000 immediately and the AssetBrowser vconsole button works again — "I can't open it myself" disappears at the root.

- Status broadcast/hello-ok gains a `ready` field, so tool errors precisely distinguish "Dota isn't running" from "vconsole just isn't open".

### Added

- **Auto-open vconsole when Dota readiness is detected**: on the readiness rising edge (Dota transitions from absent to present) with no vconsole2.exe process, it auto-launches (disabled via `DOTA2_VCON_AUTO_OPEN_VCONSOLE=0`). The only trigger is the readiness edge, so there's naturally no launch loop; after a manual close it isn't reopened immediately — it only retries on the next Dota restart.

### Fixed

- `close()` didn't close the control-port server, leaking the port.

## 1.4.0 (2026-07-22)

### Breaking changes

- **Explicit vconsole contract**: console-class tools (17 of them) now require vconsole2 to be open and connected to `127.0.0.1:29001`, otherwise they report a clear error and the way to open it (call `dota_open_vconsole`, or run the exe manually). Intent: always let the user watch the agent's console activity, with failure explicitly visible rather than a hidden fallback. Note: the AssetBrowser vconsole button is disabled by the engine while the relay holds 29000 (measured: the engine treats the relay as the connected vconsole), so to open vconsole run `game/bin/win64/vconsole2.exe` directly.

- **`project_info` removed, merged into `dota_status`**: `dota_status` absorbs all its fields (allMaps/clients/cpu_usage, etc.) and, as the entry/navigation tool, never throws — when Dota isn't connected or vconsole isn't open it returns status plus next-step guidance. Tool count stays 22.

- `dota_status` output structure changes accordingly (new `vconsole`/`maps`/`allMaps`/`running{}` fields); every console tool description appends the "requires vconsole open" prerequisite.

### Added

- **`dota_open_vconsole`**: explicitly launches vconsole2.exe and waits for it to attach to the relay (30s). When an existing unattached stale instance is detected, it gives an explicit hint (vconsole2 is single-instance; a repeated spawn only focuses the old window).

- **`dota_launch_game` phase-advancement guidance**: the success endpoint changes from "map loaded" to entering GAME_IN_PROGRESS (timeout default 45s→90s); if a phase hasn't advanced in 15s it returns a stuck report: the phase verbatim, built-in `PHASE_GUIDANCE` advancement instructions (down to the dota_run_lua call), recent VScript/error lines, and a pointer to the skill doc. Typical scenario: stuck at CUSTOM_GAME_SETUP, advance with a single `GameRules:FinishCustomGameSetup()` per the guidance (verified end-to-end live).

- **`dota2-game-phases` skill doc**: normal duration and advancement method for each game_state, plus a stuck-phase SOP (first check addon errors via console_output, then advance per the table).

### Fixed

- **Late-opened vconsole is an empty shell**: the relay didn't replay init frames (AINF/CHAN/CVRB/CFGV/ADON) to a late-attaching GUI, so the window got no channel table/cvar/addon info. Now it caches them in arrival order and replays on GUI attach, so the window works as soon as it opens.

- **A dead peer never reconnects**: on a real crash/hang the socket sends no FIN, so the relay forever thinks it's connected and MCP commands go into a black hole. Added a liveness probe: silently send an echo probe after 15s, declare dead and reconnect after 20s with no response; probe lines are filtered from both MCP and GUI.

- **Daemon idle exit cuts vconsole's lifeline**: after a 5-minute exit with no clients, 29001 disappears and vconsole has nowhere to connect. It no longer idles out while the Dota process is running.

- **Contract/open-window fully broken in daemon mode**: GUI attach/detach never broadcast status, the thin client's guiConnected synced only once at handshake, so MCP didn't know vconsole was open. Now GUI state changes broadcast immediately.

- **Duplicate reconnect scheduling**: the error/close/catch paths each scheduled a timer (logging two lines per retry round); merged into a single timer.

- **False-killing a healthy engine early in Dota startup**: the initial AINF timeout (dead after 10s without AINF) repeatedly killed it during boot — the listener comes up before the AINF subsystem (measured >20s). Removed the AINF timer; zombie detection goes through the probe uniformly (~35s, no false positives).

- **False stuck during map load**: during loading game_state stays INIT, so the 15s threshold misjudged it as stuck. Loading skips the check; a genuinely stuck load is caught by the timeout fallback (the report includes ResourceSystem errors).

### Improvements

- **Development–verification workflow landed in the docs** (AGENTS.md): a 9-smoke-script inventory (offline/live classified) + offline-first / live three-layer verification (29002 protocol, MCP stdio, system status) / connection-lifecycle scenario-matrix methodology. Added offline `test-relay.mjs`, `test-mcp-offline.mjs` and the live `test-mcp-live` / `test-launch-phases` / `test-crash-recovery` / `test-multi-session` script series.

- **Portability rules** (Conventions): docs/scripts forbid drive-letter absolute paths (`{dota2Path}` placeholder / `detectDotaPath()` detection), forbid concrete project names (inferred from daemon hello-ok + `DOTA2_TEST_*` override), default to the minimal launch-arg set, and ask the developer when the test project is unclear.

## 1.3.2 (2026-07-20)

### Improvements

- **VCon connection model: the relay holds the Dota 2 connection permanently**. It connects to `:29000` proactively on startup and auto-reconnects every 2s on disconnect; it no longer waits for the vconsole2 GUI to connect before establishing the connection, nor releases on GUI disconnect. The GUI is demoted to an optional observer, so pure-AI workflows work out of the box — previously tools were unusable until a GUI connected to `:29001` after MCP started.

- `waitForRelay` relaxed from 10s to 30s: daemon cold start (node cold start + Dota 2 path detection reading the registry, plus Windows Defender scans) can exceed 10s, which previously caused a false local fallback.

### Fixed

- **The thin-client reconnect chain broke on the first failure**: `_scheduleReconnect` had an empty failure callback and close only scheduled when `wasConnected`, so "infinite reconnect on disconnect" actually stopped permanently after one failure (old tests asserted spinning, so it stayed hidden). Fixed to a true infinite-backoff reconnect (capped at 5s), with commands buffered during the outage and resent on reconnect.

- **In-session automatic daemon respawn**: when the daemon process is killed (not an idle exit), the thin client re-runs `createRelay()` after ~5 consecutive reconnect failures to launch a new daemon and swap in the connection wholesale, so tools recover transparently. Previously it could only keep dialing `:29002` until a new session started.

- **Local fallback mode killed the process after 5 minutes**: `start()` unconditionally armed the idle-exit timer, and the locally embedded relay never has a client, so `process.exit(0)` at 5 minutes silently killed the MCP session. Idle exit now only enables in daemon mode.

- **A transient respawn failure left the session permanently disconnected**: the `createRelay` lock branch didn't catch `client.connect()`, so after the exception escaped the relay reference stayed on a destroyed client and tools reported "not connected" forever. Now it catches and falls back locally, and retries respawn automatically after 5s.

- **connect timeout leaked sockets**: the 8s timeout only rejected without destroying, so a hung daemon leaked FDs and listeners continuously; the timeout now destroys the socket and counts toward reconnect/respawn statistics.

- **A daemon that timed out wasn't killed and became a zombie**: after `waitForRelay` timed out, a slow-starting daemon would still come online and bind its port, coexisting double-bound with the fallback local relay; the timeout now kills it before falling back.

- **Fallback double-start self-lock**: a local relay already started by `createRelay` was started a second time by `index.ts`, hitting EADDRINUSE itself and falsely reporting a "multi-instance conflict".

- `dota_status`/tool "not connected" messages, README, and AGENTS.md synced to the new connection model (the vconsole2 GUI is no longer listed as a usage prerequisite).

## 1.3.1 (2026-07-18)

### Added

- **`dota2_skill` built-in skill tool** (Roblox skill pattern): skill content is distributed with MCP and the agent pulls it by calling `dota2_skill` — no separate skill-file installation. The first skill, `dota2-runtime-dev`, teaches the core mental model that "a Dota 2 custom game is a long-lived process + hot reload" — code changes take effect via `reload_script` (server) / Panorama hot reload rather than restarting the map; it also covers the generated-code boundary (edit `.ts/.tsx`, don't touch the generated `.lua/.js`) and the KV read-only convention. Skills live in the standard `skills/<name>/SKILL.md`; adding one just means dropping it into a folder.

## 1.3.0 (2026-07-17)

### Added

- **`dota_status` task-entry tool**: the agent's first handhold when the user says "test / verify / debug a Dota 2 project". It reports connection + addon + map status and, based on that status, points to the next tool to call (launch / console_output to check errors / dota_run_lua to verify), handing the workflow to the agent directly.

### Improvements

- **All tool descriptions rewritten task-oriented**: they start with "when to use" in task language ("use when the user reports an in-game bug", "launch the map when the user wants to test an addon"), fixing the previous implementation-view descriptions ("Send console command via VCon TCP") that made the agent fail to match user intent and reach for other tools.

### Fixed

- **First addon detection**: a thin client attaching to an already-running daemon couldn't get the historical addon (the `adon` event had long been sent), so `dota_status` first returned `addon: "(detecting...)"` with empty maps. Startup now reads addon/maps from the hello-ok handshake; `dota_status` waits up to 3s when the ADON frame is asynchronously delayed.

## 1.2.1 (2026-07-17)

### Fixed

- **Daemon spawn wiring**: `createRelay` now actually launches a detached daemon through `acquireLock → spawnRelayDaemon → waitForRelay`. Previously these APIs were dead code and each instance still started a local relay, so "the daemon survives independently of the MCP session" was never really implemented.

- **Security: control-port handshake enforced**. With a token set, a connection that hasn't completed HELLO can't send any command, fixing the bypass where a local process skipped the handshake and injected `CMD:` directly (RunScriptCode equals RCE).

- **Zombie connect Promise**: when `hello-ok` never arrives (e.g. the daemon crashes before the handshake), an 8s timeout rejects, fixing `createRelay` awaiting forever and hanging MCP startup.

- **Daemon restart crashed every MCP process**: connection loss no longer throws an unhandled `error` event; it silently auto-reconnects (exponential backoff capped at 5s), buffering commands during the outage and resending them after reconnect.

- **VCon frame reassembly (GUI→Dota)**: reassemble by the 12-byte frame header's length, fixing engine protocol corruption from forwarding half-frames on large commands or network jitter.

- **npm package missing daemon files**: the `files` field changed from only `dist/index.js` to `dist/*.js`, otherwise `require.resolve('./relay-main.js')` throws after an npx install (a release blocker).

- **Dota 2 path detection**: `find-steam-app` couldn't parse the new `libraryfolders.vdf`, making `detectDotaPath()` always null and map scanning silently fail. Changed to: registry SteamPath → STEAM_PATH env var → platform default locations, expanding the VDF for each source to enumerate all libraries and support any drive/directory name.

- When the Dota 2 path can't be detected, `dota_compile_asset` reports an actionable error instead of silently assembling a relative path and failing.

- Token generation switched to `crypto.randomBytes` + atomic `wx` creation.

- `livePid()` stale cleanup compares content, avoiding deleting a new daemon's PID by mistake.

- Clean up `relay.pid` on idle exit.

## 1.2.0 (2026-07-17)

### Added

- **Multi-instance coexistence: relay daemon + thin-client mode.** Multiple AI agents / sessions can attach via MCP at the same time, sharing one resident relay (holding Dota 2 `:29000` exclusively), so later-starting instances are no longer all unusable due to `:29001/:29002` port conflicts.

- The relay daemon survives independently (detached spawn) and auto-exits after 5 minutes with no client connected.

- Thin clients attach via `:29002`: `HELLO` handshake + token check (`<tmpdir>/dota2-mcp/relay.token`, 0600), `STREAM` real-time PRNT push, `SHUTDOWN` empty-client self-exit.

- Daemon coordination: file lock + PID + stale detection to prevent concurrent-spawn races.

- When a port is occupied, tool errors clearly point to "another instance conflict" rather than the misleading "not connected to Dota 2".

- Added `scripts/test-daemon.mjs`: offline daemon-chain test (no Dota 2 needed).

### Fixed

- `zod` added to `dependencies` (previously it relied on an indirect hoist from `@modelcontextprotocol/sdk`).

- The relay's hardcoded Dota 2 path changed to follow `detectDotaPath()` auto-detection.

## 1.1.1 (unreleased)

### Improvements

- Use the `find-steam-app` library instead of hand-written path parsing to locate the Dota 2 install directory cross-platform.

- README adds a placeholder-path note.

## 1.1.0 (2026-06-25)

### Added

- Cross-platform support: Windows, Linux, macOS.

- Auto-detect the Steam / Dota 2 install path per platform.

- `npm run package` now uses Node SEA to produce a standalone executable for the current platform.

- Added a GitHub Actions Release workflow that auto-builds and uploads three-platform binaries on Release.

- Added the MIT license.

## 1.0.0 (2026-06-25)

First usable version.

### Added

- stdio-based MCP server registering 20 tools.

- VConsole2 TCP relay: transparently forwards between Dota 2 `:29000` and the vconsole2 GUI `:29001`; MCP injects commands through `:29002`.

- Real-time console I/O: `console_send`, `console_output`, `console_channels`, `console_find`, `console_help`.

- Game control: `project_info`, `dota_launch_game`, `dota_disconnect`, `dota_restart`.

- Runtime API lookup: `dota_api_lua`, `dota_api_panorama_js`, `dota_api_css`, `dota_api_events`, `dota_api_help`.

- Debug inspection: `dota_dump_entities`, `dota_dump_modifiers`, `dota_entity_inspect`, `dota_run_lua`.

- Resource tool: `dota_compile_asset`.

- vconsole2 GUI output masking: by default MCP command output is wrapped in `ai_disabled; ...; ai_disabled`, and the relay auto-hides the output between the markers; MCP can still read the full output.

- Full smoke-test script `scripts/test-mcp-tools.mjs`.

- Support packaging a standalone Windows executable `dist/dota2-mcp.exe` (esbuild + Node SEA).

### Fixed

- Fixed `console_find`, `console_help`, and several API dump tools returning empty results due to console-output capture timing.

### Project

- Added `README.md` and `CHANGELOG.md`.

- `package.json` bumped to `1.0.0`, adding `files` / `keywords` and other release fields.

# dota2-mcp — DOTA2 custom game full-flow MCP Server

> AI-agent-assisted DOTA2 custom game development: live VCon console bridging, console API lookup, and game launch/restart/monitoring.

## Project

- **Tech stack**: TypeScript (Node.js >= 18) + `@modelcontextprotocol/sdk`
- **Entry point**: `src/index.ts` → `dist/index.js` (stdio MCP server, thin client)
- **Daemon**: `src/relay-main.ts` → `dist/relay-main.js` (detached relay that exclusively holds Dota 2 :29000, with a lifecycle independent of any MCP session)
- **Core mechanism**: VConsole2 TCP protocol (port 29000) → VConRelay transparent proxy (listens on 29001 for the vconsole2 GUI)
- **Dependencies**: no external binary dependencies; pure Node.js + raw TCP sockets

## Commands

```bash
npm install           # Install dependencies
npm run build         # Sync version numbers + compile TypeScript → dist/
npm run check         # Type check + version-consistency check
npm run sync-version  # Sync version numbers across the repo from package.json (--check validates without modifying)
npm run dev           # tsc --watch incremental compilation
npm run bundle        # esbuild → dist/bundle.cjs (pre-step before packaging)
npm run package       # bundle + Node SEA single-file executable (scripts/sea-package.mjs)
node dist/index.js    # Start the MCP server (over stdio)
```

**Versioning**: only change `version` in `package.json`; everything else (the `getVersion()` fallback in `src/index.ts`, `README.md`) is synced by `npm run sync-version`, which `build`/`prepack` run automatically.

**Testing**: no lint/format/test framework — everything is plain-node smoke scripts (assert style):

| Script | Type | Coverage |
|------|------|------|
| `scripts/test-relay.mjs` | offline | relay transport: init frame replay, liveness probes (pong keepalive / dead on missing pong / dead on zombie), probe-line filtering, GUI status broadcast. Fake VCon server + random port + injected short timeouts |
| `scripts/test-daemon.mjs` | offline | daemon chain: spawn/handshake/token/multi-client/broadcast/idle exit/in-session respawn |
| `scripts/test-mcp-offline.mjs` | offline | MCP stdio: tool list, contract-gating errors, dota_status doesn't throw, skill loading |
| `scripts/test-fileops.mjs` | offline | the four FileOps: read/write/edit/delete round-trip + three out-of-bounds rejections |
| `scripts/test-vrf-ensure.mjs` | offline | vrf_ensure: fake Release API + zip fixture, download/cache/sha256 tamper rejection |
| `scripts/test-asset-inspect.mjs` | offline | asset_inspect: fake VRF CLI + five-type fixture, summary fields and raw truncation |
| `scripts/test-asset-check-refs.mjs` | offline | asset_check_refs: temp asset-tree four-bucket assertions + cycle prevention |
| `scripts/test-vfx-live.mjs` | live | vfx_preview: launch map → spawn particle (pid>0) → stop |
| `scripts/drill-vfx-workflow.mjs` | drill | full real-usage chain: learn skill → write source → compile → inspect → check_refs → preview → diagnose → stop → iterate |
| `scripts/test-mcp-live.mjs` | live | full vconsole contract chain: gating → dota_open_vconsole → ungate (resets the environment by killing vconsole2) |
| `scripts/test-launch-phases.mjs` | live | real-map launch: stuck report on a stuck phase + following guidance to advance via dota_run_lua to GAME_IN_PROGRESS |
| `scripts/test-crash-recovery.mjs` | live | crash recovery: kill Dota in the same MCP session → detect → restart → self-recover (the script starts and kills Dota itself) |
| `scripts/test-multi-session.mjs` | live | multi-session shared daemon: A opens vconsole, B ungates at the same time |
| `scripts/test-mcp-tools.mjs` | live | all-tools smoke (legacy script; needs Dota + **vconsole already connected** — run test-mcp-live.mjs first to open the gate) |
| `scripts/verify-phase-apis.mjs` | live | verify console API names over the 29002 protocol (one-off script, edit as needed) |

Live scripts don't hardcode machine paths or project names: the Dota path uses `detectDotaPath()` auto-detection; the addon/map is inferred from the running daemon's handshake info (the addon/maps in hello-ok), overridable via `DOTA2_TEST_ADDON` / `DOTA2_TEST_MAP`; when inference fails they error and require an explicit value rather than silently using a default. Launch args vary by person/project/region (e.g. `-perfectworld`); test-crash-recovery can pass full args via `DOTA2_TEST_ARGS` when re-launching Dota. Shared handshake helper: `scripts/lib-ctrl.mjs`.

Offline one-liner: `npm run check && node scripts/test-relay.mjs && node scripts/test-daemon.mjs && node scripts/test-mcp-offline.mjs`
Live prerequisites: Dota 2 running + `node dist/relay-main.js` to start the daemon (an MCP session attaches to an existing daemon).

## Development–verification workflow

The standard verification path for a new feature or bug fix:

**0. Principles**
- **Prefer offline over live**: pin transport/protocol-layer logic down offline with a fake TCP server (the test-relay.mjs pattern: env port override + random port + constructor-injected short timeouts).
- **Mock only the boundary**: in offline scripts the fake VCon server replaces only the one uncontrollable boundary — the Dota engine — while relay/client/daemon all run real implementations. A hand-rolled stand-in only proves bytes cross the bridge, not that the real tool behaves per the assertions. See `docs/defensive-patterns.md`.
- **Mechanical observation instead of eyeballing**: processes (tasklist), ports (netstat), and daemon logs verify everything; MCP functionality has no visual component, and the only thing a human eye needs is the vconsole window content itself.
- **Live verification must run**: an offline green light ≠ correct design — live runs catch errors offline can't. See the Testing sections of the [architecture note](.agents/notes/implemented/architecture/2026-07-22-vconsole-lifecycle.md#testing) and [feature note](.agents/notes/implemented/feature/2026-07-22-vconsole-contract-and-phase-guidance.md#testing).

**1. Offline first**
`npm run check` + the relevant offline scripts. For new relay behavior, extend `scripts/test-relay.mjs` first (fake server shapes: accept and play dead, send init frames then go silent, selectively answer probes).

**2. Live environment**
- Dota: directly from the command line, `{dota2Path}/game/bin/win64/dota2.exe -addon <addon> -tools` (`{dota2Path}` is auto-detected from Steam appid 570 and varies by machine; `steam://rungameid/570` carries no launch args and can't be used).
- daemon: manually `node dist/relay-main.js` (background) — logs are directly visible and it can be killed at any time.
- Environment reset: `taskkill /F /IM vconsole2.exe` clears the window; `taskkill /F /IM dota2.exe` simulates a crash.
- **When the test project is unclear, ask the developer** which addon/map to test, then pass it via `DOTA2_TEST_ADDON`/`DOTA2_TEST_MAP` — never silently assume any particular project.

**3. Live three-layer verification (locate issues by layer)**
- **Console protocol layer**: direct 29002 NDJSON (`HELLO <token>` → `CMD:<cmd>` → `STREAM`/`TAIL`; token in `os.tmpdir()/dota2-mcp/relay.token`), bypassing the MCP tool layer to verify the console commands themselves — see `scripts/verify-phase-apis.mjs`.
- **MCP tool layer**: stdio JSON-RPC smoke (initialize → tools/call), following the call() pattern in `scripts/test-mcp-live.mjs`.
- **System status layer**: netstat shows who connects to whom on 29000/29001/29002, tasklist shows process liveness, daemon logs show the relay's perspective.
- **Verify console API names** (convention: hardcode only after verifying): collect `script_help2 <name>` over 29002 **fully via STREAM in real time** — the relay prntBuffer only holds 500 lines, so a full dump would flush the TAIL window. APIs like `GameRules` are only registered once the map is loaded, and script_help2's argument doesn't filter output (always a full dump), so grep the result yourself.

**4. Scenario matrix (mandatory for connection-lifecycle changes)**
Contract gating → open vconsole (replay takes effect) → close vconsole → kill Dota (detection) → restart (self-recovery, vconsole untouched) → multi-session sharing. Matching scripts: test-mcp-live / test-crash-recovery / test-multi-session.

## Environment variables

Normally **no environment variables need to be set**. The Dota 2 path is auto-detected from Steam appid `570`, and the addon name is obtained live from the VCon relay or inferred under `content/dota_addons/`.

Optional advanced configuration:

| Variable | Default | Description |
|------|--------|------|
| `DOTA2_VCON_DOTA_PORT` | `29000` | Dota 2 VConsole2 port |
| `DOTA2_VCON_GUI_PORT` | `29001` | Port forwarded to the vconsole2 GUI |
| `DOTA2_VCON_CTRL_PORT` | `29002` | MCP control port (`STATUS/CMD/TAIL`) |
| `DOTA2_VCON_AUTO_OPEN_VCONSOLE` | `1` | Auto-open vconsole2.exe when Dota readiness is detected (rising edge) and no vconsole2 process exists; `0` disables |

## Key findings

- **VConsole2 protocol**: 12-byte frame header `Type(4B)+Version(2B=212)+Length(4B)+Handle(2B)` + payload (see "VConsole2 protocol" below)
- **Dota 2 allows only 1 VCon client**: the relay takes over 29000, and the vconsole2 GUI coexists through the relay's 29001 port. **A measured side effect**: while the relay holds 29000, the engine treats the relay as the connected vconsole — the AssetBrowser vconsole button/shortcut is disabled (it doesn't launch a process). By default no manual open is needed (the relay auto-launches when it detects Dota readiness); manual path: run vconsole2.exe directly or call dota_open_vconsole. Once the window closes, 29000 is released and the button works again
- **All APIs go through the console**: zero local JSON dependency — the engine version determines the API content
- **Verified console commands**:
  - `script_help2` / `cl_script_help2` — Lua API (stub format)
  - `cl_panorama_script_help_2` — Panorama JS enumeration
  - `dump_panorama_css_properties` — CSS properties
  - `dump_panorama_events` — Panel events
  - `dota_modifier_dump` / `cl_dump_modifier_list` — Modifier list
  - `ent_script_dump` / `cl_ent_script_dump` — entity script scope
  - `script_find` / `cl_script_find` — VM search (requires the game to be running)
  - `script_dump_all` / `cl_script_dump_all` — VM export (requires the game to be running)

## Architecture

### Running the server during development

The server talks to the MCP client over stdio and is normally invoked by the MCP client (e.g. an AI agent configured with a local MCP). For manual debugging you can run:

```bash
npm run build
npm run start
```

### Daemon architecture (multi-instance coexistence)

The relay is an **independent detached background process** (`src/relay-main.ts`) whose lifecycle is independent of any MCP session. `src/index.ts` is only a thin client. On startup `createRelay()` (`src/index.ts`) proceeds in order:

1. Probe `:29002` for an existing daemon → attach as a `RelayClient` (thin client);
2. None → `acquireLock()` takes the lock; the winner `spawnRelayDaemon()`s a detached daemon and also attaches as a thin client; the loser waits for it to be ready and then attaches;
3. The daemon path fails entirely → fall back to a local `VConRelay` (the legacy single-instance behavior) so the tools at least keep working.

This way multiple MCP clients (multiple AI agents / sessions) can connect to the same relay at once and share its exclusive connection to Dota 2 `:29000`. Daemon state lives in `os.tmpdir()/dota2-mcp/` (fallback `~/.dota2-mcp/` on failure): `relay.lock` (atomic lock), `relay.pid`, `relay.token` (0600, checked when a thin client sends `HELLO`), `relay.log`. With no client connected, no GUI, and **the Dota process not running**, the daemon idles out after 5 minutes (Dota running = a developer at work, so 29001/29002 stay resident).

**Connection model (vconsole gating)**: no vconsole open, no relay connection. With no GUI, the relay probes `:29000` readiness every 1s (connect once and drop, without holding it); only after vconsole2 connects to `:29001` does the relay connect to `:29000` (reconnecting every 2s on disconnect); when the GUI disconnects it immediately drops `:29000` (the AssetBrowser button becomes usable again). When Dota readiness is detected (rising edge) and no vconsole2 process exists, it auto-launches vconsole2.exe (`DOTA2_VCON_AUTO_OPEN_VCONSOLE=0` disables).

When the daemon process is killed (not an idle exit): the thin client backs off and reconnects indefinitely (capped at 5s), and after ~5 consecutive failures (≈5s) it re-runs `createRelay()` inside the MCP session to launch a new daemon and swap in the new connection wholesale (`attachRelay`/`respawnRelay`, `src/index.ts`).

### Data flow

```
AI agent (MCP client over stdio)
    ↓
src/index.ts  — registers all MCP tools; thin client
    ↓  (control port :29002, NDJSON protocol: HELLO/STATUS/CMD/TAIL/SETFILTERS/SETMCPSUPPRESS)
src/relay-main.ts  — detached daemon
    ↓
src/tools/vcon-relay.ts  — VConRelay transparent proxy
    ├──→ src/tools/vcon-bridge.ts (VConClient) → Dota 2 engine :29000
    └──→ vconsole2 GUI :29001
```

Dota 2 allows only one VConsole2 client on port `29000`. While vconsole2 is attached, the relay exclusively holds that connection (with no GUI it only probes, without occupying it), and exposes a second port `29001` so the official vconsole2 GUI can still connect transparently. MCP tools inject commands and read output through the control port `:29002`.

**vconsole contract (gating)**: console-class tools require vconsole2 to be attached to `:29001` — if vconsole isn't open the relay doesn't connect to Dota ("no window = no connection = no tools", the state is physically true, so users won't mistake it for a bug). Tools report a clear error that distinguishes "Dota isn't running" from "vconsole just isn't open". The relay replays init frames (AINF/CHAN/CVRB/CFGV/ADON) to a late-attaching GUI; the connected state has a liveness probe (silently sends an `echo` probe, times out to declare dead, reconnects while the GUI is still there); and the daemon skips idle exit while the Dota process is running. See the [lifecycle note](.agents/notes/implemented/architecture/2026-07-22-vconsole-lifecycle.md) and [contract note](.agents/notes/implemented/feature/2026-07-22-vconsole-contract-and-phase-guidance.md) for the rationale and trade-offs.

### Isolation between MCP output and the vconsole2 GUI

To avoid flooding the human developer's vconsole2 GUI with large JSON output when the AI calls `status_json`, `script_help2`, etc. at high frequency, the relay wraps MCP commands as:

```
ai_disabled; <cmd>; ai_disabled
```

Dota 2 echoes two marker lines, `ai_disabled = false` / `ai_disabled = true`. The relay recognizes these two markers:

- The marker lines themselves never enter the MCP buffer, nor are they forwarded to the GUI;
- All PRNT output between the two markers still enters the MCP buffer, but by default is not forwarded to the GUI;
- You can disable this behavior via the `console_gui_filter` tool, or still see all output in the vconsole2 GUI.

This is a **conventional output-isolation feature**, not the real semantics of a console cvar.

### Core modules

| File | Description |
|------|------|
| `src/index.ts` | MCP server entry point (thin client). Registers all tools; `createRelay()` probes/launches the daemon and attaches as a `RelayClient`, falling back to a local `VConRelay` on failure |
| `src/relay-main.ts` | relay daemon entry point (detached). Holds Dota 2 `:29000` exclusively while vconsole is attached (readiness probe only when no GUI), listens on `:29001`(GUI)/`:29002`(control), idles out after 5 minutes (not while Dota is running) |
| `src/relay-client.ts` | The `RelayClient` class. A thin client implementing a subset of the `VConRelay` public interface, talking to the daemon over `:29002`; auto-reconnects on disconnect and resends buffered commands |
| `src/daemon-utils.ts` | Daemon coordination: atomic lock, PID, token (0600), spawn/wait. State directory `os.tmpdir()/dota2-mcp` |
| `src/tools/vcon-relay.ts` | The `VConRelay` class. Transparent proxy between the vconsole2 GUI (`:29001`) and Dota 2 (`:29000`) (gating: no GUI, no connection); broadcasts PRNT/status to each thin client. Auto-reconnects to Dota 2 after a disconnect while a GUI is present, readiness probe when there's no GUI |
| `src/tools/vcon-bridge.ts` | The `VConClient` class. Low-level VConsole2 TCP protocol implementation: 12-byte frame-header parsing, dispatch of `PRNT`/`AINF`/`CHAN`/`ADON`/`CVRB`/`CFGV`, `CMND` command sending |
| `src/tools/console-bridge.ts` | Auto-detects the Dota 2 path, writes commands to a cfg file + tails `game/dota/console.log` as a fallback |
| `src/tools/proxy-intercept.ts` | Standalone protocol-analysis tool. Run `npx tsx src/tools/proxy-intercept.ts direct` or `proxy` to capture or MITM-analyze VCon traffic |
| `skills/<name>/SKILL.md` | Built-in skill directory. The `dota2_skill` tool reads a SKILL.md with frontmatter (name/description) from `skills/` and returns its content |

### VConsole2 protocol

Relay/Client implements the VConsole2 binary frame format, verified against Dota 2:

```
[Type: 4B ASCII] [Version: 2B uint16 BE = 212] [Length: 4B uint32 BE] [Handle: 2B uint16 BE] [Payload]
```

Server → client message types: `AINF`, `ADON`, `CHAN`, `CVRB`, `PRNT`, `CFGV`.
Client → server command type: `CMND` (null-terminated ASCII).

### The 31 currently implemented MCP tools

**Game control**
| Tool | Console command | Description |
|------|-----------|------|
| `dota_status` | `status`/`status_json` + file scan | Entry point/navigation: connection, vconsole, addon/maps, live status, next-step guidance (never throws) |
| `dota_launch_game` | `dota_launch_custom_game` | Launch (auto-completes the addon); polls to GAME_IN_PROGRESS, returns advancement guidance on a stuck phase |
| `dota_disconnect` | `disconnect` | Disconnect |
| `dota_restart` | `restart` | Reload the map |
| `dota_open_vconsole` | spawn vconsole2.exe | Open the vconsole window (the explicit path when the AssetBrowser button is disabled by the engine) |

**Console communication**
| Tool | Console command | Description |
|------|-----------|------|
| `console_send` | arbitrary | Send a command |
| `console_output` | VCon stream | Read output, supports `level` (0=all,1=warn+,3=error) and `filter` |
| `console_channels` | VCon `CHAN` | List VCon channels |
| `console_find` | `find <kw>` | Search all 5248 console commands |
| `console_help` | `help <cmd>` | View a single command's help |
| `console_gui_filter` | relay-internal | Toggle isolation of MCP output from the GUI |

**API documentation (all live console queries)**
| Tool | Console command | side |
|------|-----------|:--:|
| `dota_api_lua` | `script_help2` / `cl_script_help2` | optional |
| `dota_api_panorama_js` | `cl_panorama_script_help_2` | client |
| `dota_api_css` | `dump_panorama_css_properties` | client |
| `dota_api_events` | `dump_panorama_events` | client |
| `dota_api_help` | combined | API lookup entry point/navigation |

**Debugging**
| Tool | Console command | Description |
|------|-----------|------|
| `dota_dump_entities` | `ent_dump` etc. | Entity dump |
| `dota_dump_modifiers` | `dota_modifier_dump` / `cl_dump_modifier_list` | Modifier list |
| `dota_entity_inspect` | `ent_script_dump` / `cl_ent_script_dump` | Entity script scope |
| `dota_run_lua` | `script_exec` etc. | Execute a Lua snippet |

**Resources**
| Tool | Description |
|------|------|
| `dota_compile_asset` | Compiles assets via resourcecompiler / Source2Viewer-CLI |
| `vrf_ensure` | Ensures the VRF CLI is available: detect / download the pinned version / sha256 verify / cache (offline-safe, only goes online when missing) |
| `asset_inspect` | VRF decompile + structured summary (per-field for vpcf/vmdl/vmat/vtex; include_raw truncated at 4000) |
| `asset_check_refs` | Single-asset recursive reference integrity: ok/uncompiled/engine_refs/broken four buckets + two-level resolution + cycle prevention |

**VFX preview (needs a running game + vconsole)**
| Tool | Console command | Description |
|------|-----------|------|
| `vfx_preview` | `dota_run_lua` channel (ParticleManager:CreateParticle) | Spawn a particle preview in-game (runtime instance, not an asset file), returns pid |
| `vfx_preview_stop` | `dota_run_lua` channel (ParticleManager:DestroyParticle) | Destroy preview particle instances |

**File operations (offline, no game needed)**
| Tool | Description |
|------|------|
| `file_read` | Read a text file inside the addon (5 MB cap; out-of-bounds paths rejected) |
| `file_write` | Write/overwrite a file inside the addon (creates directories) |
| `file_edit` | old_string→new_string replacement (exactly one match, otherwise fails loudly) |
| `file_delete` | Delete a file inside the addon (returns a content snapshot) |

**Skills**
| Tool | Description |
|------|------|
| `dota2_skill` | Exposes built-in skills (name full text / section part / outline TOC / data machine-readable data file; `dota2-vfx` ships official particle-corpus stats `vpcf-stats.json` etc.) |

## Conventions

- **Act only on an explicit execution signal and confirmed scope; otherwise ask one clarifying question**
- **API data source**: console live queries only, no local JSON database (the engine version determines the API content)
- **Trust boundary**: server Lua is authoritative, Panorama JS is client UI logic
- **Zero hardcoding**: addon/map are always dynamically detected, never hardcoded to any project name. Map scan path: `{dota2Path}/content/dota_addons/{addon}/maps/*.vmap`
- **Portability (no hardcoding in docs/scripts)**: this repo is a general-purpose tool; the following are forbidden in docs, scripts, and comments:
  - Machine absolute paths (drive letters `X:\`/`X:/`): docs use the `{dota2Path}` placeholder, code and scripts use `detectDotaPath()` auto-detection;
  - Specific addon project/map names: the test project is inferred from the running daemon's hello-ok (addon/maps), overridable via the `DOTA2_TEST_ADDON` / `DOTA2_TEST_MAP` / `DOTA2_TEST_ARGS` env vars; when inference fails, error and require an explicit value rather than silently using a default. Code-comment examples always use a neutral name like `my_addon`;
  - Hardcoded Dota launch args: they vary by person/project/region (e.g. `-perfectworld`); the default minimal set is `-addon <addon> -tools`;
  - When the test project is unclear, **ask the developer** which addon/map to test — never silently assume.
  Self-check: `Grep "[A-Za-z]:[\\/]"` may only match URLs/placeholders; `Grep -i "<current project name>"` should have zero hits (except historical spec/plan/CHANGELOG)
- **Tool descriptions**: each tool clearly states its console command, so the AI can discover them on its own via `console_find`
- **TSTL/SolidJS first**: edit `.ts`/`.tsx` source files, never the generated `.lua`/`.js`
- **TODO marker semantics**: `FIXME` = release blocker; `TODO` = fix soon; `XXX` = fix someday. Choose by urgency, don't mix them
- **Read `docs/defensive-patterns.md` before writing lifecycle/concurrency/subprocess/teardown code** (7 bug-class rules)
- **Document ownership**: `README.md` is the public-facing document (for end users / AI client configurers) and must not contain implementation detail, code hierarchy, or internal protocol detail; that belongs in `AGENTS.md` or code comments. For public info, prefer updating `AGENTS.md` over duplicating it in `CLAUDE.md`

## Known issues

- The daemon occupies ports `29001` (GUI) and `29002` (control); multiple MCP sessions share one daemon through thin clients, no longer mutually exclusive. The single-instance limit applies only when the daemon fails to launch and it degrades to a local relay
- **vconsole usage path**: vconsole2's connection target is fixed at `127.0.0.1:29001` (the relay's GUI port). By default no manual open is needed — the relay auto-launches when it detects Dota readiness (`DOTA2_VCON_AUTO_OPEN_VCONSOLE=0` disables). The AssetBrowser vconsole button is disabled by the engine only while the relay holds 29000 (i.e. while vconsole is attached); once the window closes, 29000 is released and the button works again. A late-attaching window receives an init frame replay and works as soon as it opens
- Dota 2 must be launched with the `-vconsole` flag (or have the vconsole2 listener enabled) for the relay to connect to `:29000`
- **WSL environment**: tool directories are probed by existence (a win64 hit means a Windows install), argument paths are auto-converted to Windows format, and the VRF CLI needs the invariant globalization env. When a leftover daemon causes port conflicts, kill the node/relay processes and clear the `os.tmpdir()/dota2-mcp/` state files; don't delete `relay.token` while the daemon is alive
- Many API dump tools need the map to be loaded; calling them too early may return empty results

## References

| Item | Path/URL |
|------|----------|
| vscode-dota2-tools | https://github.com/BigCiba/vscode-dota2-tools (local clone path varies by machine) |
| VRF / Source 2 Viewer | https://github.com/ValveResourceFormat/ValveResourceFormat |
| VConsole2.Client (C#) | https://github.com/yuijzeon/VConsole2.Client |
| VConsoleLib.python | https://github.com/uilton-oliveira/VConsoleLib.python |
| luaconsole2 (Lua) | https://github.com/eepycats/luaconsole2 |
| Dota 2 path | Auto-detected via Steam appid `570` (referred to as `{dota2Path}` in docs; never an absolute path) |
| console.log path | `{dota2Path}/game/dota/console.log` |
| VCon ports | engine listens on 29000, relay listens on 29001 (GUI), 29002 (MCP control) |

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five labels: needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: decisions are recorded in `.agents/notes/` (Agent Notes). See `docs/agents/domain.md`.

### Documentation standard

Document hierarchy, tutorial/reference classification, writing rules, and the slop checklist live in `docs/AGENTS.md`; Agent Note lifecycle/class/format live in `.agents/notes/README.md`. Every non-trivial change ships an Agent Note (same commit).

### Bilingual pairing

`.agents/notes/**` and `docs/**` are the English-canonical + Chinese-counterpart + `.i18n.yaml` trio (excluding `docs/AGENTS.md`, `docs/i18n/terminology.md`, `.agents/notes/archived/**`); the contract is in `docs/i18n/README.md`, translation rules in `docs/i18n/translation-rules.md`, terminology in `docs/i18n/terminology.md`. Editing the English side requires updating the Chinese counterpart in the same commit and re-recording with `npm run verify-pairs -- --write <file>`; the `npm run verify-pairs` gate going red means a pair is out of sync.

### Two kinds of skills (don't conflate them)

**Project-shipped skills** (`skills/<name>/SKILL.md` + `data/`, exposed to all MCP users via the `dota2_skill` tool, distributed with the npm package) — runtime development knowledge only:

| skill | Purpose |
|------|------|
| `dota2-vfx` | Particle effect format/recipes/official corpus stats |
| `dota2-model` | Model asset format/official corpus stats |
| `dota2-game-phases` | Game-phase advancement guidance |
| `dota2-runtime-dev` | Runtime development model |

**Skills for maintaining this repo** (not under `skills/`, not distributed with the package), in two places:

| Location | skill | Description |
|------|-------|------|
| Global `~/.agents/skills/` (the maintainer's user-level directory) | `doc-standards`, `prose-standard`, `trim-cot-leakage`, `translate-docs`, `archive-agent-notes`, `code-review` | General maintenance skills; a bare reference in the repo to "the global X skill" points at this directory |

## TODO — Roadmap

- [x] **FileOps** — read/write KV/Lua/TS/JS/CSS/XML source files (`file_read/write/edit/delete` landed)
- [ ] **BuildTools** — npm/tstl/rollup build integration + scaffolding generation
- [x] **AssetInspector** — VRF CLI subprocess calls to parse .vmdl_c/.vmap_c/.vpcf_c etc. (`asset_inspect` landed)
- [ ] **Claude MCP configuration** — write the config so an AI agent can call it directly
- [ ] Verify the actual output of `script_find` / `script_dump_all` while the game is running
- [ ] Test dota_launch_game across various addon/map combinations

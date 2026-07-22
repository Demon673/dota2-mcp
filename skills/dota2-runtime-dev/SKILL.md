---
name: dota2-runtime-dev
description: Use when developing or testing a Dota 2 custom game with dota2-mcp. Teaches the runtime development model — long-lived process + hot reload (no map restarts for code edits), how code changes take effect, generated-code boundaries, and correct use of the dota2-mcp tools.
---

# Dota 2 Custom Game — Runtime Development Model

## The core mental model: long-lived process + hot reload

A Dota 2 custom game is NOT a service you restart after every edit. The game
client stays running, and your code changes take effect WITHOUT relaunching
the map. Treating it like "edit → restart → test" wastes the fast iteration
loop and is the single most common mistake an agent makes here.

The loop is:

  edit source → build/watch compiles → reload in the live game → verify

Do NOT call dota_restart or relaunch the map just to pick up code changes.
Only restart when the change genuinely cannot be hot-reloaded (rare), or when
you intentionally want a clean state.

## How code changes take effect

### Server logic (Lua / TSTL)

1. Edit the source.
2. Confirm it compiled to Lua (TSTL projects usually have a watch running —
   `dev:vscripts` — that rebuilds on save; check its output before assuming
   the Lua is fresh).
3. Reload inside the running game: send the console command
   `reload_script` (via console_send). Projects that support this have a
   reload module that cleans up listeners/timers and re-requires the modules
   (e.g. CModule.reload()), then re-applies modifiers/keyvalues.
4. Verify: console_output (level 3, channel VScript) for reload errors, then
   dota_run_lua to exercise the changed behavior live.

### Panorama UI (JS / SolidJS)

Panorama UI hot-reloads on its own when the built assets change. Edit the
source, let the Solid/JS build regenerate, and the UI updates in place. No
map restart needed.

### When a restart IS needed

- Changes that only apply at map load (some precache / KV-only state that the
  project's reload path doesn't refresh).
- When you want a clean run from the start (many projects expose an in-game
  "restart round / demo" path — prefer that over a full map reload).

## Generated code — check the project type before editing

Not every addon is a TSTL/SolidJS project. Detect first, then choose where to
edit:

- If the project has `tsconfig.json` + a `tstl`/TypeScriptToLua dependency
  and compiles `*.ts` → `game/scripts/vscripts/**.lua`: the Lua is a BUILD
  ARTIFACT. Edit the `.ts` source, never the generated `.lua` — it will be
  overwritten on the next build.
- If the project has a SolidJS/Panorama build (e.g. `solid/`, TSX sources)
  producing `content/.../panorama/**.js`: edit the `.tsx/.ts/.less` source,
  not the generated `.js/.css`.
- If neither is present, it's a plain Lua project: edit `.lua` directly.

## Data / KV values

Many teams keep ability/unit numbers OUT of the repo (design docs, online
sheets) and generate the KV. If KV files look generated (#base includes,
generated headers, or a sync tool in the pipeline), treat them as read-only —
change the source of truth, not the local KV. Plain projects that hand-edit
KV are the exception, not the rule; when unsure, ask before editing KV.

## Where things live (typical addon layout)

- Server scripts (generated Lua): `game/<addon>/scripts/vscripts/`
- TSTL source: `content/<addon>/scripts/vscripts/**/*.ts`
- Panorama source: `content/<addon>/panorama/...` or a `solid/` dir
- KV / npc config: `game/<addon>/scripts/npc/`
- Maps: `content/<addon>/maps/*.vmap`

## The dota2-mcp tools in this model

- dota_status — entry point: connection, vconsole, addon, map state, next step
  (never throws; if it reports vconsole closed, open it first).
- dota_open_vconsole / dota_launch_game / dota_restart / dota_disconnect —
  window & map control (restart is for load-only changes or clean runs, NOT
  for routine code edits). dota_launch_game waits until GAME_IN_PROGRESS and,
  if the game gets stuck in a phase, tells you how to advance it.
- console_send — send console commands (e.g. `reload_script`, cheats, cvars).
- console_output — read console output; level 3 + channel VScript for Lua errors.
- dota_run_lua — run server Lua live to verify behavior / reproduce a bug.
- dota_dump_entities / dota_dump_modifiers / dota_entity_inspect — inspect live state.
- dota_api_lua / dota_api_panorama_js / dota_api_css / dota_api_events / dota_api_help
  — query live engine APIs instead of guessing signatures.

CONTRACT: all console-based tools (console_*, dota_api_*, dota_run_lua,
dota_dump_*, dota_launch_game, dota_disconnect, dota_restart) require an open
vconsole attached to 127.0.0.1:29001 — it exists so the human can watch what
you do. The relay auto-opens vconsole2.exe when it connects to Dota (unless
DOTA2_VCON_AUTO_OPEN_VCONSOLE=0), so the window is usually already there.
If a tool still reports "vconsole 未打开": call dota_open_vconsole. Never
tell the user to use the AssetBrowser vconsole button — it is engine-disabled
while the relay holds port 29000.

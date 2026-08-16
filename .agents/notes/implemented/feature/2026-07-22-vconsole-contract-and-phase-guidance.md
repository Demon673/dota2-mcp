# Agent Note: vconsole explicit contract + game-rules phase guidance

English | [中文](2026-07-22-vconsole-contract-and-phase-guidance.zh.md)

Status: implemented

## Problem

Three problems share one root cause: the agent could not tell "Dota is not running" from "the vconsole just isn't open", and did not know how to advance a phase the launched map was stuck on.

1. **Missing contract**: console tools only checked `relay.dotaConnected`, so with the vconsole closed they reported "not connected" — even though Dota was connected — sending the agent to debug the wrong thing.
2. **Duplicate tool responsibility**: `dota_status` and `project_info` both queried `status_json` and both reported addon/maps/state.
3. **Wrong launch endpoint**: `dota_launch_game` ended at "map loaded", so the agent neither knew a phase was stuck after load nor how to advance it.

## Decision

**vconsole explicit contract (core)**: the 17 console tools enter through a shared `requireConsole()` two-stage check — Dota connected → vconsole attached to `:29001`; `dota_status` never throws and instead returns current state + next-step guidance, while the other 16 raise a clear error with the open path. Four tools are exempt: `dota_compile_asset` (pure local subprocess), `dota2_skill` (reads local docs), `console_gui_filter` (only changes forwarding filters), `dota_open_vconsole` (the contract's antidote).

**`dota_open_vconsole`**: spawns `{dotaPath}/game/bin/win64/vconsole2.exe`, waits ≤10s for `guiConnected`, and returns success/failure explicitly. No watchdog, no auto-open — it runs only when asked.

**`project_info` deleted and merged into `dota_status`**: `dota_status` absorbs every field (allMaps, hibernating, cpu_usage, build_version, process_uptime, clients_*, etc.) plus the nextStep navigation, and never throws.

**`dota_launch_game` phase polling**: after sending the launch command it polls `status_json` every 2s, with the endpoint changed from "map loaded" to `game_state` containing `GAME_IN_PROGRESS` (default timeout 90s). It tracks `lastState + lastChangeAt`: the same `game_state` for 15s without reaching the endpoint → a stuck report (plain text, no exception): current state + stuck duration + that phase's advance guidance (the `PHASE_GUIDANCE` table) + the last ~8 VScript/verbosity≥3 output lines + a pointer to `dota2_skill`'s `dota2-game-phases`. If `dotaConnected` turns false during polling it returns a crash/disconnect message immediately.

The full phase table and advance methods live in `skills/dota2-game-phases/SKILL.md` (command names hardcoded only after live `script_help2` verification).

## Alternatives considered

- **vconsole watchdog / auto-open / close counting** — lost: it fights human intent (closing the window is an explicit wish, auto-reopening is haunted); explicit > fallback, with simple rules, errors that name the cause, and the remedy in the error text.
- **Sink the contract into the daemon/relay layer** — lost: the contract is an MCP-layer product decision ("the human can watch the agent's console activity"); the daemon stays permissive so the direct 29002 protocol remains usable as a bypass for verification.
- **Keep project_info separate** — lost: both queried status_json, a duplicate responsibility; after the merge there is a single entry point (`dota_status` is the navigation).
- **Auto-kill the stale dota2.exe** — lost: a destructive action; the error text guides the user to end the process instead.

## Consequences

- **Bought**: "no window = no connection = no tools" is physically true, so the user never mistakes it for a bug; the agent gets an actionable next step; in multi-agent use, any agent opening the vconsole broadcasts `guiConnected` and unblocks every agent in lockstep (covered by `test-multi-session.mjs`).
- **Cost**: console tools gain one hard prerequisite (the vconsole window must be open), requiring the human to keep the window present — a deliberate contract, not a technical necessity (29000 itself needs no GUI). The implicit convenience of headless console use is given up.

## Testing

`scripts/test-mcp-offline.mjs` covers contract gating errors + `dota_status` not throwing; `scripts/test-mcp-live.mjs` covers gating → `dota_open_vconsole` → ungate end-to-end; `scripts/test-launch-phases.mjs` covers the stuck report + advancing to GAME_IN_PROGRESS per guidance via `dota_run_lua`; `scripts/test-multi-session.mjs` covers multiple sessions sharing the daemon. Live verification caught two bugs the offline scripts could not: the dota_open_vconsole wait being too short, and INIT being misreported as stuck during map load.

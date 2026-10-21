# Agent Note: Standard flow to a playable match

English | [中文](2026-10-17-advance-to-game.zh.md)

Status: implemented

## Problem

Testing an addon needs a match in GAME_IN_PROGRESS with a hero. After `dota_launch_game` or `dota_restart`, the game waits in CUSTOM_GAME_SETUP, HERO_SELECTION, and timed phases, and the only guidance was per-phase prose: "assign heroes via dota_run_lua", "shorten in addon code". An agent had to write the Lua itself, and the obvious shortcut is a trap: `GameRules:ForceGameStart()` before PRE_GAME reaches GAME_IN_PROGRESS with no hero spawned. Live runs on one addon turned up three more defects on the same path:

- `dota_launch_game` reported "stuck in INIT" 17 seconds into a normal map load.
- `dota_restart` returned before the restart took effect, so the next status read still saw the old GAME_IN_PROGRESS.
- Lua tool output leaked into the vconsole window. `ent_fire … RunScriptCode` runs on the next frame, after the relay's `ai_disabled; <cmd>; ai_disabled` suppression window has closed, so every `print` from `dota_run_lua`, and the collection end marker, reached the GUI.

## Decision

`dota_advance_to_game` is the one standard flow. It polls `status_json` once a second and acts only on the observed `game_state`, never on anything addon-specific:

| game_state | action |
|---|---|
| INIT, WAIT_FOR_* | wait |
| CUSTOM_GAME_SETUP | zero the strategy/showcase/pre-game timers, `FinishCustomGameSetup()` |
| HERO_SELECTION | zero the timers; through the player controller, `MakeRandomHeroSelection()` for every player without a hero, or `SetSelectedHero(hero)` for every player when `hero` is given |
| STRATEGY_TIME, TEAM_SHOWCASE | zero the timers |
| PRE_GAME, still there after 3 s | `ForceGameStart()` |
| GAME_IN_PROGRESS | report steps and each player's hero |
| POST_GAME, or no map loaded | error pointing to `dota_restart` / `dota_launch_game` |

An action repeats at most every 5 seconds while its phase persists. On timeout the tool returns the shared stuck report (`buildStuckReport`) with recent errors. The phase guidance and the `dota2-game-phases` skill now point to this tool instead of describing Lua calls.

Supporting changes:

- `dota_launch_game` does not treat INIT or WAIT_FOR_* as stuck (`isLoadingPhase`); only its timeout reports a load that never finishes.
- `dota_restart` waits up to 20 s until status shows loading or a different `game_state`.
- `collectLuaOutput` prints the relay's own toggle line (`ai_disabled =`) before and after the user code when MCP suppression is on, so deferred Lua output falls inside a suppression window. The user code runs under `xpcall(…, function(e) print(debug.traceback(e)) end)`, so a runtime error still prints the closing toggle and the end marker; without that, suppression would stick on and mute the GUI.
- The relay never forwards lines matching `MCP_MARKER_RE` to the GUI. The regex now lives in `vcon-relay.ts` and `index.ts` imports it.
- The engine silently drops any single console statement over about 510 bytes (an `echo` of 510 bytes ran, 530 did not; the limit is per `;` statement, not per line). `collectLuaOutput` rejects a wrapped `RunScriptCode` statement over `LUA_STATEMENT_MAX_BYTES` with an error that says how many bytes are available, instead of returning an empty result.
- With `sv_cheats` off the engine ignores `ent_fire` and prints only `SV: Cheat command 'ent_fire' ignored.`. `collectLuaOutput` turns that line into an error naming `sv_cheats`, so `dota_run_lua` and `dota_advance_to_game` stop at once instead of reporting "Sent" or retrying until timeout.
- While loading heavy assets the engine can leave `status_json` unanswered for several seconds. `dota_launch_game` and `dota_advance_to_game` skip a poll that got no answer instead of reading it as the state `(unknown)`.
- `dota_launch_game` reports an error when the game is still at the main menu 15 s after the launch command.
- When every player's hero is `nil` in GAME_IN_PROGRESS, `dota_advance_to_game` says the addon may create heroes itself and suggests `dota_screenshot`.

## Alternatives considered

- **An `advance` flag on `dota_launch_game`.** Rejected: re-testing after `dota_restart` needs the same flow without a launch, so the flow has to be its own tool.
- **Send every phase action in one Lua call.** Rejected: phase changes are asynchronous; acting on the observed state each second is what makes the flow independent of how a given addon orders its phases.
- **`ForceGameStart()` as the first step.** Rejected: measured to yield a match with no hero.
- **Suppress Lua output in the relay with a time window after each MCP command.** Rejected: any window long enough for deferred Lua also hides the game's own output for that long, and has to guess the length.
- **Define a persistent Lua helper in the VM to shorten the wrapper.** Rejected: it leaves MCP state in the addon's VM across calls and reloads; the per-call wrapper costs about 170 bytes and the length check makes the budget explicit.

## Consequences

Bought: from launch or restart, a playable match with a hero takes two tool calls (about 20 s measured on one addon), the steps are reported, and vconsole shows none of the agent's Lua output or markers. Cost: the timer changes affect the current match only; random picking skips players the addon has already given a hero. `dota_run_lua` code is limited to roughly 300 bytes, and with the `xpcall` wrapper a trailing `--` comment now comments out the wrapper's tail, so such code fails to compile instead of losing only the end marker.

## Testing

- `scripts/test-collect-output.mjs`: the fake Dota answers `ai_disabled` with its value and runs `RunScriptCode` prints 50 ms late. It asserts that `dota_run_lua` still returns the output, that neither the output nor any marker reaches the fake vconsole, and that a later game print does reach it. With the toggle lines removed from the build, the test fails.
- `scripts/test-mcp-offline.mjs` counts 32 tools.
- Live (Dota 2 with `-tools`, one addon whose own setup code errors): `dota_disconnect` then `dota_advance_to_game` returns the "no map loaded" error; `dota_launch_game` → `dota_advance_to_game` with `hero` reaches GAME_IN_PROGRESS with that hero; `dota_restart` → `dota_advance_to_game` takes 18–20 s and spawns a random hero. A Lua `error()` returns its traceback and the next call works normally. A 511-byte wrapped statement is rejected with the length error.
- Live on a second addon, whose heroes are created after its own login UI: from the main menu `dota_launch_game` loaded the map in about 50 s and reported CUSTOM_GAME_SETUP as stuck; `dota_advance_to_game` reached GAME_IN_PROGRESS in 4 s with `hero=nil` and the hero note, and `dota_screenshot` showed the addon's login screen. During a 75 s cold load `status_json` went unanswered for 8 s. `dota_restart` worked from both CUSTOM_GAME_SETUP and GAME_IN_PROGRESS. With `sv_cheats 0`, `dota_run_lua` returned the `sv_cheats` error in 0.5 s.

Not covered: no offline test drives `dota_advance_to_game` through its phases, and the flow has been run live on one addon with one human player and no bots.

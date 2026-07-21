---
name: dota2-game-phases
description: Use when a launched custom game gets stuck in a game-rules phase (INIT, CUSTOM_GAME_SETUP, HERO_SELECTION, PRE_GAME, etc.) after dota_launch_game, or when you need to understand/advance the current game_state. Gives per-phase normal durations and how to advance each.
---

# Dota 2 Game-Rules Phases — what stuck means and how to advance

status_json reports `server.game_state` as `DOTA_GAMERULES_STATE_*`.
dota_launch_game watches it and reports when one phase stops advancing
for 15s. This doc is the full reference for that report.

## SOP when stuck

1. console_output (level 3, channel "VScript") — a stuck phase is most
   often your addon's own Lua erroring. Fix the addon first.
2. Advance the phase per the table below (usually one dota_run_lua call).
3. If it won't advance after that, it IS an addon bug — go back to 1.

## Phase table

| game_state | normal | how to advance when stuck |
|---|---|---|
| INIT | duration of map load | Normal during map load — big maps can take minutes. Never finishing → console_output channel ResourceSystem (missing/uncompiled assets → dota_compile_asset) |
| WAIT_FOR_PLAYERS_TO_LOAD | seconds | Usually self-resolves; console_output shows which client never loads |
| CUSTOM_GAME_SETUP | until addon ends it | `dota_run_lua` code: `GameRules:FinishCustomGameSetup()` — if it re-sticks, addon setup code is erroring (see SOP 1) |
| HERO_SELECTION | addon-defined | Assign heroes via dota_run_lua, or GameRules:SetHeroSelectionTime(0) in addon code |
| STRATEGY_TIME | timed | Auto-advances; GameRules:SetStrategyTime(0) to shorten |
| TEAM_SHOWCASE | timed | Auto-advances; GameRules:SetShowcaseTime(0) to shorten |
| WAIT_FOR_MAP_TO_LOAD | seconds | Check console_output channel ResourceSystem — map likely not compiled (dota_compile_asset) |
| PRE_GAME | timed | Auto-advances; GameRules:SetPreGameTime(0) to shorten |
| GAME_IN_PROGRESS | — target state | — |
| POST_GAME | until restart | dota_restart to run again |

Notes:
- Lua method names verified against the engine's script_help2 dump.
- A phase being stuck is usually information, not an MCP failure: the
  MCP reports state + remedy and lets you decide.

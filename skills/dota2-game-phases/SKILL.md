---
name: dota2-game-phases
description: Use when a launched custom game sits in a game-rules phase (INIT, CUSTOM_GAME_SETUP, HERO_SELECTION, STRATEGY_TIME, PRE_GAME, etc.) and you need a playable match to test in, or need to understand the current game_state. Gives the standard flow (one tool) plus what each phase means.
---

# Dota 2 Game-Rules Phases — standard flow to a playable match

status_json reports `server.game_state` as `DOTA_GAMERULES_STATE_*`.

## Standard flow

`dota_advance_to_game` executes server Lua, so it requires `sv_cheats=1` and an open vconsole.

| Goal | Calls |
|---|---|
| First test run | `dota_launch_game` → `dota_advance_to_game` |
| Re-test after editing Lua/KV/Panorama | `dota_restart` → `dota_advance_to_game` |
| Re-test with a specific hero | `dota_advance_to_game` with `hero: "npc_dota_hero_<name>"` |

`dota_advance_to_game` drives the game from whatever phase it observes to
GAME_IN_PROGRESS with a hero for every player, and reports the steps it
took and each player's hero. It does not depend on how the addon is
written. Use it instead of hand-written `dota_run_lua` phase calls.

If it returns a stuck report instead, the addon's own code is blocking
that phase: read the errors in the report (or console_output level 3,
channel "VScript"), fix the addon, then `dota_restart` and repeat.

## What the tool does per phase

| game_state | action |
|---|---|
| INIT, WAIT_FOR_PLAYERS_TO_LOAD, WAIT_FOR_MAP_TO_LOAD | Wait: map loading, can take minutes on big maps. Never finishing → console_output channel ResourceSystem (missing/uncompiled assets → dota_compile_asset) |
| CUSTOM_GAME_SETUP | Zero the strategy/showcase/pre-game timers, `GameRules:FinishCustomGameSetup()` |
| HERO_SELECTION | Every player without a hero: `player:MakeRandomHeroSelection()`; with `hero`, every player: `player:SetSelectedHero(hero)` |
| STRATEGY_TIME, TEAM_SHOWCASE | Zero the timers; the game advances on its own |
| PRE_GAME | Heroes spawn on entering it. If it does not advance within a few seconds, `GameRules:ForceGameStart()` |
| GAME_IN_PROGRESS | Target state: report each player's hero |
| POST_GAME | Stop: call dota_restart |

Timer changes are runtime-only; the next map load uses the addon's own
values again.

## Pitfalls

- `GameRules:ForceGameStart()` before PRE_GAME puts the game in
  GAME_IN_PROGRESS with **no hero** spawned. Such a match is useless for
  testing; the tool only calls it from PRE_GAME.
- `PlayerResource:SetSelectedHero(id, name)` records the name but does not
  end hero selection. Pick through the player controller
  (`PlayerResource:GetPlayer(id)`) instead.
- A single console statement over about 510 bytes is silently dropped by
  the engine; `dota_run_lua` rejects code that would exceed it.

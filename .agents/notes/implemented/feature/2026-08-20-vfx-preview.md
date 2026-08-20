# Agent Note: vfx_preview runtime particle tools

English | [中文](2026-08-20-vfx-preview.zh.md)

Status: implemented

## Problem

After writing a .vpcf source and compiling it, agents had no way to see the effect in the running game — the verification leg of the vfx workflow (wayfinder #5).

## Decision

Two gated tools reuse the dota_run_lua channel (ent_fire 0 RunScriptCode). `vfx_preview` runs `ParticleManager:CreateParticle(path, PATTACH_<n>, nil)` with optional world position via `SetParticleControl(pid, 0, Vector(x,y,z))`, prints `[MCP-VFX] pid=…`; `vfx_preview_stop` runs `ParticleManager:DestroyParticle(pid, false)`. Both inherit requireConsole (map #7 amendment: same execution channel as dota_run_lua, not a new restriction). The spawn result must be confirmed against console load errors (Particles/ResourceSystem channels via console_output) — the id alone does not prove the file loaded (research #5). Attach indices 0–15 map to the ParticleAttachment_t names.

## Alternatives considered

- **Dedicated engine command.** Rejected: research #5 found no particle console command; the Lua API is the verified path.
- **Auto-destroy on a timer.** Rejected: keeps the tool stateless; explicit stop plus the returned id is simpler and the preview persists until stopped.

## Consequences

- `scripts/test-vfx-live.mjs` pins the live loop: launch addon map → advance CUSTOM_GAME_SETUP → spawn basic_explosion (pid>0, no load errors) → stop.
- Live testing surfaced two test-addon prerequisites now documented: the basic template's empty KV3 `addoninfo.txt` must declare `AddonInfo { maps … IsPlayable }` (fixed in the dota2mcptest test repo), and the map must be compiled (resourcecompiler emits `game/maps/<map>.vpk`) before `dota_launch_custom_game` can load it.
- Tool count 29 → 31.

# In-game verification of particle effects (ParticleManager via dota_run_lua)

Ticket: [Demon673/dota2-mcp#5](https://github.com/Demon673/dota2-mcp/issues/5) — research ticket.
Researched: 2026-08-20. All facts below are cited to their owning source; a source marked
`snapshot` comes from the bundled offline reference, not a live engine.

## Summary

The most stable way to verify that a `.vpcf` actually loads is to create it server-side with
`ParticleManager:CreateParticle` through `dota_run_lua`, print the returned index, then read
the console for a particle-system load error. Two failure classes are involved and they land in
**different** VCon channels: a Lua error (bad arguments) lands in the `VScript` channel, while a
failed `.vpcf` load lands in the `Particles`/`ResourceSystem` channels. A Lua-level
`CreateParticle` call can return successfully with an invalid index while the file itself fails to
load, so the console load error — not the return value alone — is the authoritative load signal.

## 1. `dota_run_lua` executes on the server

`dota_run_lua` (source: `src/index.ts`, tool `dota_run_lua`) wraps the supplied Lua in
`ent_fire 0 RunScriptCode "<lua>"` and collects `PRNT` output via `collectOutput`. The
injected marker `print('[MCP-LUA] IsServer: ' .. tostring(IsServer()))` confirms server context.
Server-side `CreateParticle` replicates to all clients, so it is the right path for verifying a
particle (the `ForPlayer`/`ForTeam` variants restrict visibility and are unnecessary for a
load check).

Implication for the call shape: the third argument `hOwner` must be a real entity handle or
`nil`. For a world-anchored smoke test, pass `nil` with a world attachment
(`PATTACH_WORLDORIGIN` or `PATTACH_CUSTOMORIGIN`), then position it with
`SetParticleControl`.

## 2. `CreateParticle` signature

`ParticleManager:CreateParticle(string sParticleName, int iAttachment, handle hOwner) -> int`
(source: `snapshot` `dota_script_help2.json` → `class_list.CScriptParticleManager.CreateParticle`;
also the Valve wiki page
[CScriptParticleManager.CreateParticle](https://developer.valvesoftware.com/w/index.php?title=Dota_2_Workshop_Tools/Scripting/API/CScriptParticleManager.CreateParticle)).

| Param | Type | Meaning |
|-------|------|---------|
| `sParticleName` | string | Full particle path (see §3). |
| `iAttachment` | int | A `PATTACH_*` value (§4). |
| `hOwner` | handle | Entity to attach to, or `nil` for world. |

Returns an `int` particle index. The snapshot does not document the failure sentinel; community
practice is that a failed create yields an invalid index (commonly `-1`), but treat this as
unverified — see §6 for the authoritative signal.

`server: true`, `client: true`.

Related variants (same first three params): `CreateParticleForPlayer` (adds a `handle` player)
and `CreateParticleForTeam` (adds an `int` team) — source: same `CScriptParticleManager` class.

## 3. Particle path writing

The path is written with a `particles/` prefix, relative to the game content root — **no**
`content/` or `content/dota_addons/<addon>/` prefix. Three examples from the snapshot
(`dota_script_help2.json` → `CScriptParticleManager` `example` fields):

- `ParticleManager:CreateParticle("particles/units/enemies/awaken.vpcf", PATTACH_ABSORIGIN_FOLLOW, hParent)`
- `ParticleManager:GetParticleReplacement("particles/units/heroes/hero_night_stalker/nightstalker_ulti.vpcf", hCaster)`
- `ParticleManager:CreateParticle(ParticleManager:GetParticleReplacement("particles/units/heroes/hero_stormspirit/stormspirit_overload_discharge.vpcf", params.attacker), PATTACH_WORLDORIGIN, nil)`

For a custom-game addon the file lives at `content/dota_addons/<addon>/particles/<name>.vpcf` and
is referenced in Lua as `"particles/<name>.vpcf"` (standard addon `content/`/`game/` split;
the snapshot examples always start with `particles/` and never include the addon name).

## 4. `PATTACH_*` values (`ParticleAttachment_t`)

Source: `snapshot` `dota_script_help2.json` → `enum_list.ParticleAttachment_t`.

| Value | Name |
|------:|------|
| -1 | `PATTACH_INVALID` (sentinel) |
| 0 | `PATTACH_ABSORIGIN` |
| 1 | `PATTACH_ABSORIGIN_FOLLOW` |
| 2 | `PATTACH_CUSTOMORIGIN` |
| 3 | `PATTACH_CUSTOMORIGIN_FOLLOW` |
| 4 | `PATTACH_POINT` |
| 5 | `PATTACH_POINT_FOLLOW` |
| 6 | `PATTACH_EYES_FOLLOW` |
| 7 | `PATTACH_OVERHEAD_FOLLOW` |
| 8 | `PATTACH_WORLDORIGIN` |
| 9 | `PATTACH_ROOTBONE_FOLLOW` |
| 10 | `PATTACH_RENDERORIGIN_FOLLOW` |
| 11 | `PATTACH_MAIN_VIEW` |
| 12 | `PATTACH_WATERWAKE` |
| 13 | `PATTACH_CENTER_FOLLOW` |
| 14 | `PATTACH_CUSTOM_GAME_STATE_1` |
| 15 | `PATTACH_HEALTHBAR` |
| 16 | `MAX_PATTACH_TYPES` (sentinel) |

For a world smoke test use `PATTACH_WORLDORIGIN` (8) or `PATTACH_CUSTOMORIGIN` (2) with `nil`
owner, then `SetParticleControl(pid, 0, Vector(...))` to place it. The snapshot's
`SetParticleFoWProperties` example shows the canonical world-particle idiom:

```lua
local iParticleID = ParticleManager:CreateParticle(
  ParticleManager:GetParticleReplacement("particles/units/heroes/hero_stormspirit/stormspirit_overload_discharge.vpcf", params.attacker),
  PATTACH_WORLDORIGIN, nil)
ParticleManager:SetParticleControl(iParticleID, 0, params.target:GetAbsOrigin())
ParticleManager:ReleaseParticleIndex(iParticleID)
```

`DOTAProjectileAttachment_t` is a **separate** enum (`enum_list.DOTAProjectileAttachment_t`, values
`DOTA_PROJECTILE_ATTACHMENT_*` 0–6); do not pass it to `CreateParticle`.

## 5. Destroy / release

Source: `snapshot` `dota_script_help2.json` → `CScriptParticleManager`.

- `DestroyParticle(int iIndex, bool bDestroyImmediately) -> void` — deletes the effect; `true`
  skips the particle's end-cap/finish effect (the snapshot description is Chinese: "如果选择立即删除，将不会播放粒子的结束特效").
- `ReleaseParticleIndex(int iParticleID) -> void` — releases the Lua handle so the particle can
  no longer be controlled; use only when the particle self-destroys (snapshot: "施放后无法在控制该特效，请保证特效会自己销毁的情况下使用").
- `SetParticleControl(int, int, Vector)` / `SetParticleControlEnt(int iParticleID, int iCP,
  handle, int attachType, string attachPoint, Vector, bool)` — position / attach a control point.

For a verification smoke test, `DestroyParticle(pid, false)` after a short delay is the clean
teardown; for a one-shot self-destroying particle, `ReleaseParticleIndex` avoids a leak.

## 6. Which VCon channel a load failure appears in

There are two distinct failure modes, and they land in different channels:

1. **Lua error** (wrong argument count/type, nil dereference in the surrounding code) — appears in
   the **`VScript`** channel. This is the repo's documented convention: `skills/dota2-runtime-dev/SKILL.md`
   and `skills/dota2-game-phases/SKILL.md` both direct `console_output` at `channel=VScript`,
   `level=3` for Lua/VScript errors.
2. **`.vpcf` itself fails to load** (missing file, uncompiled, parse error) — this is a
   particle/resource subsystem error, **not** a VScript error. The repo's own channel map
   (`src/index.ts` `channelDescriptions`) names a **`Particles`** ("粒子系统") channel and a
   **`ResourceSystem`** ("资源加载系统") channel; `skills/dota2-game-phases/SKILL.md` points at
   `ResourceSystem` for missing/uncompiled assets. The load failure should therefore be read from
   `Particles` and/or `ResourceSystem` — read `console_output` with
   `channel="Particles, ResourceSystem, VScript"` and `level=3` (or `level=0` to also catch
   warnings) to catch both classes at once.

**Open question (needs live confirmation):** the exact channel of a `particles/xxx.vpcf` load
failure was not verified against a running game — the snapshot is API-stub only and does not record
engine log routing. The `Particles`/`ResourceSystem` names above are from the repo's own channel
registry, not from an observed failure. Confirming this is the one remaining live check: run the §7
recipe against a deliberately bogus path and read `console_output` unfiltered.

## 7. Recommended verification recipe

Via `dota_run_lua` `code` (single quotes inside, no double quotes):

```lua
local pid = ParticleManager:CreateParticle('particles/<name>.vpcf', PATTACH_WORLDORIGIN, nil)
print('[PFX] created index=' .. tostring(pid))
if pid >= 0 then
  ParticleManager:SetParticleControl(pid, 0, Vector(0, 0, 0))
  ParticleManager:DestroyParticle(pid, false)
end
```

Then:

1. The `[PFX] created index=...` line is returned inline by `dota_run_lua` (it captures the
   `RunScriptCode` PRNT block after the `[MCP-LUA] IsServer` marker).
2. If the index is negative/absent **and** no particle load error appears, run
   `console_output` with `channel="Particles, ResourceSystem, VScript"` and `level=0` to read
   the actual reason.

## Sources

- Bundled snapshot (offline, primary): `dota_script_help2.json` under
  `/home/mac/.agents/skills/dota2-custom-game-dev/references/vendor/vscode-dota2-tools/resource/`
  (`class_list.CScriptParticleManager`, `enum_list.ParticleAttachment_t`,
  `enum_list.DOTAProjectileAttachment_t`).
- Repo tool/runtime conventions: `src/index.ts` (`dota_run_lua`, `collectOutput`,
  `channelDescriptions`), `skills/dota2-runtime-dev/SKILL.md`,
  `skills/dota2-game-phases/SKILL.md`.
- Valve wiki (canonical, but bot-gated when fetched directly):
  <https://developer.valvesoftware.com/w/index.php?title=Dota_2_Workshop_Tools/Scripting/API/CScriptParticleManager.CreateParticle>.

# Agent Note: FileOps tools and WSL path detection

English | [中文](2026-08-20-fileops-tools.zh.md)

Status: implemented

## Problem

MCP clients had no way to create or edit addon source files (`.vpcf` particle sources, KV, Lua, Panorama) — the first step of the vfx/model workflow (wayfinder map #4). Separately, `detectDotaPath()` returned Windows-style paths that the WSL filesystem cannot open, so every filesystem-touching tool was broken under WSL.

## Decision

Four offline FileOps tools are registered in `src/index.ts`: `file_read`, `file_write`, `file_edit` (old_string/new_string, exactly-once match, fails loudly otherwise), `file_delete` (snapshots the first 500 chars). Paths resolve as: `content/` or `game/` prefix → relative to the Dota 2 install; otherwise → `content/dota_addons/{addon}/...`. The resolved path must land inside `content/dota_addons/{addon}/` or `game/dota_addons/{addon}/` (normalized prefix check rejects `../` escapes and other addons). Addon resolution: explicit argument → relay handshake → `DOTA2_TEST_ADDON` env → filesystem single-addon inference. Max read size 5 MB.

`detectDotaPath()` (src/tools/console-bridge.ts) gains `toHostPath()`: on non-win32 platforms Windows drive paths map to `/mnt/<drive>/...` mounts. The registry lookup now runs through WSL interop (falls through on pure Linux), the SteamPath regex matches paths containing spaces, and default Steam locations are probed on all platforms (the /mnt probe fails silently where unmounted).

## Alternatives considered

- **Specialized per-format writers (a vpcf-only tool).** Rejected: vpcf is KV text; a generic FileOps plus the dota2-vfx skill (map #9) covers every format, and the engine reports format errors better than a hand-rolled validator.
- **STEAM_PATH env as the only WSL fix.** Rejected: env-only fixes the maintainer's machine, not the tool; path mapping inside the detector fixes every WSL user.

## Consequences

- Tool count 22 → 26; `scripts/test-mcp-offline.mjs` asserts 26.
- `scripts/test-fileops.mjs` pins the offline contract: write/read/edit/delete round-trip plus three boundary rejections (other addon, `../` escape, dota game dir).
- The junction layout (`game/dota_addons/{addon}` → repo) is transparent to the tools: they resolve logical paths under the Dota install and the junction follows.

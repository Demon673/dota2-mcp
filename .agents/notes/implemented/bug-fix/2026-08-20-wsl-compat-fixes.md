# Agent Note: WSL compatibility fixes from the vfx workflow drill

English | [中文](2026-08-20-wsl-compat-fixes.zh.md)

Status: implemented

## Problem

An end-to-end drill of the vfx workflow (write → compile → inspect → preview → iterate) on WSL surfaced four real defects: tool binaries resolved to a nonexistent linuxsteamrt64 dir, WSL paths passed to Windows tools, the VRF CLI invoked wrongly (stdout is an analysis summary, not decompiled text; and .NET needs invariant globalization without libicu), and the daemon's idle-exit guard saw no dota2 process (pgrep cannot see Windows processes).

## Decision

1. `getDotaBinDir` probes candidate dirs by existence (linuxsteamrt64 → win64 → osx64) instead of trusting process.platform; `resolveDotaToolPath` appends `.exe` when the win64 dir is hit. 2. `toWindowsPath` maps `/mnt/<d>/...` to `<D>:\...`; `runDotaTool` converts path args when the resolved tool is a Windows binary under WSL. 3. asset_inspect/asset_check_refs invoke the VRF CLI with `-o <file>` (and read the file) plus `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`; vtex keeps `-o <png>`. 4. `isProcessRunning` falls back to `tasklist.exe` interop when pgrep finds nothing (WSL sees Windows processes through interop).

## Alternatives considered

- **Install libicu in WSL.** Rejected: the env flag is zero-install and works on any minimal container.
- **Keep platform-based dir selection.** Rejected: existence probing matches the actual install and fixes every WSL user at once.

## Consequences

- The drill (scripts/drill-vfx-workflow.mjs) now passes end-to-end: engine logged an on-demand recompile of the written particle, vfx_preview returned pid=2, stop destroyed it.
- Two residual-environment hazards documented: stale daemons survive across sessions (kill node/relay processes and clear the state dir when port conflicts appear), and deleting relay.token while a daemon lives breaks handshakes until that daemon exits.

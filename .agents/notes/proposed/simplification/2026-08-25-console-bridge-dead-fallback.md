# Agent Note: Delete console-bridge's dead console.log fallback and its orphaned dependency

English | [中文](2026-08-25-console-bridge-dead-fallback.zh.md)

Status: proposed

## Problem

console-bridge.ts still carries the entire "write commands to a cfg file + tail game/dota/console.log" fallback: getConsoleLogPath (:72), tailConsoleLog (:77-90), grepConsoleLog (:92-105), readErrors (:116-122), parseLogLine (:125), ConsoleLogEntry, LOG_LINE_RE, ERROR_PATTERNS (:30-71). Zero consumers: dota_status uses queryStatusJson (status_json), console_output reads the relay's prntLog; no script or test imports any of them. The file header (:1-12) still narrates this dead premise. Two dead exports ride along: getDotaExeName (:276-279, superseded by resolveDotaToolPath, which inlines the .exe logic) and getDotaBinDir (:261-272, no external importer once the fallback goes). The chokidar dependency (package.json:45) exists only to serve the deleted tail watcher — no src/ or scripts/ import remains.

## Proposal

- Delete console-bridge.ts lines 30-125 (the log-tailing cluster); rewrite the header to describe the file's live role (Dota 2 path/process/tool-path detection); delete getDotaExeName; drop export from getDotaBinDir.
- Remove chokidar from package.json dependencies and regenerate package-lock.json (npm install).
- Update AGENTS.md in the same change: the console-bridge.ts Core-modules row ("writes commands to a cfg file + tails game/dota/console.log as a fallback") and the References "console.log path" row.

## Alternatives considered

- **Keep the fallback as a no-daemon safety net.** Rejected: it has had no caller since the relay path became the only console channel; reviving it would need product justification, not a dead-code keep.
- **Keep chokidar for future file-watching tools.** Rejected: dependencies are re-added cheaply when a consumer exists; an unused dependency is per-install weight and a supply-chain surface.

## Acceptance criteria

- grep tailConsoleLog/grepConsoleLog/readErrors/getConsoleLogPath/getDotaExeName in src/ and scripts/ returns zero hits.
- package.json has no chokidar; package-lock.json regenerated; npm install clean; npm run check passes.
- AGENTS.md rows updated in the same commit.

## Risks

- Any external scripting against the old console.log fallback loses it — no such consumer exists in repo, and the relay prntLog path is strictly richer.

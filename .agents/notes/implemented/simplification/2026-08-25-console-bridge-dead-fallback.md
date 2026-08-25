# Agent Note: Delete console-bridge's dead console.log fallback and its orphaned dependency

English | [中文](2026-08-25-console-bridge-dead-fallback.zh.md)

Status: implemented

## Problem

console-bridge.ts carried the entire "write commands to a cfg file + tail game/dota/console.log" fallback — getConsoleLogPath, tailConsoleLog, grepConsoleLog, readErrors, parseLogLine, ConsoleLogEntry, LOG_LINE_RE, ERROR_PATTERNS — with zero consumers: dota_status uses queryStatusJson (status_json), console_output reads the relay's prntLog, and no script or test imported any of them. Two dead exports rode along: getDotaExeName (superseded by resolveDotaToolPath, which inlines the .exe logic) and getDotaBinDir (no external importer). The chokidar dependency existed only to serve the deleted tail watcher.

## Decision

console-bridge.ts no longer contains the cfg-file/console.log fallback: the whole log-tailing cluster is deleted and the file header describes its live role (Dota 2 path/process/tool-path detection, WSL mapping, vconsole2 spawn). getDotaExeName is deleted and getDotaBinDir is no longer exported. chokidar is removed from package.json dependencies with the lockfile regenerated. AGENTS.md's console-bridge row and the References "console.log path" row were updated in the same change.

## Alternatives considered

- **Keep the fallback as a no-daemon safety net.** Rejected: it had no caller since the relay path became the only console channel; reviving it would need product justification, not a dead-code keep.
- **Keep chokidar for future file-watching tools.** Rejected: dependencies are re-added cheaply when a consumer exists; an unused dependency is per-install weight and a supply-chain surface.

## Consequences

Each npm install drops an unused dependency. console.log is no longer an advertised path anywhere in the repo; console history is available through console_output (relay prntLog) only.

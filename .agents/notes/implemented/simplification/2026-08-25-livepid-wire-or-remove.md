# Agent Note: livePid — wire it into startup or remove it

English | [中文](2026-08-25-livepid-wire-or-remove.zh.md)

Status: implemented

## Problem

daemon-utils.livePid() — the stale-PID/lock cleanup (kill(pid,0) liveness probe + compare-before-unlink defense) — had no production caller. Its only consumers were scripts/test-daemon.mjs (reading relay.pid to kill the daemon) and CHANGELOG history. Because it was unwired, a crashed (non-idle-exit) daemon left relay.lock + relay.pid behind, acquireLock() EEXISTed forever, and the next session silently degraded to the local relay — the manual "clear os.tmpdir()/dota2-mcp/ state files" workaround in AGENTS.md Known issues.

## Decision

Branch B shipped: createRelay() calls livePid() before acquireLock(), so a crashed daemon's stale relay.pid/relay.lock self-heal on the next session start. The manual-cleanup step is removed from AGENTS.md Known issues (the kill-the-leftover-process guidance stays). test-daemon.mjs gained an offline scenario asserting livePid() returns null for a dead PID and cleans both stale files.

## Alternatives considered

- **A (remove).** Pure surface removal; would have cost nothing today because the workaround existed, but left the stale-lock failure mode permanent.
- **B (wire).** Adds a tiny startup check. Risk: pid reuse — a stale pid file pointing at an unrelated live process blocks startup (same failure as today), which the compare-before-unlink defense already bounds.

## Consequences

Startup mutates the state dir by deleting stale files. The kill(pid,0) probe and the compare-before-unlink guard prevent touching a live daemon's state, and the Known-issues warning "don't delete relay.token while the daemon is alive" stands. The stale-lock failure mode requires no manual intervention.

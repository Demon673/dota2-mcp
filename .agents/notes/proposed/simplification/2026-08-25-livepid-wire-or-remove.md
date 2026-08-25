# Agent Note: livePid — wire it into startup or remove it

English | [中文](2026-08-25-livepid-wire-or-remove.zh.md)

Status: proposed

## Problem

daemon-utils.livePid() (:56-76) — the stale-PID/lock cleanup (kill(pid,0) liveness probe + compare-before-unlink defense) — has no production caller. Its only consumers are scripts/test-daemon.mjs (:93/:403/:426, reading relay.pid to kill the daemon) and CHANGELOG history. Because it is unwired, a crashed (non-idle-exit) daemon leaves relay.lock + relay.pid behind, acquireLock() EEXISTs forever, and the next session silently degrades to the local relay — the manual "clear os.tmpdir()/dota2-mcp/ state files" workaround in AGENTS.md Known issues.

## Proposal

Decision fork, pick one:

- **A (pure simplification)**: delete livePid(); inline a plain readFileSync(pidPath) where test-daemon.mjs needs the pid; keep the Known-issues workaround as the recovery path.
- **B (bug fix)**: call livePid() in createRelay before acquireLock() (index.ts ~:82) so a dead daemon's stale lock/pid self-heals; then remove the manual-workaround sentence from AGENTS.md Known issues and keep the test usages as-is.

Recommend B: it removes user-facing surface (the manual recovery step) with the already-tested helper, and closes the failure mode the helper was built for.

## Alternatives considered

- **A (remove).** Pure surface removal; costs nothing today because the workaround exists, but leaves the stale-lock failure mode permanent.
- **B (wire).** Adds a tiny startup check. Risk: pid reuse — a stale pid file pointing at an unrelated live process blocks startup (same failure as today), which the compare-before-unlink defense already bounds.

## Acceptance criteria

- Chosen branch lands: either livePid deleted (A) with test-daemon reading relay.pid directly, or createRelay self-heals stale locks (B) and the AGENTS.md manual-cleanup sentence is removed.
- test-daemon.mjs still passes in both cases; A changes no behavior, B adds the stale-lock recovery scenario to test-daemon.

## Risks

- B changes startup behavior (lock self-recovery). The liveness probe must never delete the state of a live daemon — livePid's kill(pid,0) already guards this; the Known-issues warning "don't delete relay.token while the daemon is alive" must survive in the surrounding comment.

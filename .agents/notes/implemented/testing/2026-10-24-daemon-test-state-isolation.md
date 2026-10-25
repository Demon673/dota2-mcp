# Agent Note: Isolated daemon state in offline tests

English | [中文](2026-10-24-daemon-test-state-isolation.zh.md)

Status: implemented

## Problem

Offline MCP and daemon tests randomized their TCP ports but shared the production daemon state directory. `test-daemon.mjs` deleted and recreated the real `relay.token`, `relay.pid`, and `relay.lock`; other tests overwrote the pid file when they spawned a daemon. Running the offline suite beside a live daemon therefore caused `bad token` handshake failures and made lifecycle operations target the wrong process.

Tests also killed only their MCP child, not the daemon it spawned. Because a running Dota process suppresses daemon idle exit, repeated offline runs accumulated detached relay processes.

## Decision

- `DOTA2_VCON_STATE_DIR` overrides the directory used for daemon token, pid, lock, and log files, and for the capture watcher's lock, source, and request files. The default remains `os.tmpdir()/dota2-mcp`, with the existing home-directory fallback. Override paths are resolved to absolute paths so a spawned daemon sees the same location as its parent.
- Every offline script that spawns an MCP server uses its own temporary state directory. `test-daemon.mjs` tracks all its spawned children and kills them plus the pid-file process on every exit.
- `spawnMcpServer` accepts `cleanupDaemon: true`, which requires an isolated state directory. Its cleanup kills the MCP child and the daemon or capture watcher recorded in that directory, and also runs when an assertion exits the process. Live scripts do not enable it.
- Normal test exits remove their temporary directories. The daemon-respawn test waits 45 s for the initial port, matching the existing slow-start tolerance, and startup failures include MCP stderr and the relay log. `lib-test-ports.mjs` briefly listens on every port in each requested block before the test starts, so relay, daemon, console, screenshot, file, asset, and MCP smoke tests do not rely on random selection alone.

## Alternatives considered

- **Random ports alone.** Rejected: they do not isolate token, pid, lock, or log files.
- **Back up and restore production state around each test.** Rejected: concurrent MCP sessions can change it during the test, restoration can overwrite a newer daemon's state, and a failure can leave the live configuration damaged.
- **Kill leftover `node` or `relay-main` processes by image name.** Rejected: that can kill unrelated user sessions. Cleanup uses only pids from the test's own child list and isolated state directory.

## Consequences

The offline suite can run while Dota, vconsole, and a production daemon remain active, without changing their authentication or lifecycle state or leaving test daemons behind. Production behavior is unchanged unless the new override is set. Callers enabling `cleanupDaemon` must use a unique state directory; sharing it would let one test kill another test's daemon. Failed tests can leave temporary files for diagnosis, but not running processes.

## Testing

With Dota, vconsole, and a live daemon running, the complete offline release suite passed. SHA-256 comparisons of the live `relay.token`, `relay.pid`, and `relay.lock` before and after the suite were identical, and a process query afterwards found only the original live daemon and capture watcher. A subsequent MCP call still completed its handshake and executed Lua. The daemon test then passed twice consecutively with the port-block check. The two Windows-skipped VRF scripts retain their existing POSIX-only coverage.

# Agent Note: repository boundary and lifecycle fixes

English | [中文](2026-11-04-repo-review-fixes.zh.md)

Status: implemented

## Problem

Several tools could report success after incomplete work or share state across the wrong boundary: filesystem links escaped addon/output roots, delayed socket events replaced current connection state, and duplicate Panorama panel IDs shared event handlers. Offline fixtures also selected the installed game before their explicit temporary Steam root.

## Decision

- File operations and recordings check both lexical and physical ancestry, including the existing ancestor of a new file. A linked addon root is supported; links escaping that root are rejected before reading, deleting, or writing. `STEAM_PATH` precedes registry discovery, and test-addon overrides precede filesystem inference.
- Read-only console queries quote literal engine arguments and reject quotes, backslashes, separators, and control characters. API enumeration tools send only the dump command and filter its output locally, so a query cannot add a command.
- Control sockets and the MCP smoke client's stdout decode UTF-8 incrementally. Reconnects discard partial input, callback exceptions stay inside the dispatcher, and shutdown closes sockets awaiting authentication. STREAM sends current status, addon, channels, and filters to cover changes after HELLO. Pending handshakes have a 5-second deadline; control lines are limited to 1024 characters before authentication and 1048576 afterward. Unauthenticated traffic does not extend daemon idle time. Engine callbacks update state only while they own the current connection; errors, closes, and connection failures share their cleanup.
- Empty relay tokens and malformed bridge tokens fail explicitly. POSIX state/token permissions are private. Port/PID validation precedes socket/process calls; a dead lock owner is cleaned up even without a PID file, while a live peer retains its spawn lock. PID cleanup preserves another process's record, and closed relays cannot recreate idle timers.
- Panorama collection uses matching marker IDs. Event handlers belong to a panel instance and event, including unnamed panels and panels with duplicate IDs.
- Failed or timed-out PresentMon runs cannot turn partial samples into success. SEA packaging uses the current Node executable and an argument array for the installed postject CLI.
- Dependency minimums and the lockfile include the security updates. The required runtime is Node 20 or newer, matching the updated dependency tree and installation instructions. Live scripts infer their project, honor configured control ports/state directories, restore temporary render settings, and remove only their own panel handlers.
- Changelog/tag consistency is checked after the annotated release tag is created, before publication, and in release CI. Pre-commit checks pairing, budgets, archived notes, and whitespace; it cannot require the tag of a commit that does not exist yet.
- Packaged-executable and stdin-EOF smoke tests use private state and isolated ports, disable automatic vconsole/watcher startup, and wait for their own daemon to exit before removing its state.

The asset contracts are owned by the [inspection](../feature/2026-08-20-asset-inspect.md) and [VRF installation](../feature/2026-08-20-vrf-ensure.md) notes.

## Alternatives considered

- **Lexical path checks alone.** Existing junctions and symlinks bypass them; resolving physical ancestry retains ordinary addon junctions while enforcing the boundary.
- **Rely on socket event order.** A previous connection can close after its replacement connects; ownership checks make that ordering harmless.
- **Preserve Node 18 dependency versions.** Those locked versions carry security advisories; the patched dependency tree requires Node 20.

## Consequences

Node 18 installations need an upgrade. Corrupt token files require explicit repair instead of silently weakening authentication. Path checks cover the filesystem state at validation time; they are not a transaction against concurrent filesystem changes.

Dota's existing socket-shutdown fatal (10038) remains an engine risk during active output; see the [shutdown note](2026-10-26-vconsole-socket-shutdown-fatal.md).

## Testing

The release smoke set includes `test-control-protocol.mjs`. Existing relay, console collection, FileOps, recording, Panorama, performance, VRF, and asset scripts contain the reproductions, including read-only query injection, TCP resets, and long multibyte stdio responses. The Panorama fixture executes the generated bridge JavaScript; Windows fixture windows exercise input focus and the capture window-state API without targeting Dota. Live acceptance covers gating, GUI reopen, game crash/restart, shared sessions, duplicate/unnamed-panel events, and preservation of both render settings.

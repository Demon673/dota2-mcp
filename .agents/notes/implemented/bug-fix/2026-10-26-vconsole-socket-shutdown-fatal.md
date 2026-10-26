# Agent Note: VConsole socket shutdown fatal (10038)

English | [中文](2026-10-26-vconsole-socket-shutdown-fatal.zh.md)

Status: implemented

## Problem

Stopping the relay daemon with `Stop-Process -Force` while Dota was attached and streaming console output made Dota 2 raise `FATAL ERROR: Cannot recover from failed socket shutdown. (error 10038)` and stop accepting VConsole clients on `:29000`. Daemon restarts are part of normal development, so an abrupt disconnect from our side must not take the engine's console server down.

## Decision

Relay teardown waits for a 300 ms quiet gap in Dota's output (1 s cap), then half-closes the TCP socket (FIN), keeps reading until the peer closes, and destroys it only after a 1.2 s fallback. The daemon waits 2.5 s after closing before exiting so the quiet wait and drain complete. The control port accepts `SHUTDOWN` after the `HELLO` token, and thin clients expose `shutdownDaemon()`; development and test flows restart the daemon through it instead of force-terminating the process. Force-termination still closes the socket with unread data and can trigger the engine race, so it is unsafe while Dota is attached.

## Engine mechanism

`vconcomm.dll`, linked into Dota's `server.dll` and `vconsole2.exe`, tears a VConsole connection down by calling `shutdown(SD_BOTH)` and then `closesocket`. Its error check treats `WSAECONNRESET`, `WSAENOTCONN` and `WSAESHUTDOWN` as normal but calls `Plat_FatalError` for every other error; `WSAENOTSOCK` (10038) is the fatal one. The recv and send wrappers each call the same per-connection close on error, and both can pass the `-1` guard before either closes the socket, so the second `shutdown` runs on a closed handle. A close that leaves unread received data makes Windows send RST instead of FIN, failing the engine's recv and send threads together and opening that race; a FIN with continued draining lets the peer's read side observe EOF while its send side still works.

The positions are Ghidra labels from the shipped binaries (no symbols): recv wrapper `FUN_18000e8a0`, send wrapper `FUN_18000ebf0`, per-connection close `FUN_18000e980`, socket-set teardown `FUN_18000e110`.

## Alternatives considered

**Destroy immediately after `end()` (the previous 250 ms fallback).** Rejected: destroying a socket that still holds unread data is what produces the RST, so the engine race stays reachable on every teardown.

**Let process exit close the Dota socket.** Rejected: process exit has the same unread-data close semantics, and the daemon must release `:29000` for a successor to attach.

**Require the daemon to stay alive while Dota runs.** Rejected: daemon restarts are part of development and crash-recovery testing; the graceful path must be safe on its own.

**Delay or suppress engine console output during shutdown.** Rejected: it changes what the human sees without changing the socket close, so it does not address the fatal.

## Consequences

A graceful stop is verified live with a loaded game: Dota keeps `:29000`, its window stays normal, a new daemon reconnects, and a console round-trip succeeds. A force-kill remains unsafe and can still trigger the engine race; test flows that kill the daemon abruptly accept that risk. Shutdown now takes up to about 2.5 s longer. `SHUTDOWN` uses the same token authentication as the other control commands and exits with code 0.

## Testing

Offline `scripts/test-relay.mjs` covers `SHUTDOWN` emitting `shutdown-requested` and the timed GUI-suppression hold; the full offline suite stays green. Live checks cover a graceful stop with the game loaded, reconnection after restart, a console echo round-trip, and the Panorama bridge suite.

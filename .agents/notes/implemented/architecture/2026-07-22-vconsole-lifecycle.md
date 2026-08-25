# Agent Note: vconsole relay connection lifecycle (constant hold + liveness probes + init-frame replay + idle guard)

English | [中文](2026-07-22-vconsole-lifecycle.zh.md)

Status: implemented

## Problem

The relay is the transparent proxy between Dota 2 `:29000`, the vconsole2 GUI `:29001`, and the MCP control port `:29002`. The old implementation had four real defects, all reproduced in live debugging:

1. **No detection of a dead peer**: on a real crash (dump write hanging) or a half-open connection the socket sends no FIN/RST, so the relay believed it was connected forever — no reconnect, no status broadcast.
2. **A late GUI misses the init frames**: Dota pushes the `AINF→CHAN→CVRB→CFGV→ADON` init sequence at connection time, but the old relay only forwarded frames that arrived *afterwards*; a vconsole that attached after the relay already held 29000 got an empty shell window.
3. **Duplicate reconnect scheduling**: the error and close handlers each scheduled a timer, printing two log lines per retry round.
4. **Idle exit cut the lifeline**: with no thin client and no GUI for 5 minutes the daemon exited, so `29001/29002` vanished and the vconsole had nowhere to connect — even while Dota was running (the user actively developing).

## Decision

The relay **holds Dota 2 `:29000` constantly**, reconnecting every 2s on disconnect; no lease, no reference counting, no on-demand connection. Four mechanisms cover the lifecycle (all in `src/tools/vcon-relay.ts`, effective in both daemon and embedded modes):

- **Init-frame replay**: cache the raw `AINF/CHAN/CVRB/CFGV/ADON` frames per Dota connection in arrival order (cleared and rebuilt on each new connection); when a GUI connects to `:29001`, write the cached frames first, then take over live forwarding. On a Dota reconnect the new init sequence flows naturally and the attached GUI revives.
- **Liveness probe**: use the last `rawFrame` timestamp as `lastDataAt`. Periodic check (default 10s): silent >15s → send `echo __mcp_ping__` via `dotaClient.sendCommand` (no `ai_disabled` wrapping); no data within 20s after the probe → `close()` and take the existing reconnect path. Zombie detection is unified into the same probe path: a zombie accepts the TCP handshake but never sends data, so it goes silent → probe → no pong → death verdict (same path as a hung connection). The probe echo line `__mcp_ping__` is dropped by exact match in both the prnt handler and rawPrntEditor: it never enters the MCP buffer, never broadcasts to thin clients, never forwards to the GUI.
- **Reconnect dedup**: a single `_scheduleReconnect()` timer; the error/close/catch paths schedule it at most once.
- **Idle-exit guard**: the exit condition adds "and no dota2.exe process" — `clients.size === 0 && !guiConnected && !isDotaProcessRunning()`. `isDotaProcessRunning()` lives in `console-bridge.ts` (win32: `tasklist /FI "IMAGENAME eq dota2.exe"`; other platforms: `pgrep -x dota2`; conservatively returns true when the check fails, i.e. do not exit). Dota running = user developing = daemon stays up to keep `29001/29002`.

The timeouts are optional `VConRelay` constructor injection (`{probeIntervalMs, silenceMs, pongTimeoutMs, readyProbeIntervalMs}`) so offline tests can use small values.

## Alternatives considered

- **TCP keepalive** — lost: the liveness probe covers crash-hang and half-open connections without kernel tuning, reuses the relay's own reconnect semantics, and is assertable with injected timeouts offline.
- **29000 lease / reference counting / on-demand connect** — lost: on-demand connect drops passive output during disconnects and complicates the state machine; constant hold + death detection is simpler, and "no window = no connection = no tools" stays physically true.
- **vconsole watchdog / auto-open / close counting** — lost (see the feature note's [Alternatives](../feature/2026-07-22-vconsole-contract-and-phase-guidance.md#alternatives-considered)): it fights human intent and produces haunted UX; the explicit principle wins.

## Consequences

- **Bought**: the relay detects a dead/hung Dota within a bounded time and reconnects; a late GUI receives the full init sequence (usable immediately); the daemon stays up during active development, keeping `29001/29002` resident.
- **Cost**: the liveness probe adds one low-frequency `echo __mcp_ping__` command to the engine (filtered both ways, invisible); the probe pair can misjudge a very slow map load as dead (mitigated by the probe-line filter and the 20s pong window).
- **Fast failure**: a death verdict walks the existing close path, broadcasting `{type:"status", dota:false}` to all thin clients so every agent fails fast in lockstep.

## Testing

`scripts/test-relay.mjs` covers four offline scenarios (fake VCon server + random port + injected small timeouts): silent-accept (zombie) kill-and-reconnect, init-frame replay, probe pong keep-alive + probe-line filtering, and no-pong kill. `scripts/test-daemon.mjs` covers the daemon idle exit (stays up while Dota runs). The live matrix is in `AGENTS.md`'s development-verification workflow. Live verification caught the GUI-connect state not broadcasting (which silently broke the whole contract).

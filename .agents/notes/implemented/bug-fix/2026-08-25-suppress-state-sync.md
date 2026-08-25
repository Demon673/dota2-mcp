# Agent Note: Suppress state single source of truth (hello-ok + broadcast)

English | [中文](2026-08-25-suppress-state-sync.zh.md)

Status: implemented

## Problem

RelayClient kept local `mcpSuppressEnabled`/`guiSuppressPatterns` shadows of the daemon's suppress state. The daemon's hello-ok carried no suppress fields, and `setMcpSuppressEnabled`/`setGuiSuppressPatterns` changed the daemon without telling other thin clients. After a daemon respawn (defaults restored) a client's local flags shadowed a daemon that had reset, so `console_gui_filter` reported the stale client view; other clients' views also went stale the moment any one client changed a setting.

## Decision

The daemon is the single source of truth: hello-ok now carries `mcpSuppress` and `guiPatterns`, and RelayClient adopts them on every handshake. `setMcpSuppressEnabled`/`setGuiSuppressPatterns` broadcast `{type:"suppress", mcpSuppress, guiPatterns}` to all streaming thin clients, and RelayClient updates its locals on receipt. `console_gui_filter` therefore always reads daemon truth. A client's chosen settings reset to the daemon defaults when the daemon respawns — the defaults are the safe hidden-output state, consistent with the gating model.

## Alternatives considered

- **Replay SETFILTERS/SETMCPSUPPRESS on reconnect.** Rejected: each client replaying its own local state would let a reconnecting client clobber another client's live settings; adopt-from-daemon keeps exactly one owner.
- **Keep client shadows without sync.** Rejected: that was the desync bug.

## Consequences

hello-ok grows two fields, and one new broadcast message type (`suppress`) joins `status`/`prnt`/`adon`/`chan`. Multi-client views stay consistent, and the reconnect path needs no SETFILTERS/SETMCPSUPPRESS replay (hello-ok re-syncs). test-daemon.mjs gained scenario 4b asserting the initial hello-ok fields and the peer broadcast on SETMCPSUPPRESS.

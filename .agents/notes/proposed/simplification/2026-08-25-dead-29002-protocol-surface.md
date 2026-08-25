# Agent Note: Delete the dead legacy 29002 protocol surface and output-buffer mirrors

English | [中文](2026-08-25-dead-29002-protocol-surface.zh.md)

Status: proposed

## Problem

The daemon's control port (29002) implements four legacy text commands that no production client sends: `STATUS` (vcon-relay.ts:315-323), `SHUTDOWN` (:326-330), `FILTERS` (:351-353), `TAIL` (:348-350). Thin clients send only HELLO/STREAM/CMD:/SETFILTERS:/SETMCPSUPPRESS (relay-client.ts), and the vconsole2 GUI speaks binary frames on 29001 — the only senders of the four branches are two scripts: test-daemon.mjs:152 (TAIL:5 round-trip observable) and verify-phase-apis.mjs:11 (TAIL:500 dump). The branches drag four dead buffers with them: VConRelay.prntBuffer (:102, fed :578-580, read only by getRecentOutput :217), VConRelay._prntLog (:103, push :579 shift :580, never read), RelayClient.prntBuffer (:33, fed :187-188, read only by its getRecentOutput :213, which has zero callers anywhere and exists only to mirror the VConRelay interface), and index.ts local prntBuffer (:154/:191/:194, pushed/shifted in lockstep with the live prntLog but never read — console_output reads prntLog, :418-431).

## Proposal

- Delete from vcon-relay.ts: the STATUS/SHUTDOWN/FILTERS/TAIL branches, getRecentOutput(), prntBuffer, _prntLog (field, push, shift), and the stale "旧协议直通" comment above the branches.
- Delete from relay-client.ts: getRecentOutput() and prntBuffer (field, prnt-handler feed, and the header comment listing the interface subset).
- Delete index.ts local prntBuffer (:154/:191/:194), keeping the prntLog length guard.
- Migrate the two script consumers: test-daemon.mjs replaces its TAIL:5 round-trip with a CMD: echo + STREAM line assertion (the helper already models both); verify-phase-apis.mjs switches its dump from TAIL:500 to STREAM collection (already its primary mechanism).
- Update AGENTS.md: the dev-workflow line about "the relay prntBuffer only holds 500 lines, so a full dump would flush the TAIL window" becomes STREAM-only guidance.

## Alternatives considered

- **Keep TAIL as the diagnostic dump path.** Rejected: verify-phase-apis already collects via STREAM; TAIL's 500-line window is strictly worse than the streaming dump it guarded, and console_output reads the thin client's own prntLog, so no MCP tool depends on it.
- **Delete only the buffers, keep the branches.** Rejected: the branches exist only to serve the buffers; STATUS duplicates hello-ok (which every thin client already receives), FILTERS has no reader, SHUTDOWN has no sender.

## Acceptance criteria

- grep in src/ for STATUS/SHUTDOWN/TAIL:/FILTERS/getRecentOutput/prntBuffer/_prntLog returns no production hits (scripts migrated).
- npm run check plus test-relay/test-daemon/test-mcp-offline all pass; test-daemon's replaced observable still asserts the same round-trip fact.
- AGENTS.md no longer mentions a TAIL window.

## Risks

- Removing STATUS/FILTERS shrinks the control protocol: an unknown external tool speaking the undocumented legacy commands would break. The only known 29002 speakers are RelayClient and the two scripts; hello-ok already carries the STATUS payload, so its diagnostic value is preserved.
- _prntLog removal is safe while nothing reconstructs console history daemon-side; history lives in each thin client's prntLog (broadcast via PRNT frames), untouched by this change.

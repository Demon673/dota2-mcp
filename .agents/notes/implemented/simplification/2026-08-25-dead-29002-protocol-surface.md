# Agent Note: Delete the dead legacy 29002 protocol surface and output-buffer mirrors

English | [中文](2026-08-25-dead-29002-protocol-surface.zh.md)

Status: implemented

## Problem

The daemon's control port (29002) implemented four legacy text commands that no production client sent: `STATUS`, `SHUTDOWN`, `FILTERS`, `TAIL` (all in vcon-relay.ts). Thin clients send only HELLO/STREAM/CMD:/SETFILTERS:/SETMCPSUPPRESS (relay-client.ts), and the vconsole2 GUI speaks binary frames on 29001 — the only senders of the four branches were two scripts (test-daemon.mjs TAIL:5 round-trip, verify-phase-apis.mjs TAIL:500 dump). The branches dragged four dead buffers with them: VConRelay.prntBuffer (read only by getRecentOutput), VConRelay._prntLog (never read), RelayClient.prntBuffer (read only by its getRecentOutput, which had zero callers and existed only to mirror the VConRelay interface), and index.ts's local prntBuffer (pushed/shifted in lockstep with the live prntLog but never read — console_output reads prntLog).

## Decision

The four legacy commands are gone from vcon-relay.ts (STATUS/SHUTDOWN/FILTERS/TAIL); the control protocol is HELLO/STREAM/CMD:/SETFILTERS:/SETMCPSUPPRESS. VConRelay.getRecentOutput() and its prntBuffer are deleted, _prntLog is deleted, RelayClient's getRecentOutput()/prntBuffer are deleted, and index.ts keeps only the structured prntLog. Consumers: test-daemon.mjs asserts the CMD round-trip via the relay's OK ack (offline the relay never echoes CMD output because Dota isn't connected — the ack is the observable round-trip fact), verify-phase-apis.mjs collects output fully via STREAM, and AGENTS.md documents STREAM as the only output channel (env table, data-flow diagram, and dev-workflow prose).

## Alternatives considered

- **Keep TAIL as the diagnostic dump path.** Rejected: verify-phase-apis already collects via STREAM; TAIL's 500-line window was strictly worse than the streaming dump it guarded, and console_output reads the thin client's own prntLog, so no MCP tool depended on it.
- **Delete only the buffers, keep the branches.** Rejected: the branches existed only to serve the buffers; STATUS duplicated hello-ok (which every thin client already receives), FILTERS had no reader, SHUTDOWN had no sender.

## Consequences

The control protocol is four commands smaller and the mirrored getRecentOutput surface is gone from both relay sides. The STATUS payload survives in hello-ok, which every thin client receives at handshake. test-daemon's round-trip check now asserts the OK ack; verify-phase-apis still dumps complete output via STREAM; console_output behavior is unchanged (it reads the thin client's prntLog). Any unknown external tool speaking the removed legacy commands loses them — no such consumer exists in-repo.

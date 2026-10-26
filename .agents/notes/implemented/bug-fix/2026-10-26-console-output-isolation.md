# Agent Note: MCP console output isolation from the human GUI

English | [中文](2026-10-26-console-output-isolation.zh.md)

Status: implemented

## Problem

The relay's `ai_disabled; <cmd>; ai_disabled` wrapper assumed Dota echoes `ai_disabled = false/true` around the command. A live capture with a stand-in GUI showed the engine prints nothing for the bare cvar: the filter never turned on, so `status_json`, `script_help2`, entity dumps and `echo` output reached the vconsole2 window. The same capture showed the engine replays its console backlog whenever a VCon client connects, so a newly attached GUI also received every dump from earlier in the session. The human's console must stay free of MCP output while still showing their own commands and engine messages.

## Decision

The collect-output echo markers are the suppression boundary: every collected command starts with `echo __mcp_<hash>_begin;` and the end marker is `__mcp_<hash>_end`. The relay tracks an **open-window set keyed by marker id**: a begin adds its id, only the matching end removes it, and the GUI filter is active while the set is non-empty. A synchronous command echoes its end; the Lua path keeps its window open past the synchronous part because `RunScriptCode` executes one frame later, and the Lua body prints the end marker only after it finishes (`xpcall` prints it on a runtime error too). Concurrent sessions therefore cannot close each other's window. A window whose end marker never arrives expires after 15 s (`markerWindowMs`). The bare `ai_disabled` wrapper and the Lua-printed `ai_disabled =` toggle lines are gone. Async MCP prefix filtering and the timed holds for direct commands are unchanged.

On each Dota connect the relay drops the first PRNT burst: a line is dropped while PRNTs keep arriving at intervals under 120 ms, the drain ends at the first quiet gap, and it is capped at 2.5 s. Init frames are unaffected, and the MCP buffer still receives the backlog.

## Alternatives considered

**Keep relying on the cvar echo.** Rejected: the shipped engine prints nothing for the bare cvar, so the boundary never existed live.

**Drop all PRNT until the first command after connect.** Rejected: it also hides genuine engine output (errors, addon prints) that arrives before the first tool call.

**Clear the engine console buffer on connect.** Rejected: it requires sending a mutating command the human did not ask for, and it destroys history they may want.

**Filter the replayed backlog by content.** Rejected: dumps and echo output are generic text with no marker, so no content rule can separate them from live engine output.

## Consequences

A live capture proves the result: the human's own `echo` line is forwarded, while status, console, Lua, bridge, API and entity-dump probes and the replayed backlog never reach the GUI. Multi-session interleaving is covered offline and live: two sessions' windows nest, an end marker only closes its own window, and a live two-session run (deferred Lua plus a synchronous collected command) left only the human echo lines in the stand-in GUI capture. The human's console starts without history on each Dota attach; the engine's own console buffer still records everything, and `console_gui_filter auto:false` still exposes MCP lines for debugging. Commands issued immediately after attach can wait while the engine replays its buffer (one live status call took 6.5 s) but are not lost. While any window is open, non-MCP engine output emitted in that interval is hidden too; the windows are short except for long Lua calls.

## Testing

`scripts/test-relay.mjs` covers the echo-marker window, the multi-session interleave (an end marker only closes its own window), the unclosed-window expiry, async prefix filtering, timed holds and `SHUTDOWN`. The live fake-GUI capture is the end-to-end check: with the real engine and a stand-in GUI on 29001, output from status, API dumps, entity dumps, Lua, `console_send`, launch, restart, the Panorama bridge, VFX preview and the test runner never reached the GUI, while bare-CMND human echo lines before and after the battery did, and Dota survived the stand-in GUI teardown. A second live run fired a deferred Lua from one session and a synchronous collected command from another; only the two human echo lines reached the GUI.

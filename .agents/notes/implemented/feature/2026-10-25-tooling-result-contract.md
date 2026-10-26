# Agent Note: One result contract for the MCP tool surface

English | [中文](2026-10-25-tooling-result-contract.zh.md)

Status: implemented

## Problem

Agents driving Dota 2 custom-game work read the same failure three ways and could not tell a complete answer from a truncated one. Console output was a tail window with no cursor: reading twice returned the same lines, and a missed line left no trace. Errors were free text in Chinese and English, so an agent had to pattern-match prose to decide whether to enable cheats, open vconsole, or advance the phase. Each tool returned its own shape — bare text, raw JSON, a table — and none carried MCP annotations, so a client could not warn that a call writes files or reloads the match. Two production gaps had no tool at all: motion evidence for VFX recipes (only single frames existed) and measured frame cost (the budget stayed "not measured").

## Decision

Every tool returns one contract, built only by `src/tools/tool-result.ts`:

- success: `{"ok":true, ...payload}` where the payload is exactly one of `lines` (a single newline-joined string, plus `count`, `next_seq`, `dropped`), `text`, or `data` with an optional `text` summary;
- failure: `{"ok":false, "code": "...", "message": "..."}` with `isError: true`; `ERROR_CODES` is append-only so agents can branch on codes instead of wording.

Console reads are incremental. Every buffered line carries a monotonic `seq`; the session keeps a cursor; explicit views (`tail`, `since_seq`, `from_start`, and `lines` as a one-release alias of `tail`) never move it, filters select inside the returned window without consuming unmatched lines, and a first call with no cursor tails the last 50 lines. `console_send` closes its own window between the per-call markers and advances the cursor just past that window, so "send one command, see that command's output" is atomic while delayed output stays readable.

`dota_status` answers "what can I do right now" from live facts (`daemon`, `vconsole`, `dota`, `phase`, `cheats`, `addon`, `map`, `available_actions`), and the connection and phase errors point at the same names.

All tools carry the four MCP hints and a five-part description (when to use, behavior, returns, limits, related tools). Offline assertions fail the build when either is missing.

Three tools were added and follow the same contract:

- `dota_record` captures the **window** through Windows.Graphics.Capture, not the desktop region: a screen crop records whatever is in front of the game, which is what live testing showed. It records through the existing screenshot helper and encodes with ffmpeg; when an unfocused game stops presenting frames it asks the connected console for `r_always_render_all_windows 1`, retries once, and restores the value.
- `dota_perf` wraps a pinned, sha256-verified PresentMon release and reports p50/p95/p99 with an optional baseline. PresentMon needs an elevated terminal; the tool says so instead of returning an empty sample. An unfocused game can stop presenting frames, so an empty sample with a console open is retried once with `r_always_render_all_windows` (restored afterwards).
- `dota_test_run` loads `scripts/vscripts/tests/<name>.lua` inside the engine and executes one console statement per test, so one failing test does not stop the rest and a hang is bounded per test and per run.

## Alternatives considered

- **Arrays of structured line objects instead of one string.** Rejected: per-line objects multiply token cost for output that agents read as text, while the budget information (`count`, `next_seq`, `dropped`) is already structured beside the string.
- **A dual shape, old text beside the new envelope, kept forever.** Rejected: the point of the contract is that an agent never has to guess the shape; a permanent second form defeats it. Old parameter names survive one release, tool names do not change.
- **Multi-instance routing (`studio_id`) and a client-side execution target (`datamodel_type`) copied from Roblox Studio's MCP.** Rejected: Dota is a single process, and our client-side work is console commands rather than a Luau sandbox, so both parameters would be ceremony without a second case.
- **An `async`/`jobId` model for every long operation.** Deferred: the console family has no long operations, and the lifecycle tools need its own design round rather than a smuggled-in first case.
- **Mock-based Lua unit tests.** Rejected as the primary path: the engine API is where custom-game code actually breaks, so the test tool runs in the game; pure-logic tests stay with the project's own runner.
- **ddagrab for recording.** Rejected after live testing: it captures a desktop region, so an occluded window recorded the browser in front of it. It was the smaller first step, and the live run is what disqualified it.

## Consequences

The contract is a breaking change and ships as 2.0.0; `CHANGELOG.md` carries the migration table. Existing scripts that asserted raw content needed their assertions to read the envelope's field — behavior-level assertions survived, shape-level ones were updated deliberately.

Two payload mappings were refined against the spec: it mapped `file_read` to text and engine dumps to `data`, while the shipped contract does the opposite — a file read carries structured `{path, bytes, text}` data, and dumps are line text. The `daemon_down` code was removed: no path can emit it, the daemon self-heals, and a thin client reports the same `dota_down`/`vconsole_closed` facts, so the three-layer connection distinction collapses to those two codes.

Costs accepted: a per-session cursor resets when the MCP session restarts, and a session only sees output from after it attached (the daemon does not replay history). Multi-line `console_send` now sends one statement, so a command that tears down the connection (`disconnect`) waits out the collection timeout and returns a partial window without advancing the cursor — the description says so. `dota_record` at high fps on very large windows can fall behind real time because the helper encodes PNGs inline.

Bought: repeated reads no longer duplicate, missed output is reported as `dropped`, failures are branchable, every tool advertises risk, and three previously impossible checks — motion evidence, frame-cost measurement, in-game assertions — now exist. Live acceptance on a running game covered the capability matrix, cursor/echo reads, the Lua channel, a precache-verified preview, a background-window recording (frame inspected: the game window, not the foreground app), a frame-time capture (p50/p95/p99 after the automatic `r_always_render_all_windows` retry for the unfocused game) plus the PresentMon elevation error, and a real test file returning pass/fail/continue.

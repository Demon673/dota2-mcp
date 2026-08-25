# Agent Note: Shared MCP stdio test client; fold the legacy all-tools smoke

English | [中文](2026-08-25-shared-mcp-test-client.zh.md)

Status: implemented

## Problem

Nine scripts hand-rolled the same MCP-over-stdio client — spawn node dist/index.js + newline-JSON id-map + poll-timer call(), plus per-script assert/sleep. test-mcp-tools.mjs was stale: EXPECTED_TOOLS still listed the removed project_info and omitted 10 newer tools, so it always exited 1, while tool enumeration was already owned by test-mcp-offline's 31-tool + no-project_info assertions — but test-mcp-tools was the only live smoke for 11 tools (the five dota_api_* queries, dota_dump_entities/modifiers, dota_entity_inspect, console_find/help/gui_filter).

## Decision

scripts/lib-mcp.mjs ships spawnMcpServer({timeoutMs, env}) returning { call, notify, kill } plus shared assert/sleep, spawning the real dist/index.js. All nine stdio-spawn sites import it and their hand-rolled spawn/map/call/assert/sleep copies are deleted (per-script timeouts, env, assertions, and flow preserved). test-mcp-tools.mjs is rewritten: the EXPECTED_TOOLS enumeration and the MCP SDK client import are gone; its 11 live smoke calls run on the shared helper. The bespoke fake Dota servers in test-relay.mjs/test-daemon.mjs are untouched.

## Alternatives considered

- **Delete test-mcp-tools.mjs outright.** Rejected: it was the only live coverage of 11 tools; the fold preserves those smokes.
- **Also extract the fake-server/frame-header builders.** Rejected: speculative — each fake asserts different invariants; sharing them would weaken boundary realism.

## Consequences

One plumbing implementation serves nine scripts; the 11-tool live smoke coverage survives the fold; no script imports the MCP SDK client anymore. The helper replaces only per-script plumbing — boundary realism (real dist/index.js, bespoke fake servers) is unchanged.

# Agent Note: Shared MCP stdio test client; fold the legacy all-tools smoke

English | [中文](2026-08-25-shared-mcp-test-client.zh.md)

Status: proposed

## Problem

Nine scripts hand-roll the same MCP-over-stdio client — spawn node dist/index.js + newline-JSON id-map + poll-timer call(), plus per-script assert/sleep (test-mcp-offline:12, test-mcp-live:10, test-crash-recovery:20, test-launch-phases:11, test-multi-session:6 with a local mcpClient() factory, test-fileops:13, test-asset-inspect:90, test-vfx-live:10, drill-vfx-workflow:6). Separately, test-mcp-tools.mjs is stale: EXPECTED_TOOLS (:15-32) still lists the removed project_info and omits 10 newer tools, so it always exits 1; tool enumeration is already owned by test-mcp-offline's 31-tool + no-project_info assertions. But test-mcp-tools is the only live smoke for 11 tools (the five dota_api_* queries, dota_dump_entities/modifiers, dota_entity_inspect, console_find/help/gui_filter).

## Proposal

- Add a shared helper (scripts/lib-ctrl.mjs or a new lib-mcp.mjs): spawnMcpServer({timeoutMs}) returning { call, notify, kill }, plus shared assert/sleep, spawning the real dist/index.js — boundary realism unchanged; the helper replaces only per-script plumbing, exactly as lib-ctrl already does for the control port.
- Fold the 11 live API/dump/console smokes out of test-mcp-tools.mjs into a maintained live script built on the helper; delete the EXPECTED_TOOLS enumeration (its job is owned by test-mcp-offline).
- Keep the bespoke fake Dota servers in test-relay.mjs / test-daemon.mjs untouched (they assert different invariants and are the intentional offline boundary).

## Alternatives considered

- **Delete test-mcp-tools.mjs outright.** Rejected: it is the only live coverage of 11 tools; the fold must preserve those smokes.
- **Also extract the fake-server/frame-header builders.** Rejected: speculative — each fake asserts different invariants; sharing them would weaken boundary realism.

## Acceptance criteria

- One helper serves all nine spawn sites; the 11 live smokes run from the folded script; EXPECTED_TOOLS is gone; no script imports the MCP SDK client anymore.
- All offline tests pass; the live suite (when run) passes.

## Risks

- The helper must not swallow per-script timeout/idle-exit expectations: parameterize timeoutMs and keep script-owned waits.

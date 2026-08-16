---
name: code-review
description: Use when reviewing a change (PR, branch, or work-in-progress) in the dota2-mcp repo — orients the reviewer to this repo's standards (AGENTS.md conventions, offline-first testing, the vconsole contract, the documentation standard, Agent Notes) and the review-specific checks that code alone can't show.
---

# Reviewing a dota2-mcp change

**This skill is guidance, not a complete checklist.** Review along two axes — Standards (does the code follow this repo's documented rules?) and Spec (does it match what the change was asked to do?) — and read enough surrounding code to understand the design before judging. Prioritize correctness, lifecycle, and broken required behavior over style; a short review with one substantiated blocker is better than a list of nits.

## Sources of truth

- [AGENTS.md](../../AGENTS.md): standing orders — zero hardcoding, the vconsole contract, offline-first testing, the data-flow/daemon model, and the 22-tool registry.
- [docs/AGENTS.md](../../docs/AGENTS.md): documentation placement and prose discipline.
- [prose-standard](../prose-standard/SKILL.md): required coverage and editorial judgment for comments, docs, tool descriptions, and visible strings.
- [Agent Notes](../../.agents/notes/README.md): design rationale. Treat disagreement with an Agent Note as a design discussion, not an automatic veto.
- `scripts/test-*.mjs`: the plain-node smoke suite. There is no lint/format/test framework.

## Standards checks

- **Offline-first.** Relay/protocol logic must be pinned by an offline `scripts/test-*.mjs` (fake TCP server, random port, injectable small timeouts) before any live run. A transport-layer change without a matching offline scenario is a blocker.
- **No hardcoding.** addon/map come from the running daemon's handshake or `detectDotaPath()`; no absolute paths, no fixed project names, no hardcoded launch args. `DOTA2_TEST_*` env vars override; inference failure must error and ask, not silently default.
- **vconsole contract.** Console tools (`console_*`, `dota_api_*`, `dota_run_lua`, `dota_dump_*`, `dota_launch_game`, `dota_disconnect`, `dota_restart`) gate through `requireConsole()`; `dota_status` never throws. A new console-touching tool that skips the gate is a blocker.
- **Generated code.** Edit `.ts`/`.tsx` source, never `dist/` or generated `.lua`/`.js`.
- **Tool descriptions name their console command and prerequisite.** The MCP client reads them to act; a tool whose description hides the `vconsole 未打开` prerequisite or the underlying console command is a spec gap.
- **Version.** `package.json` is the only place to bump the version; `npm run check` verifies consistency.

## Spec checks

- Does the change do what the request asked, and nothing larger? A "while I'm here" rewrite that widens blast radius without a named reason is a finding.
- Is there an Agent Note for the decision? Non-trivial behavior/architecture/contract changes need one in the same change; mechanical edits are exempt.
- Is the verification story complete? Offline smoke for transport/protocol, live matrix for the connection-lifecycle surface (gating → open vconsole → kill Dota → recover → multi-session). Live bugs are the ones offline can't catch; a change that only claims offline green on a lifecycle surface is under-verified.
- Does the prose match the shipped behavior? Tool descriptions, `AGENTS.md`, `README.md`, and skills must not contradict the new behavior (grep the old tool name / old wording for leftovers).

## Reporting findings

Report Standards and Spec side by side, with each finding tagged by surface (code, test, doc, tool description). A blocker must name the concrete rule from the sources of truth and the exact location; a nit is optional polish. State which checks you actually ran (`npm run check`, specific `scripts/test-*.mjs`) and which you did not.

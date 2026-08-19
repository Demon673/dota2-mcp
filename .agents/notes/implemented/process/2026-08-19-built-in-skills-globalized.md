# Agent Note: Built-in skills globalized

English | [中文](2026-08-19-built-in-skills-globalized.zh.md)

Status: implemented

## Problem

The repo shipped six documentation/review skills under `skills/` (`prose-standard`, `trim-cot-leakage`, `translate-docs`, `archive-agent-notes`, `code-review`, `doc-standards`), exposed to MCP clients through `dota2_skill`. The author maintains generalized versions of these skills in a global skill directory (`~/.agents/skills/`); the in-repo copies duplicated them and had drifted from the global versions.

## Decision

`prose-standard`, `trim-cot-leakage`, `translate-docs`, `archive-agent-notes`, and `code-review` are no longer built in. Their global versions are authoritative, and in-repo references to them are bare text ("the global prose-standard skill"). `doc-standards` stays built in because it is dota2-mcp-specific and has no global counterpart. `dota2-game-phases` and `dota2-runtime-dev` stay built in because `scripts/test-mcp-offline.mjs` and the stuck-phase guidance in `src/index.ts` pin them; the global `dota2-custom-game-dev` covers addon development but neither the MCP phase-advance SOP nor the runtime hot-reload model.

## Alternatives considered

- **Keep all six built in.** Rejected: it duplicates global maintenance, and the copies had already drifted — e.g. the global `translate-docs` treats both languages as equal authority while this repo's pairing contract is English-canonical.
- **Remove `doc-standards` too.** Rejected: it is the only dota2-mcp-specific documentation skill, with no global counterpart.
- **Fold the two Dota skills into the global `dota2-custom-game-dev`.** Rejected: the phase SOP and runtime model are consumed through the `dota2_skill` tool by any MCP client, and the offline smoke test pins them.

## Consequences

- `dota2_skill` exposes three skills instead of eight.
- Bare-text references to global skills exist in `docs/AGENTS.md`, `skills/doc-standards/SKILL.md`, and `.agents/notes/README.md`; the global directory is stated once in `AGENTS.md`.
- A future drift between a global skill and this repo's contracts (e.g. translation authority) is resolved by the reader, not by a built-in copy.

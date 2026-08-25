# Agent Note: Built-in skills globalized

English | [中文](2026-08-19-built-in-skills-globalized.zh.md)

Status: implemented

## Problem

The repo shipped six documentation/review skills under `skills/` (`prose-standard`, `trim-cot-leakage`, `translate-docs`, `archive-agent-notes`, `code-review`, `doc-standards`), exposed to MCP clients through `dota2_skill`. The author maintains generalized versions of these skills in a global skill directory (`~/.agents/skills/`); the in-repo copies duplicated them and had drifted from the global versions.

## Decision

`prose-standard`, `trim-cot-leakage`, `translate-docs`, `archive-agent-notes`, and `code-review` are no longer built in. Their global versions are authoritative, and in-repo references to them are bare text ("the global prose-standard skill"). `doc-standards` is not built in either (removed the same day the boundary was drawn): maintenance skills live in the maintainer's global skill directory. `skills/` ships only runtime knowledge. `dota2-game-phases` and `dota2-runtime-dev` stay built in because `scripts/test-mcp-offline.mjs` and the stuck-phase guidance in `src/index.ts` pin them; the global `dota2-custom-game-dev` covers addon development but neither the MCP phase-advance SOP nor the runtime hot-reload model.

## Alternatives considered

- **Keep all six built in.** Rejected: it duplicates global maintenance, and the copies had already drifted — e.g. the global `translate-docs` treats both languages as equal authority while this repo's pairing contract is English-canonical.
- **Remove `doc-standards` too.** Rejected at first: it is the only dota2-mcp-specific documentation skill, with no global counterpart. The boundary settled the same day into removing it anyway (see Decision).
- **Fold the two Dota skills into the global `dota2-custom-game-dev`.** Rejected: the phase SOP and runtime model are consumed through the `dota2_skill` tool by any MCP client, and the offline smoke test pins them.

## Consequences

- `dota2_skill` exposes four runtime skills: dota2-game-phases, dota2-runtime-dev, dota2-vfx, dota2-model.
- Bare-text references to global skills exist in `docs/AGENTS.md` and `.agents/notes/README.md`; the global directory is stated once in `AGENTS.md`.
- A future drift between a global skill and this repo's contracts (e.g. translation authority) is resolved by the reader, not by a built-in copy.

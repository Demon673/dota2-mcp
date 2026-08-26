# Agent Note: dota_map_error — static tstl source-line mapping tool

English | [中文](2026-08-05-dota-map-error-tool.zh.md)

Status: proposed

## Problem

When a TSTL addon throws in-game, the console reports the generated `.lua` file and line, but the developer edits `.ts`. Dota 2's VScript disables `debug.traceback`, so tstl's runtime source-map override is dead in Dota — but the mapping data is compile-time static and always present in the artifact: `__TS__SourceMapTraceBack("<file>.lua", {["42"]=120, ...})`. A pure-static `.lua:line → .ts:line` translation therefore needs no game cooperation, and this MCP holds both ends (the live console stream over 29002, and artifact-format knowledge). A client-side agent doing the same chain must copy error text, guess the artifact directory, and hand-compute the map — every link can break.

Background (adversarial review of the old three-pronged TODO, carried over from the retired roadmap spec): generic file r/w duplicates each MCP client's native capability (the shipped FileOps tools stay because the asset workflow needs addon-scoped edits); BuildTools shrank to a thin hot-reload point because build triggering runs in client bash and tsc/tstl diagnostics already localize errors; VRF parsing stays as the unique value a client cannot do (shipped in 1.6.0 as `asset_inspect`/related tools). The remaining gap this review surfaced is error-to-source mapping.

## Proposal

Add one offline MCP tool, `dota_map_error`, the translation layer between the game's error stream and the source files:

- **Input**: artifact `.lua` path (relative to the addon or absolute) + line number.
- **Output**: `.ts` file + line, plus optional source context (the surrounding lines of the mapped `.ts` file).
- **Gating model**: no vconsole/Dota dependency — pure disk read. This is the first artifact-class tool, distinct from the 17 console tools under the vconsole gate.
- **Addon resolution**: daemon handshake addon first; explicit argument or path inference when unavailable.
- **Boundaries** (three explicit cases): artifact missing → "artifact not found, build first" with the addon artifact path; tstl artifact without a mapping table (sourceMapTraceback not enabled) → hint with the tstl config snippet; non-tstl artifact (no generated-with-TypeScriptToLua header, no `__TS__SourceMapTraceBack` call) → explicit "this tool only supports tstl projects".
- **Form**: a passive query tool (form A). Post-processing `console_output` to auto-attach mappings (form B) is deferred until experience asks for it.

## Alternatives considered

- **Form B first (auto-annotate console_output).** Rejected: passive query is the smallest correct slice; auto-attachment changes the console tool's output contract and belongs to a later decision.
- **Leave mapping to the client agent.** Rejected: the chain is multi-step and fragile (copy text, locate artifacts, hand-compute); this MCP already holds the console stream and artifact knowledge.

## Acceptance criteria

- Offline tests: fake artifact files (with mapping table / without / non-tstl / missing artifact) assert parsing and each boundary error.
- One live run maps a real tstl addon's artifact and verifies the reported `.ts` line.
- Tool description states the console command independence and the three boundaries; documented in the tool tables of AGENTS.md and README (paired).

## Risks

- The mapping table format is tstl-version-dependent; the parser must read what `__TS__SourceMapTraceBack` actually emits and fail loudly on unknown shapes rather than guess.
- Non-tstl Lua projects get an explicit unsupported error — acceptable, the tool's scope is named.

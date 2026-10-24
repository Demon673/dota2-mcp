# Agent Note: Focused console and API tool results

English | [中文](2026-10-24-focused-tool-results.zh.md)

Status: implemented

## Problem

Live tool review found several ways for routine calls to return misleading results or consume excessive agent context:

- `script_help2`, `cl_panorama_script_help_2`, and `dump_panorama_events` ignore their query arguments and return full dumps. The tool layer returned all of it: one Lua function query produced 454 KB and one Panorama query produced 310 KB. Entity and modifier dumps had the same problem, and the modifier tool defaulted to the large client-side registry rather than active server modifiers.
- A thin client attaching after Dota had already sent its CHAN frames had no channel names until another CHAN frame arrived, so `console_channels` was empty.
- `dota_run_lua` sent every expression to `DeepPrintTable`, which rejects numbers, strings, booleans, and nil. Its example named a nonexistent API. `dota_api_help` advertised global functions even though `script_help` accepts scopes. `vfx_preview_stop` printed `ok=nil` because `ParticleManager:DestroyParticle` returns void.

## Decision

- `filterDumpBlocks` parses the observed engine formats: Lua entries beginning with `---[[ <symbol>`, Panorama/CSS blocks headed by `=== <name> ===`, and event rows beginning with `| <code>event(…)</code>`. Exact symbol or class-member matches win; if none exist, case-insensitive substring matches are returned. A query with no match returns a short message, never the full dump. Omitting the query intentionally retains the full dump. Event table separators are removed.
- `dota_dump_entities` and `dota_dump_modifiers` accept a case-insensitive substring `filter`. The modifier tool defaults to `side: "server"`; `side: "client"` still returns the registered-type list.
- The daemon includes the current channel list in `hello-ok`, and `RelayClient` stores that snapshot during its handshake. Later `chan` broadcasts still replace it.
- Expression evaluation stores the value, uses `DeepPrintTable` only for tables, and prints other values with a `[MCP-LUA]` prefix. Tool descriptions use `GameRules:State_Get()` as the expression example, describe `dota_api_help` as class/scope inspection, and state that server Lua execution requires `sv_cheats=1`.
- `vfx_preview_stop` reports that destruction executed without inventing a boolean return value.

## Alternatives considered

- **Substring matching for every query.** Rejected: an exact function or event query would also return similarly named entries, such as `CreateUnitByNameAsync` or `SetChildPanelsSelected`. Substring matching remains the fallback for partial names and prefixed Panorama classes.
- **Truncate the full dump to a fixed number of lines.** Rejected: the requested entry can appear anywhere, and arbitrary truncation does not guarantee a useful result.
- **Automatically enable `sv_cheats` around each Lua call and restore it afterwards.** Not shipped: `RunScriptCode` executes on a later frame, a hung game or killed client can prevent restoration, disabling cheats resets cheat cvars, and an addon may intentionally enforce `sv_cheats=0`. Development addons can permit cheats in tools mode instead.

## Consequences

Focused queries return only relevant entries, and late MCP sessions can immediately use channel names for `console_output`. The engine still transmits the full API dump to the local relay before filtering, so filtering reduces agent context rather than engine work or collection time. Partial queries can return multiple entries. The modifier default is intentionally different; callers needing the client registry must request it explicitly.

## Testing

- `scripts/test-collect-output.mjs` supplies realistic Lua, Panorama, CSS, event, entity, and modifier dumps while ignoring query arguments at the fake engine boundary. Through the real MCP server it asserts exact and class filtering, no full-dump fallback for unknown names, case-insensitive dump filters, the server modifier default, scalar expression output, and particle-stop output without `ok=`.
- `scripts/test-relay.mjs` sends a structured CHAN frame from fake Dota, attaches a real `RelayClient` after registration, and asserts that its initial channel list already contains `VScript`.
- `npm run check`, `scripts/test-relay.mjs`, and `scripts/test-collect-output.mjs` pass after the change.

Live (Dota 2 with `-tools`, map loaded): a newly attached thin client listed `VScript`. The Lua function query returned 9 lines without `CreateUnitByNameAsync`; the `GameUI` query returned its 210-line class block without `GameEvents`; the CSS and event queries returned 2 and 3 lines. Numeric and string expressions printed their values, entity and modifier filters returned matching lines, the modifier default listed 9 active server entries, and particle-stop output omitted `ok=`. A later custom glow returned a nonzero id, appeared in a screenshot, and disappeared after `vfx_preview_stop`. A manual save → enable → execute → restore `sv_cheats` experiment also passed for normal execution and a Lua error, restoring the original value in both cases; this does not change the no-automatic-toggle decision because crash or permanent hang can still prevent restoration. The experiment ran in tools mode. A separate attempt to exercise the addon's non-tools guard could not establish a VConsole listener on 29000, so that guard remains unverified.

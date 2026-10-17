# Agent Note: Repo audit fixes

English | [中文](2026-10-17-repo-audit-fixes.zh.md)

Status: implemented

## Problem

A whole-repo audit found defects that gave wrong results silently or weakened a trust boundary:

- `file_edit` passed `new_string` to `String.replace` as a string, so `$'`, `$&`, and `$1` were expanded. Replacing a line with `t = '$' + g;` wrote the rest of the file into the middle of it.
- The FileOps boundary was built from the `addon` argument without checking it. With `addon: "../../.."`, the allowed root became the parent of the Dota install.
- VConsole2 text was decoded and encoded as `ascii`. Node clears the high bit when it decodes `ascii`, so Chinese `print` output and non-ASCII Lua sent through `dota_run_lua` were mangled.
- When `status_json` got no answer, `queryStatusJson` fell back to `prntLog.slice(-0)`, which is the whole log, and parsed a stale state from minutes earlier.
- The local fallback relay listened on `:29002` with no token, so any local process could send `CMD:` (`RunScriptCode` is code execution).
- `collectOutput` collected every PRNT line in its time window, so output from other sessions sharing the daemon, and the game's own prints, landed in tool results.
- VRF failures were reported as success: `asset_inspect` summarized the error text (all zeros), and `asset_check_refs` reported `checked: 0` with nothing broken for an asset it could not open.
- Smaller defects: `dota_launch_game` sent no launch command when a different map was already loaded. A superseded vconsole socket's `close` cleared the live GUI's state. Toggling MCP suppression between the two markers left the GUI muted. `~` in the Linux/macOS Steam paths was never expanded. `prepack` did not compile.

## Decision

- `file_edit` passes `() => new_string`, so the replacement text is literal.
- `requireAddon()` in `src/index.ts` is the single addon resolver for FileOps and the asset tools. It rejects `.`, `..`, and any name containing `/`, `\`, or `:`.
- `vcon-bridge.ts` reads and writes PRNT and CMND text as UTF-8, the same encoding CHAN names already used.
- `queryStatusJson` is `extractLastStatusJson(collectOutput("status_json", …))`. It parses only output from its own command window and returns `null` when none arrives.
- The fallback relay calls `setExpectedToken(ensureToken())`, so it enforces the same handshake as the daemon.
- `collectOutput` sends `echo __mcp_<id>_begin`, the command, and `echo __mcp_<id>_end`, and keeps only the lines between the two markers. `ent_fire … RunScriptCode` runs on the next frame, after an immediate echo, so the Lua tools pass a function and have Lua print the end marker itself. `settleMs` remains the fallback when the end marker never arrives, for example when the user's Lua errors. `prntLog` drops marker lines.
- The asset tools return `ok: false` when the VRF CLI fails, or when the root asset cannot be decompiled.
- `RelayClient` drops commands sent while disconnected instead of replaying them after reconnect. `requireConsole` already blocks calls while disconnected, and a replayed `restart` is worse than a dropped one.
- `dota_launch_game` launches unless a load is in progress or the requested map is already loaded. The map comparison strips the directory and extension, because the `status_json` map format has not been checked live.
- `_onGuiConnect` destroys any previous GUI socket, and a socket's `close` handler does nothing once a newer socket has replaced it. `setMcpSuppressEnabled` resets the marker state.
- Steam detection drops `find-steam-app`, whose own comment says it throws on the current `libraryfolders.vdf` format. The default Linux/macOS roots are built with `os.homedir()`. `prepack` runs `npm run build`.

## Alternatives considered

- **Escape `$` in `new_string`** instead of using a replacer function. Rejected: the function form is the standard way to make the replacement literal and needs no escaping rules.
- **Correlate output by time alone with a shorter settle window.** Rejected: it cannot separate lines from another session that arrive within the same window.
- **A single end echo for the Lua tools too.** Rejected: `ent_fire` defers execution by a frame, so the end echo arrives before the Lua output and would cut it off.
- **Keep the reconnect replay buffer, capped at a shorter age.** Rejected: the tool layer gates on the connection already, so the buffer only ever replays commands whose moment has passed.

## Consequences

Bought: file edits are literal, FileOps cannot leave the addon through the `addon` argument, non-ASCII console text survives both directions, and tool results contain only the issuing command's output. Cost: each console tool call sends two extra `echo` commands, and the markers appear in the vconsole GUI when MCP suppression is off. If user Lua ends in a `--` line comment, the comment swallows the appended end-marker `print`, and the call falls back to `settleMs`.

## Testing

- `scripts/test-collect-output.mjs` (new, offline) runs a fake Dota that injects noise lines before `begin` and after `end`, plus a fake GUI. It asserts that `dota_api_css` returns only the in-window line, that the UTF-8 text is decoded intact, and that markers stay out of both the result and `console_output`.
- `scripts/test-fileops.mjs` asserts that `$'` and `$&` are written literally, and that the `addon` values `..`, `../..`, and `<addon>/../..` are rejected.
- `scripts/test-asset-inspect.mjs` and `scripts/test-asset-check-refs.mjs` assert the failure paths. They skip on win32, so on Windows the failure paths were checked by hand with a stand-in executable.

Not covered live: whether Dota's console actually emits and accepts UTF-8, and the format of the `status_json` map field.

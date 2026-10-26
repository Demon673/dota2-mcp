# Agent Note: SEA artifact survives import.meta and relay startup

English | [中文](2026-10-26-sea-bundle-import-meta.zh.md)

Status: implemented

## Problem

The release workflow packages a Node SEA executable from `dist/bundle.cjs` (esbuild `--format=cjs`). `src/index.ts` called `createRequire(import.meta.url)` at module scope for `getVersion()`. A CommonJS bundle has no `import.meta`, so the bundled expression was `undefined` and `createRequire(undefined)` threw `ERR_INVALID_ARG_VALUE` before the server could start. Running the freshly packaged artifact with stdin closed reproduced it (`exit=1`). The workflow only checked that release assets existed, so all three platform binaries would have been dead on arrival.

Restoring a plain `require` exposed the next failure: `createRelay()` resolved `./relay-main.js` and spawned a daemon with `process.execPath`. In SEA that path is the exe, so a spawn relaunched the MCP server instead of a daemon, and `waitForRelay` waited out its 30 s timeout. `skillsDir()` had the same shape: it resolved `../package.json`, which a standalone download does not contain. The release matrix's `SEA_OUTPUT_NAME=dota2-mcp-win` also produced an extensionless Windows file, which `CreateProcess` cannot start even when the binary itself is valid.

## Decision

- The module-scope binding is `createRequire(import.meta.url ?? __filename)`: the ESM `dist/index.js` supplies `import.meta.url`; the CJS bundle supplies `__filename` (the bundle/exe path).
- `getVersion()` no longer uses `require`. It reads `../package.json` with `fs.readFileSync(new URL(...))` inside its existing `try/catch`, so the CJS bundle returns the constant fallback that `sync-version` keeps equal to `package.json`.
- `isSeaRuntime()` asks `node:sea`'s `isSea()` through that `require` and returns false on Node < 20.12. Under SEA, `createRelay()` skips daemon resolution and spawning and falls through to the local relay; the exe still attaches as a thin client when a daemon is already reachable.
- `skillsDir()` falls back to `path.dirname(process.execPath)/skills` when `package.json` cannot be resolved. A standalone exe without a skills directory returns the existing clean "No built-in skills found" error.
- `scripts/smoke-sea-package.mjs` spawns the packaged artifact with stdin ignored (immediate EOF), a 30 s timeout and a non-zero exit on failure. The release workflow runs it after `Package` and before `Upload release asset`.
- `sea-package.mjs` and the smoke script append `.exe` on Windows when `SEA_OUTPUT_NAME` lacks it, so the matrix's `dota2-mcp-win` becomes an executable `dota2-mcp-win.exe` and the upload glob still matches.

## Verification

The original artifact exited 1 on `createRequire`. After the fix, the build-layout exe with a live daemon starts as a thin client and exits 0; with an isolated state directory and free ports (no daemon) it falls back to the local relay and exits 0; a standalone copy of the exe returns the clean missing-skills error for `dota2_skill`, while the build-layout exe returns the skill outline. `SEA_OUTPUT_NAME=dota2-mcp-win` produces `dist/dota2-mcp-win.exe`, and the smoke script finds and runs it. The full offline smoke set from the release workflow passes; `test-daemon.mjs` caught the intermediate `require` regression before the final form.

## Alternatives considered

- **Bundle as ESM.** Rejected for this fix: the SEA config's main entry is a CJS bundle, and switching formats plus re-verifying SEA on three platforms is a larger change than the crash requires.
- **Define `import.meta.url` at bundle time.** Rejected: it bakes a build-machine path into the artifact and still needs a per-platform definition.
- **Guard only `getVersion()`.** Rejected: two other `require.resolve` calls then crashed outside ESM, so the binding itself had to be dual-mode.
- **Detect SEA by executable name.** Rejected: a renamed `node` binary misdetects, and the check would silently change daemon behavior on a normal install.
- **Embed the skills directory into the SEA assets.** Deferred: a standalone exe already reports the missing directory clearly, and bundling assets is a larger packaging change.
- **Trust the workflow's asset check.** Rejected: it proves a file was uploaded, not that it runs.

## Consequences

The fallback constant is load-bearing in the SEA artifact; `sync-version` keeps it correct and `npm run check` fails when it drifts from `package.json`. The exe supports both thin-client and local-relay modes but cannot spawn a daemon, and a standalone download carries no skills directory. Every release now starts the packaged binary once per platform before uploading, which adds one short-lived process per runner.

## Testing

`scripts/smoke-sea-package.mjs` after `npm run package` — locally it reproduced the original `exit=1` and confirms `exit=0` for both relay modes after the fix. The release workflow runs it on Windows, Linux and macOS before attaching assets; the rest of the package surface stays covered by the existing offline smoke set.

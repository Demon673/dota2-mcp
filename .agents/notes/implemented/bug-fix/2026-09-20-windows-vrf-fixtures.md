# Agent Note: Windows-portable VRF test fixtures

English | [中文](2026-09-20-windows-vrf-fixtures.zh.md)

Status: implemented

## Problem

Three offline smoke scripts carried VRF fixtures built for POSIX only, so all three were red on every Windows checkout:

- `scripts/test-vrf-ensure.mjs` named its fixture asset `cli-linux-x64.zip` and its archive member `Source2Viewer-CLI`, while `vrf-ensure.ts` derives both from `process.platform` (`cli-windows-x64.zip`, `Source2Viewer-CLI.exe`). The first assertion failed with `No asset cli-windows-x64.zip in release v9.9.9. Available: cli-linux-x64.zip`.
- `scripts/test-asset-inspect.mjs` and `scripts/test-asset-check-refs.mjs` pre-seeded the cache with a `Source2Viewer-CLI` script, so `ensureVrf`'s cache-hit check — which probes for `EXE_BASE` — missed and fell through to a real download.

The first failure was a fixture name; the other two cannot be repaired by naming. Windows will not execute a fake CLI: an extensionless Node script fails with `ENOENT`, a text file named `.exe` is not a valid PE image (`UNKNOWN`), and `execFileSync` refuses `.cmd`/`.bat` without a shell (`EINVAL`). Both scripts call `execFileSync(vrf.executable, …)`, so no fixture can stand in for the real binary.

`.github/workflows/release.yml` builds on a windows/ubuntu/macos matrix but runs no smoke script, so nothing surfaced the divergence.

## Decision

`test-vrf-ensure.mjs` builds a platform-neutral fixture: the archive carries both executable names and the fake release offers all nine `cli-{windows,linux,macos}-{x64,arm64,arm}.zip` names. The script never executes the CLI — it asserts download, sha256 verification, extraction and cache hits — so it now passes on every platform.

`test-asset-inspect.mjs` and `test-asset-check-refs.mjs` exit 0 with a `[test] SKIP` line on win32, naming the reason and pointing at `EXE_BASE`.

## Alternatives considered

- **Inject a CLI command prefix (e.g. `VRF_CLI_CMD`) so the fake runs everywhere.** Rejected: a product change that adds an environment variable to the shipped surface, made only to run a test on a platform where CI never runs it.
- **Mirror `platformAssetName()` in the test and serve only the local platform's asset.** Rejected: it duplicates the mapping, and the test's subject is download/verify/extract, not naming.
- **Leave the two tests red on Windows.** Rejected: a test that is expected to be red teaches the reader to ignore red.

## Consequences

Windows checkouts get one real pass and two explicit skips instead of three failures. `asset_inspect` and `asset_check_refs` have no offline coverage on Windows; their POSIX coverage is unchanged.

## Testing

`node scripts/test-vrf-ensure.mjs` passes all eight assertions on win32. `test-asset-inspect.mjs` and `test-asset-check-refs.mjs` print SKIP and exit 0.

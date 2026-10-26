# Agent Note: Offline smoke suite runs in the release workflow

English | [中文](2026-09-20-offline-smoke-in-release-workflow.zh.md)

Status: implemented

## Problem

`.github/workflows/release.yml` was the repo's only workflow. It builds, packages and uploads on `release: created` (or manual dispatch). It ran no smoke script, and no workflow ran on push, so the offline suite had exactly one execution path: a person running it by hand. The Windows fixture breakage repaired earlier in this change set went unnoticed for that reason.

## Decision

The release workflow gains an `Offline smoke tests` step between Build and Package, running the offline smoke scripts. Each is named explicitly rather than by a `test-*.mjs` glob: the live scripts (they need Dota 2 and a vconsole window) would make every release run red if a glob swept them in. The scripts import from `dist/`, so the step sits after Build. On the ubuntu and macos matrix legs `test-asset-inspect` and `test-asset-check-refs` run for real; on windows they print SKIP.

Live and drill scripts stay manual. Pre-commit stays fast and local — this is an additional gate, not a replacement (see the [doc-gates note](2026-08-29-root-docs-pairing-and-doc-gates.md), whose rejected "CI-only gates" alternative is not reversed here).

## Alternatives considered

- **A workflow on push or pull request.** Rejected for now: the suite takes about 70 s on a developer machine (test-daemon 32 s, test-fileops 13 s, test-mcp-offline 13 s, test-relay 10 s), and the release gate already turns red before a bad artifact ships. Revisit if the repo gains outside contributors.
- **A `test-*.mjs` glob instead of explicit names.** Rejected: it would pull in the live scripts and fail every run.
- **Replace the local pre-commit checkpoints with CI.** Rejected when the doc gates landed and still rejected: local checkpoints fail seconds after the edit, not minutes later.

## Consequences

A broken offline test now blocks a release instead of passing silently. Live coverage is unchanged — nothing in CI touches Dota 2. The suite adds about a minute to each matrix leg.

## Testing

The step is a list of `node` invocations of scripts that carry their own assertions; on a Windows checkout the two asset scripts print SKIP instead of running, and on ubuntu/macos they execute. The first release run was the first real exercise and exposed three POSIX gaps, now fixed: test-asset-inspect needs the `STEAM_PATH` fake Steam library on a runner without Dota; the generated fake VRF in test-asset-check-refs needed an escaped newline and a missing-input failure path; and the vtex VRF call now runs in its temporary output directory like the text path.

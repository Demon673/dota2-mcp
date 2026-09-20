# Agent Note: VRF version patrol — one source of truth for the pin

English | [中文](2026-09-20-vrf-version-patrol.zh.md)

Status: implemented

## Problem

The pinned VRF release was written in four places: the `DEFAULT_VERSION` constant and its option comment in `vrf-ensure.ts`, plus two `src/index.ts` tool descriptions spelling out "default v20.0" and "Default 20.0". A bump was a four-place manual edit, and nothing noticed when upstream moved. At the time of writing the pin was already the latest release, 20.0.

## Decision

`DEFAULT_VERSION` is the single source: `vrf-ensure.ts` exports it and `src/index.ts` interpolates it into both descriptions, so the string exists once.

`scripts/check-vrf-version.mjs` (`npm run check-vrf-version`) reads that one line, compares it against the upstream latest release, and reports. `--write` moves the pin, and refuses when the target release drops a `cli-*.zip` asset the current pin ships — the code matches assets dynamically, so a missing one is a download 404 for that platform. Exit codes: 0 in sync or written, 1 behind, 2 undeterminable or refused. `--version <v>` bypasses the network for offline self-test.

AGENTS.md documents the command, and the doc budget ceiling moves 4000 → 4050: the new line costs 18 words, and 3998/4000 left no room for any single-line addition.

## Alternatives considered

- **Resolve `/releases/latest` at runtime instead of pinning.** Rejected when the tool shipped and still rejected (see the [vrf-ensure note](../feature/2026-08-20-vrf-ensure.md)): VRF's CLI interface is explicitly unstable, pinning keeps flags predictable, and `VRF_VERSION` is the upgrade path. A patrol script keeps the pin while making it cheap to move.
- **A scheduled CI job.** Rejected: releases land every 1–3 months and being a version behind costs nothing until a need appears, so the real trigger is user-initiated; the job would also need the network and issue automation, adding a failure surface unrelated to the code.
- **Have the script rewrite all four occurrences.** Rejected: the occurrences were duplication, so removing the duplication makes the write a single line instead of a four-pattern rewrite.

## Consequences

Bumping the pin is one command and one line. Nothing runs automatically: the pin stays a deliberate choice, and the check runs when someone touches the asset tooling. The ceiling now carries roughly one line of headroom, so the next single-line addition needs no raise.

## Testing

`npm run check-vrf-version` reports in sync at 20.0 (exit 0). `--version 19.2` reports behind (exit 1). `--version 14.1 --write` is refused (exit 2) because 14.1 lacks `cli-windows-arm64.zip`, which 20.0 ships. `--version 19.2 --write` followed by `--version 20.0 --write` round-trips the pin with no residue in the diff.

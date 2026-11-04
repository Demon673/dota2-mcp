# Agent Note: Rebuild release assets from their published tag

English | [中文](2026-11-05-release-tag-rebuilds.zh.md)

Status: implemented

## Problem

A hosted runner can exhaust its capacity before a release build starts. Recovering that platform requires rebuilding the published source, while a manual workflow normally checks out the branch that contains its definition.

## Decision

Manual dispatch requires a published version tag. Checkout and asset upload use that tag; the workflow checks that it matches the package version and an existing GitHub Release before installing dependencies. Release events use their own tag. The existing build, offline smoke suite and executable startup check run before upload.

The macOS job uses the supported `macos-15` ARM64 image, giving recovery an alternative to the `macos-latest` image queue.

After the tagged source is built, the daemon and Lua-runner smoke fixtures are refreshed from the workflow definition's commit. These verification-only files are excluded from the package. The daemon smoke preserves failed exit codes, reads the latest suppression snapshot and uses a dead lock owner; the Lua budget fixture includes a spare hanging test so a timer returning 1ms early cannot consume every declaration. The offline step uses Bash's fail-fast behavior on all platforms.

## Alternatives considered

**Retry only `macos-latest`.** Repeated acquisition failures justify trying another supported image. Both queues can still be affected by ARM capacity constraints.

**Move the published tag.** Consumers already use that source identity; rebuilding targets the existing tag instead.

**Use an Intel runner.** That changes the native architecture of the macOS executable.

## Consequences

The workflow definition can be repaired independently of the source version being rebuilt. Manual dispatch rebuilds all three platforms and uploads missing assets to the selected release; existing assets are preserved. Package changes require another version. The macOS image remains pinned until its support or build requirements change.

The packaged code and build inputs come from the published tag; the two smoke fixtures follow the workflow commit. Their compatibility with an older release is verified by that release's CI run.

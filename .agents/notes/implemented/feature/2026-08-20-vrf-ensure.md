# Agent Note: vrf_ensure half-integration

English | [中文](2026-08-20-vrf-ensure.zh.md)

Status: implemented

## Problem

asset_inspect and asset_check_refs (wayfinder map #4) need the ValveResourceFormat CLI (Source2Viewer-CLI), a third-party .NET tool that is not part of Dota 2. The chosen strategy is half-integration (map #6/#7): detect an existing install, otherwise download the pinned release with the user's consent via the tool call itself.

## Decision

`ensureVrf()` in `src/tools/vrf-ensure.ts` implements the half-integration contract. Version pin `20.0` (env `VRF_VERSION` overrides); cache dir `os.tmpdir()/dota2-mcp/vrf/` (env `VRF_CACHE_DIR` overrides); the release is looked up on the GitHub Releases API (`GET /repos/ValveResourceFormat/ValveResourceFormat/releases/tags/{version}`) and the platform asset is matched **dynamically** against the release's `assets[]` as `cli-{os}-{arch}.zip` — never a hardcoded map, since the published set shifts between releases. The download is verified against the asset's sha256 `digest`; a mismatch rejects the download and caches nothing. Extraction uses `adm-zip` (pure-JS; the repo keeps its no-external-binary rule — the release archives are `zip -9j` flat layouts with the executable at the root, so the extracted `Source2Viewer-CLI` is chmod +x'd on non-win32). The `vrf_ensure` MCP tool exposes it, and asset_inspect/asset_check_refs call it lazily.

## Alternatives considered

- **Bundle VRF in the npm package.** Rejected: .NET self-contained binaries per platform would bloat the package and break the pure-Node distribution story (map #6 decision).
- **Download latest instead of pinning.** Rejected: the CLI interface is explicitly unstable (VRF's own docs); a pinned version keeps flags predictable, and `VRF_VERSION` gives an upgrade path.
- **Hardcoded platform→asset map.** Rejected: the asset set changes across releases (research #6); matching `assets[]` by name is robust to that.

## Consequences

- `scripts/test-vrf-ensure.mjs` pins the offline contract with a fake Release API + real zip fixtures: fresh download, cache hit, sha256 tamper rejection, missing platform asset, unknown version.
- First download is ~50 MB and happens inside a tool call (the consent surface); subsequent calls are cache hits.
- Tool count 26 → 27.

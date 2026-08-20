# VRF CLI (Source2Viewer-CLI) — acquisition and runtime requirements

Research for [dota2-mcp #6](https://github.com/Demon673/dota2-mcp/issues/6): the release shape of the Source2Viewer command-line tool. Feeds the "half-integration" auto-download design (detect platform, ask for consent, then download).

## TL;DR

| Question | Answer |
| --- | --- |
| Distribution channel | GitHub Releases on [ValveResourceFormat/ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat/releases) |
| Latest version | `20.0` (tag `20.0`, released 2026-08-17, not a prerelease) |
| CLI asset name pattern | `cli-{os}-{arch}.zip` |
| Supported platforms | Windows (x64, arm64), Linux (x64, arm64, arm), macOS (x64, arm64) |
| .NET runtime required? | No — the CLI is published self-contained (runtime bundled) |
| Binary name | `Source2Viewer-CLI` (`.exe` on Windows) |
| CLI zip size | ~48–57 MB per platform (v20.0) |

## Distribution and asset naming

Releases are published as GitHub Releases on [ValveResourceFormat/ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat/releases). Release `20.0` ([tag page](https://github.com/ValveResourceFormat/ValveResourceFormat/releases/tag/20.0)) carries these assets, returned verbatim by the [Releases API](https://api.github.com/repos/ValveResourceFormat/ValveResourceFormat/releases/latest):

- `cli-linux-arm.zip` (50 MB)
- `cli-linux-arm64.zip` (49 MB)
- `cli-linux-x64.zip` (53 MB)
- `cli-macos-arm64.zip` (54 MB)
- `cli-macos-x64.zip` (57 MB)
- `cli-windows-arm64.zip` (50 MB)
- `cli-windows-x64.zip` (53 MB)
- `Source2Viewer.exe` (105 MB) — the Windows GUI, not the CLI
- `ValveResourceFormat.nupkg`, `ValveResourceFormat.Renderer.nupkg` — NuGet library packages

The CLI asset name is `cli-{os}-{arch}.zip` with `os ∈ {linux, macos, windows}` and `arch ∈ {x64, arm64, arm}`. The asset set is not frozen across releases: this `cli-*` naming has held since `11.0` (Dec 2024); before that the zips were named `Decompiler-*` ([releases list](https://github.com/ValveResourceFormat/ValveResourceFormat/releases)), and a Windows arm64 build only appeared in `15.0`. Derive the available platforms from the release's asset list rather than hardcoding the map.

### Download URL patterns

Two equivalent URL shapes ([GitHub docs](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)):

- Versioned: `https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/{tag}/{asset}`, e.g. <https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/20.0/cli-windows-x64.zip>
- Latest: `https://github.com/ValveResourceFormat/ValveResourceFormat/releases/latest/download/{asset}`, e.g. <https://github.com/ValveResourceFormat/ValveResourceFormat/releases/latest/download/cli-windows-x64.zip> — verified to return HTTP 200 and redirect to the versioned asset.

## Supported platforms

The `20.0` tag publishes seven CLI variants ([build workflow](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/20.0/.github/workflows/build.yml)):

| OS | Architectures |
| --- | --- |
| Windows | `win-x64`, `win-arm64` |
| Linux | `linux-x64`, `linux-arm64`, `linux-arm` (32-bit) |
| macOS | `osx-x64`, `osx-arm64` (Apple Silicon) |

## .NET runtime requirement

No separate .NET runtime is required. The CLI is built with `dotnet publish --configuration Release --self-contained --runtime <rid>` for every target ([build workflow](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/20.0/.github/workflows/build.yml)), so the runtime ships inside the archive.

- Target framework `net10.0` with `<RollForward>LatestMajor</RollForward>` ([CLI/CLI.csproj](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/20.0/CLI/CLI.csproj)).
- Release builds are single-file (`<PublishSingleFile>true</PublishSingleFile>`, same csproj); the release script flattens the publish folder with `zip -9j`, so the executable sits at the archive root.
- ReadyToRun is enabled on tag builds (`PublishReadyToRun`, workflow `PUBLISH_ARGS`).

## Binary and invocation

The assembly/binary name is `Source2Viewer-CLI` ([csproj `<AssemblyName>`](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/20.0/CLI/CLI.csproj)); the release script `chmod +x` the Linux/macOS `Source2Viewer-CLI` executable ([build workflow](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/20.0/.github/workflows/build.yml)). On Windows it is `Source2Viewer-CLI.exe`.

CLI flags are documented in [docs/guides/command-line.md](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/docs/guides/command-line.md). `-i/--input`, `-d/--vpk_decompile`, and `--game` are the flags the existing `dota_compile_asset` tool relies on. The guide explicitly warns: "We do not guarantee stability of the CLI interface" — pin a version and re-verify flags on upgrade.

## Version detection (for the auto-download design)

- Authoritative endpoint: `GET https://api.github.com/repos/ValveResourceFormat/ValveResourceFormat/releases/latest` returns `tag_name` (`20.0`), `prerelease: false`, `draft: false`, and an `assets[]` array with `name`, `browser_download_url`, `size`, and a SHA-256 `digest` per asset.
- `/releases/latest` resolves to the newest non-draft, non-prerelease release, so it is the correct "what is current" check for a downloader.
- Map the local platform/arch to an asset by matching `cli-{os}-{arch}.zip` against `assets[].name`; the SHA-256 `digest` lets the downloader verify integrity.

## Caveats

- The published runtime set shifts between releases. The `20.0` tag builds seven CLI variants, while the [current `master` workflow](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/.github/workflows/build.yml) only publishes five (it drops `linux-arm` and `osx-x64`). Always read the release's asset list.
- The CLI interface is not guaranteed stable ([command-line guide](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/docs/guides/command-line.md)).
- `Source2Viewer.exe` in the same release is the Windows GUI, not the CLI — do not download it for headless use.

## Sources

- [ValveResourceFormat Releases](https://github.com/ValveResourceFormat/ValveResourceFormat/releases)
- [Releases API (latest)](https://api.github.com/repos/ValveResourceFormat/ValveResourceFormat/releases/latest)
- [Release 20.0 tag page](https://github.com/ValveResourceFormat/ValveResourceFormat/releases/tag/20.0)
- [build.yml @ 20.0](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/20.0/.github/workflows/build.yml)
- [build.yml @ master](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/.github/workflows/build.yml)
- [CLI/CLI.csproj @ 20.0](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/20.0/CLI/CLI.csproj)
- [Directory.Build.props @ master](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/Directory.Build.props)
- [docs/guides/command-line.md](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/docs/guides/command-line.md)
- [GitHub: linking to releases](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)

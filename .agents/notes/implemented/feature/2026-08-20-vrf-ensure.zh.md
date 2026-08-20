# Agent Note: vrf_ensure 半集成

[English](2026-08-20-vrf-ensure.md) | 中文

Status: implemented

## Problem

asset_inspect 与 asset_check_refs（wayfinder 地图 #4）需要 ValveResourceFormat CLI（Source2Viewer-CLI）——一个不属于 Dota 2 的第三方 .NET 工具。选定策略是半集成（地图 #6/#7）：检测已有安装，缺失时通过工具调用本身（即用户同意）下载 pin 版本。

## Decision

`src/tools/vrf-ensure.ts` 的 `ensureVrf()` 实现半集成契约。版本 pin `20.0`（env `VRF_VERSION` 覆盖）；缓存目录 `os.tmpdir()/dota2-mcp/vrf/`（env `VRF_CACHE_DIR` 覆盖）；在 GitHub Releases API 查 release（`GET /repos/ValveResourceFormat/ValveResourceFormat/releases/tags/{version}`），按 release 的 `assets[]` **动态匹配**本机平台资产 `cli-{os}-{arch}.zip`——绝不硬编码映射，因为发布的资产集会随版本变化。下载按资产的 sha256 `digest` 校验；不匹配则拒绝下载、不缓存任何东西。解压用 `adm-zip`（纯 JS；本仓保持无外部二进制规则——release 归档是 `zip -9j` 扁平布局、可执行文件在根，解压出的 `Source2Viewer-CLI` 在非 win32 上 chmod +x）。`vrf_ensure` MCP 工具暴露它，asset_inspect/asset_check_refs 惰性调用。

## Alternatives considered

- **把 VRF 打进 npm 包。** 否决：各平台 .NET 自包含二进制会让包体膨胀，破坏纯 Node 分发叙事（地图 #6 决议）。
- **下载 latest 而非 pin。** 否决：CLI 接口明确不稳定（VRF 官方文档）；pin 版本让 flags 可预测，`VRF_VERSION` 提供升级路径。
- **硬编码平台→资产映射。** 否决：资产集跨 release 变化（研究 #6）；按 `assets[]` 名称匹配对此健壮。

## Consequences

- `scripts/test-vrf-ensure.mjs` 用 fake Release API + 真 zip fixture 钉住离线契约：首次下载、缓存命中、sha256 篡改拒绝、缺平台资产、未知版本。
- 首次下载约 50 MB、发生在工具调用内（同意面）；后续调用为缓存命中。
- 工具数 26 → 27。

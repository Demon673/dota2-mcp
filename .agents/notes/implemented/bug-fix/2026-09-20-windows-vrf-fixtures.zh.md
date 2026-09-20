# Agent Note: VRF 测试 fixture 的 Windows 可移植性

[English](2026-09-20-windows-vrf-fixtures.md) | 中文

Status: implemented

## Problem

三个离线冒烟脚本带的 VRF fixture 只按 POSIX 搭，因此在每个 Windows 检出上都是红的：

- `scripts/test-vrf-ensure.mjs` 把 fixture 资产命名为 `cli-linux-x64.zip`、归档成员命名为 `Source2Viewer-CLI`，而 `vrf-ensure.ts` 两者都按 `process.platform` 推导（`cli-windows-x64.zip`、`Source2Viewer-CLI.exe`）。第一条断言就挂在 `No asset cli-windows-x64.zip in release v9.9.9. Available: cli-linux-x64.zip`。
- `scripts/test-asset-inspect.mjs` 与 `scripts/test-asset-check-refs.mjs` 往缓存里预埋一个 `Source2Viewer-CLI` 脚本，而 `ensureVrf` 的缓存命中检查探的是 `EXE_BASE`，于是落空并转去真下载。

第一处是 fixture 命名问题；后两处改名救不了。Windows 执行不了伪造的 CLI：无扩展名的 Node 脚本报 `ENOENT`，命名为 `.exe` 的文本文件不是合法 PE（`UNKNOWN`），`execFileSync` 不给 shell 就跑不了 `.cmd`/`.bat`（`EINVAL`）。两个脚本都是 `execFileSync(vrf.executable, …)` 直接执行，所以没有任何 fixture 能顶替真二进制。

`.github/workflows/release.yml` 的矩阵含 windows/ubuntu/macos，但一个冒烟脚本都不跑，所以这个断裂没有任何信号。

## Decision

`test-vrf-ensure.mjs` 改搭平台中立的 fixture：归档里两个可执行名都放，假 release 提供全部九个 `cli-{windows,linux,macos}-{x64,arm64,arm}.zip` 名。该脚本从不执行 CLI——它断言的是下载、sha256 校验、解压与缓存命中——因此现在各平台都过。

`test-asset-inspect.mjs` 与 `test-asset-check-refs.mjs` 在 win32 上打印一行 `[test] SKIP` 后 exit 0，写明原因并指向 `EXE_BASE`。

## Alternatives considered

- **注入一个 CLI 命令前缀（如 `VRF_CLI_CMD`）让伪造 CLI 到处能跑。** 否决：为让一个测试在 CI 根本不跑它的平台上运行而改产品代码，还给发布面添一个环境变量。
- **在测试里镜像 `platformAssetName()`，只提供本平台资产名。** 否决：重复那份映射，而测试的对象是下载/校验/解压，不是命名。
- **让这两个测试在 Windows 上继续红。** 否决：一个被预期为红的测试，会训练读者忽略红色。

## Consequences

Windows 检出从三个失败变成一真过、两显式跳过。`asset_inspect` 与 `asset_check_refs` 在 Windows 上没有离线覆盖；POSIX 上的覆盖不变。

## Testing

`node scripts/test-vrf-ensure.mjs` 在 win32 上八条断言全过（此前第一条就挂）。`test-asset-inspect.mjs` 与 `test-asset-check-refs.mjs` 打印 SKIP 并 exit 0。

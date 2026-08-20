# Agent Note: 特效工作流演练暴露的 WSL 兼容修复

[English](2026-08-20-wsl-compat-fixes.md) | 中文

Status: implemented

## Problem

特效工作流端到端演练（写 → 编译 → 检查 → 预览 → 迭代）在 WSL 上暴露四个真实缺陷：工具二进制解析到不存在的 linuxsteamrt64 目录、WSL 路径传给 Windows 工具、VRF CLI 调用方式错误（stdout 是分析摘要而非反编译文本；且无 libicu 时 .NET 需要 invariant 全球化）、守护进程空闲退出守卫看不到 dota2 进程（pgrep 看不到 Windows 进程）。

## Decision

1. `getDotaBinDir` 按目录存在性探测候选（linuxsteamrt64 → win64 → osx64）而非信任 process.platform；`resolveDotaToolPath` 命中 win64 目录时追加 `.exe`。2. `toWindowsPath` 把 `/mnt/<盘>/...` 映射为 `<盘>:\...`；`runDotaTool` 在 WSL 下调用 Windows 工具时转换路径参数。3. asset_inspect/asset_check_refs 用 `-o <文件>` 调 VRF CLI（并读文件）+ `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`；vtex 保持 `-o <png>`。4. `isProcessRunning` 在 pgrep 无果时经 `tasklist.exe` interop 兜底（WSL 经 interop 可见 Windows 进程）。

## Alternatives considered

- **在 WSL 装 libicu。** 否决：env 开关零安装、任何最小容器可用。
- **保留按平台选目录。** 否决：存在性探测匹配实际安装，一次修好所有 WSL 用户。

## Consequences

- 演练（scripts/drill-vfx-workflow.mjs）端到端通过：引擎日志确认按需重编译了写出的粒子、vfx_preview 返回 pid=2、stop 销毁成功。
- 记录两个环境残留风险：跨会话残留的 daemon（端口冲突时杀 node/relay 进程并清状态目录）；daemon 存活期间删除 relay.token 会破坏握手，直到该 daemon 退出。

# Agent Note: FileOps 工具与 WSL 路径检测

[English](2026-08-20-fileops-tools.md) | 中文

Status: implemented

## Problem

MCP 客户端无法创建或编辑 addon 源文件（`.vpcf` 粒子源、KV、Lua、Panorama）——这是特效/模型工作流（wayfinder 地图 #4）的第一步。同时 `detectDotaPath()` 返回 Windows 风格路径，WSL 文件系统无法打开，导致所有触碰文件系统的工具在 WSL 下不可用。

## Decision

在 `src/index.ts` 注册四个离线 FileOps 工具：`file_read`、`file_write`、`file_edit`（old_string/new_string、恰好一次匹配、否则响亮失败）、`file_delete`（快照前 500 字符）。路径解析：`content/` 或 `game/` 前缀 → 相对 Dota 2 安装目录；否则 → `content/dota_addons/{addon}/...`。解析结果必须落在 `content/dota_addons/{addon}/` 或 `game/dota_addons/{addon}/` 内（规范化前缀检查拒绝 `../` 逃逸与其他 addon）。addon 解析：显式参数 → relay 握手 → `DOTA2_TEST_ADDON` env → 文件系统唯一推断。读取上限 5 MB。

`detectDotaPath()`（src/tools/console-bridge.ts）新增 `toHostPath()`：非 win32 平台把 Windows 盘符路径映射到 `/mnt/<drive>/...` 挂载。注册表查询现在经 WSL interop 执行（纯 Linux 上自然跳过），SteamPath 正则支持含空格路径，默认 Steam 位置在所有平台探测（未挂载的 /mnt 探测静默失败）。

## Alternatives considered

- **专用格式写入器（只做 vpcf 的工具）。** 否决：vpcf 是 KV 文本；通用 FileOps + dota2-vfx skill（地图 #9）覆盖所有格式，引擎报格式错误优于手写校验器。
- **只用 STEAM_PATH env 修 WSL。** 否决：env 方案只修维护者自己的机器；检测器内路径映射修好每个 WSL 用户。

## Consequences

- 工具数 22 → 26；`scripts/test-mcp-offline.mjs` 断言 26。
- `scripts/test-fileops.mjs` 钉住离线契约：写/读/编辑/删除往返 + 三种边界拒绝（其他 addon、`../` 逃逸、dota 游戏目录）。
- junction 布局（`game/dota_addons/{addon}` → 仓库）对工具透明：按 Dota 安装目录下的逻辑路径解析，junction 自动跟随。

# dota2-mcp

[English](README.md) | 中文

让 AI 助手直接连接你的 Dota 2 客户端，辅助自定义游戏开发。

`dota2-mcp` 是一个基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 的服务器。接入支持 MCP 的 AI 客户端（如 Claude Code、Cursor 等）后，AI 就能在 Dota 2 运行时：

- 读取并发送控制台命令
- 查询 Lua / Panorama JS / CSS / 事件 API
- 启动、重载、断开自定义游戏地图
- 查看当前场景中的实体、修饰器、实体脚本
- 检视并操作 Panorama UI，包括真实的鼠标/键盘输入
- 截图、录制视频并采集帧时间
- 运行游戏内断言测试
- 编译、检查并校验 Source 2 资源

无需手动复制粘贴控制台输出，AI 可以直接从游戏里拿到实时信息。

## 前置条件

- Node.js ≥ 18（自带 npx）
- Dota 2 已安装，并以 `-vconsole` 或 `-tools` 启动

> **vconsole 不开，relay 就不连 Dota**——控制台类工具不可用，所以窗口请保持开着。

## 配置 vconsole2 GUI 端口

Dota 2 默认只允许一个 VConsole2 客户端连接 `127.0.0.1:29000`。`dota2-mcp` 已经占用了这个端口，并把 GUI 转发到 `127.0.0.1:29001`，所以需要手动把 vconsole2 切过去。

**怎么打开 vconsole2**：**默认不用管**——relay 探测到 Dota 就绪后会自动帮你打开（设 `DOTA2_VCON_AUTO_OPEN_VCONSOLE=0` 可关闭）。Dota 2 工具模式（AssetBrowser）里的 vconsole 按钮只在 relay 占用 `29000` 期间（即 vconsole 已连接时）被引擎禁用；窗口关闭后按钮恢复可用。也可直接运行 `{dota 2 beta}\game\bin\win64\vconsole2.exe`，或让 AI 调用 `dota_open_vconsole`。晚打开的窗口会自动补齐初始化数据，随开随用。

### 首次设置

1. 打开 vconsole2，在顶部工具栏下方第一排找到连接/设备选择区域。
2. 选择 **Add a new device to connect.**（添加一个新的连接设备），设置端口为 `29001`，创建成功后会多一个端口页签，标题会显示为 `Localhost:29001`，然后打开连接（**Devices → Connect**）。
3. 选中默认的 `Localhost`（即 `29000`），断开连接（**Devices → Disconnect**）。

完成这一步后，vconsole2 就能正常显示 Dota 2 控制台了。

### 设置自动连接（可选）

不想每次手动切换端口，可以设置开机自动连 `29001`：

1. 选中 `Localhost:29001`，点击菜单栏 **Devices → Properties**，开启 **Auto connect at startup**。
2. 再切换回默认的 `Localhost`（`29000`），同样在 **Devices → Properties** 里关闭 **Auto connect at startup**。

这样下次启动 vconsole2 时会自动连接 `29001`，不会再尝试占用 `29000`。

如果想脱离 MCP 单独使用 vconsole2（直连 `29000`）：关闭 Dota 2 并退出所有 MCP 会话，守护进程空闲约 5 分钟自动退出并释放 `29000`（Dota 2 在运行时守护进程不会退出，也可手动结束它）。平时把 GUI 连在 `29001` 上即可与 MCP 同时使用，无需断开。

## 安装与配置

**安装方式：npx（唯一推荐）**。零安装，每次客户端启动自动使用最新版本（首次会下载一次包，之后走本地缓存；网络不可用时自动回退到缓存版本）。

### 通用配置

所有支持 MCP 的客户端都是同一份配置，把它放进对应客户端的 `mcpServers` 里：

```json
"dota2": {
  "command": "npx",
  "args": ["-y", "dota2-mcp"]
}
```

### 各客户端配置方法

安装分两条路径，按你的习惯选一条：

- **让 AI 装（推荐）**：把本 README（或上面的「通用配置」）发给你常用的 AI 助手，告诉它「安装 dota2-mcp 到我的客户端」。AI 会读本节指引，自己执行安装命令（如 `claude mcp add ...`）或写入对应配置文件。本工具面向 AI，这条路径最顺，也不用自己看下文。
- **人类手动装**：按下方对应客户端的小节自己操作——有「方式一」的是运行一条命令，没有的（或方式二）是编辑配置文件。

**Claude Code**

- 命令行运行 `claude mcp add dota2 -- npx -y dota2-mcp`；完整配置与验证见 [Claude Code MCP 官方文档](https://docs.anthropic.com/en/docs/claude-code/mcp)

**Claude Desktop**

- 在 `mcpServers` 中加入通用配置后重启；完整步骤见 [Claude Desktop 官方 MCP 文档](https://modelcontextprotocol.io/quickstart/user)

**Cursor**

- Settings → MCP → Add new MCP server；或编辑 `~/.cursor/mcp.json`，加入通用配置

**VS Code（GitHub Copilot）**

- 用户 `settings.json` 或工作区 `.vscode/mcp.json`，写入：
  ```json
  {
    "mcp": {
      "servers": {
        "dota2": { "command": "npx", "args": ["-y", "dota2-mcp"] }
      }
    }
  }
  ```

**Cline（VS Code 扩展）**

- Cline 面板 → MCP Servers → Configure MCP Servers，在打开的 `cline_mcp_settings.json` 的 `mcpServers` 中加入通用配置

**Codex CLI**

- 方式一（推荐）：命令行运行 `codex mcp add dota2 -- npx -y dota2-mcp`
- 方式二：编辑 `~/.codex/config.toml`（TOML 格式）：
  ```toml
  [mcp_servers.dota2]
  command = "npx"
  args = ["-y", "dota2-mcp"]
  ```
- 验证：`codex mcp list`，dota2 出现在列表且 enabled 为 true；或新开 Codex 会话后直接让 AI 调用 `dota_status`

**Codex 桌面端（Desktop App）**

- 桌面端与 CLI **共享同一份 `~/.codex/config.toml`**，不需要单独的配置入口——按上方 Codex CLI 的「方式二」把 TOML 写入即可
- 写入后**完全退出并重启桌面端**（配置在启动时加载，不重启不生效），然后新开会话让 AI 调用 `dota_status` 验证
- 桌面端没有 MCP 管理界面；装了 CLI 时也可用 `codex mcp list` 确认配置已生效

**其他 MCP 客户端**

- 找到 MCP / mcpServers 配置入口，粘贴通用配置即可。

### 启动后验证

1. 客户端里 dota2 显示 connected；
2. 启动 Dota 2（`-vconsole` 或 `-tools`）；
3. 让 AI 调用 `dota_status`：vconsole 会被自动打开（或已打开），返回项目状态与下一步指引。

### 连接问题排查

| 现象 | 处理 |
|------|------|
| 客户端启动超时 / 连接失败 | 首次拉包慢：args 改为 `["--prefer-offline", "-y", "dota2-mcp"]`（缓存优先，仍会自动更新，新版本可能晚一个缓存周期）；Codex TOML 可另加 `startup_timeout_sec = 120` |
| Windows 报「找不到命令 / not recognized」 | 用 cmd 包装：JSON 客户端 `"command": "cmd", "args": ["/c", "npx", "-y", "dota2-mcp"]`；Codex TOML 则 `command = "cmd"`、`args = ["/c", "npx", "-y", "dota2-mcp"]` |
| 工具报「未连接到 Dota 2」 | 启动 Dota 2（`-vconsole` 或 `-tools`） |
| 工具报「vconsole 未打开」 | 正常会被自动打开；没有则见下方「常见问题」 |

> 独立可执行文件（win/linux/mac）仍随每个 Release 提供，仅面向不便使用 Node 的特殊场景；日常一律用 npx。

## 可用工具

| 工具 | 用途 |
|------|------|
| `dota_status` | 获取连接、vconsole、addon、地图、游戏状态与下一步建议。建议先调用。 |
| `dota_screenshot` | 在后台截取 Dota 2 游戏窗口画面（不需要控制台；仅 Windows）。旧缓存帧会带 `stale` 和 `captured_at`，因此游戏卡死后仍可能取得此前画面。helper 就绪后，每次调用共享 5 秒总超时；冷编译单独计算。 |
| `dota_record` | 把游戏窗口录制为 MP4（窗口被遮挡或失焦也能录；仅 Windows，需要 ffmpeg）。 |
| `dota_perf` | 采集数秒的帧时间，返回 p50/p95/p99，可选基线对比（仅 Windows，需要管理员终端）。 |
| `dota_input` | 向游戏窗口发送真实鼠标/键盘输入（点击、悬停、拖拽、滚轮、按键、Unicode 文本）；仅 Windows，坐标为客户区像素。 |
| `dota_open_vconsole` | 打开 vconsole2 窗口（控制台类工具需要它已打开）。 |
| `dota_launch_game` | 启动自定义游戏地图（等待进入对局；卡住时返回相位与推进方法）。 |
| `dota_disconnect` | 断开当前游戏。 |
| `dota_advance_to_game` | 把已加载的游戏从任一开局前相位推进到可玩的对局，每个玩家都有英雄（需要 `sv_cheats=1`）。 |
| `dota_restart` | 重载当前地图（等到重载真正开始才返回）。 |
| `console_send` | 向 Dota 2 控制台发送命令。 |
| `console_output` | 读取控制台输出。 |
| `console_channels` | 列出可用的 VConsole2 通道。 |
| `console_find` | 搜索控制台命令或 cvar。 |
| `console_help` | 查看命令说明。 |
| `console_gui_filter` | 控制 MCP 产生的控制台输出是否显示在 vconsole2 GUI 里（默认屏蔽）。 |
| `dota_api_lua` | 查询 Lua API。 |
| `dota_api_panorama_js` | 查询 Panorama JS API。 |
| `dota_api_css` | 查询 Panorama CSS 属性。 |
| `dota_api_events` | 查询 Panorama 事件。 |
| `dota_api_help` | 查看 Lua class/作用域（全局函数使用 `dota_api_lua`）。 |
| `dota_run_lua` | 在运行中的游戏里执行服务端 Lua（需要 `sv_cheats=1`）。 |
| `panorama_exec_js` | 在临时 Panorama 桥上下文里执行 JavaScript，提供面板、几何、游戏状态与事件 helper。 |
| `dota_test_run` | 运行 `scripts/vscripts/tests/<name>.lua` 的游戏内断言测试，返回逐条 pass/fail/timeout。 |
| `dota_dump_entities` | 列出当前场景实体（可选子串过滤）。 |
| `dota_dump_modifiers` | 默认列出服务端生效的 modifier，也可列出客户端注册类型（可选子串过滤）。 |
| `dota_entity_inspect` | 查看实体 Lua 作用域。 |
| `dota_compile_asset` | 编译 Source 2 资源。 |
| `vrf_ensure` | 确保 VRF CLI 可用（检测 / 下载 / sha256 校验 / 缓存，离线安全）。 |
| `asset_inspect` | 反编译资产并返回结构化摘要。 |
| `asset_check_refs` | 检查单个资产的递归引用完整性。 |
| `vfx_preview` | 在游戏内生成粒子预览（返回 pid；需要 `sv_cheats=1`）。 |
| `vfx_preview_stop` | 销毁预览粒子实例（需要 `sv_cheats=1`）。 |
| `file_read` | 读取 addon 内的文本文件。 |
| `file_write` | 在 addon 内写文件。 |
| `file_edit` | 在 addon 文件内做 old_string→new_string 替换（恰好一次匹配）。 |
| `file_delete` | 删除 addon 内的文件。 |
| `dota2_skill` | 获取内置开发 skill（特效/模型格式、游戏相位、运行时开发），支持目录、章节检索和 JSON `data_path` 精确查询，避免不必要的全文上下文。 |

## 常见问题

**AI 提示找不到 Dota 2 怎么办？**

确保 Dota 2 是通过 Steam 安装的，并且启动了 VConsole2。程序会通过 Steam appid `570` 自动定位 Dota 2 目录，不需要手动设置路径。

**为什么 vconsole2 GUI 要连 `29001`？**

因为 `dota2-mcp` 需要独占 Dota 2 的 VConsole2 连接，它会把 GUI 转发到 `29001`。这样人类开发者和 AI 都能同时使用控制台。

**我不想让 MCP 输出出现在 vconsole2 GUI 里**

默认就是屏蔽的。如果想临时关闭，调用 `console_gui_filter` 并设置 `auto: false`。

**AI 提示「vconsole 未打开」怎么办？**

见上方「配置 vconsole2 GUI 端口」一节的「怎么打开 vconsole2」。

## 版本

当前版本：`v2.0.0`

详情见 [CHANGELOG.md](./CHANGELOG.md) 与 [GitHub Releases](https://github.com/Demon673/dota2-mcp/releases)。

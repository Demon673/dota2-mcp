# dota2-mcp

Connect your AI assistant directly to your Dota 2 client to help with custom game development.

`dota2-mcp` is a server built on the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). Once connected to an MCP-capable AI client (Claude Code, Cursor, etc.), the AI can — while Dota 2 is running:

- Read and send console commands
- Query the Lua / Panorama JS / CSS / event APIs
- Launch, reload, and disconnect custom game maps
- Inspect entities, modifiers, and entity scripts in the current scene
- Compile Source 2 assets

No manual copy-paste of console output — the AI pulls live information straight from the game.

## Prerequisites

- Node.js ≥ 18 (ships npx)
- Dota 2 installed and launched with `-vconsole` or `-tools`

> Once dota2-mcp detects Dota 2 it **opens vconsole automatically** and establishes the connection — no manual steps. Note: **if vconsole isn't open, the relay doesn't connect to Dota** — console tools are also unavailable, so keep the window open (this way you can watch what the AI does in the console).

## Configure the vconsole2 GUI port

Dota 2 allows only one VConsole2 client on `127.0.0.1:29000` by default. `dota2-mcp` occupies that port and forwards the GUI to `127.0.0.1:29001`, so you need to point vconsole2 there manually.

**How to open vconsole2**: **by default you don't have to do anything** — the relay opens it automatically once it detects Dota is ready (set `DOTA2_VCON_AUTO_OPEN_VCONSOLE=0` to disable). Note: **if vconsole isn't open, the relay doesn't connect to Dota** (console tools are unavailable), so keep the window open. The vconsole button in Dota 2's tools mode (AssetBrowser) is disabled by the engine only while the relay holds `29000` (i.e. while vconsole is connected); once the window closes the button works again. You can also run `{dota 2 beta}\game\bin\win64\vconsole2.exe` directly, or ask the AI to call `dota_open_vconsole`. A window opened late is backfilled with init data and works as soon as it opens.

### First-time setup

1. Open vconsole2 and find the connection/device selection area in the first row below the top toolbar.
2. Choose **Add a new device to connect.**, set the port to `29001` — after creation a new port tab appears titled `Localhost:29001` — then open the connection (**Devices → Connect**).
3. Select the default `Localhost` (i.e. `29000`) and disconnect (**Devices → Disconnect**).

After this step, vconsole2 displays the Dota 2 console normally.

### Set up auto-connect (optional)

To avoid switching ports manually every time, you can set it to auto-connect to `29001` on startup:

1. Select `Localhost:29001`, click **Devices → Properties** in the menu bar, and enable **Auto connect at startup**.
2. Switch back to the default `Localhost` (`29000`) and, also under **Devices → Properties**, disable **Auto connect at startup**.

The next time vconsole2 starts it connects to `29001` automatically and no longer tries to occupy `29000`.

If you want to use vconsole2 without MCP (connecting straight to `29000`): close Dota 2 and exit all MCP sessions; the daemon idles out after about 5 minutes and releases `29000` (the daemon does not exit while Dota 2 is running, though you can kill it manually). For everyday use, keep the GUI on `29001` to use it alongside MCP without disconnecting.

## Install and configure

**Install method: npx (the only recommended one)**. Zero installation — every client start uses the latest version automatically (the first run downloads the package, then it uses the local cache; when offline it falls back to the cached version).

### Common configuration

Every MCP-capable client takes the same config; put it in the client's `mcpServers`:

```json
"dota2": {
  "command": "npx",
  "args": ["-y", "dota2-mcp"]
}
```

### Per-client configuration

Installation has two paths; pick whichever you prefer:

- **Let the AI install it (recommended)**: send this README (or the "Common configuration" above) to your usual AI assistant and tell it to "install dota2-mcp into my client". The AI reads this section and either runs the install command (e.g. `claude mcp add ...`) or writes the matching config file itself. This tool is built for AI, so this path is smoothest — and you don't need to read the rest.
- **Install manually**: follow the subsection for your client below — entries with "Option 1" run a command; those without one (or with an Option 2) edit a config file.

**Claude Code**

- Run `claude mcp add dota2 -- npx -y dota2-mcp` from the command line; see the [Claude Code MCP docs](https://docs.anthropic.com/en/docs/claude-code/mcp) for full configuration and verification

**Claude Desktop**

- Add the common configuration to `mcpServers` and restart; see the [Claude Desktop MCP docs](https://modelcontextprotocol.io/quickstart/user) for full steps

**Cursor**

- Settings → MCP → Add new MCP server; or edit `~/.cursor/mcp.json` and add the common configuration

**VS Code (GitHub Copilot)**

- In your user `settings.json` or the workspace `.vscode/mcp.json`, write:
  ```json
  {
    "mcp": {
      "servers": {
        "dota2": { "command": "npx", "args": ["-y", "dota2-mcp"] }
      }
    }
  }
  ```

**Cline (VS Code extension)**

- Cline panel → MCP Servers → Configure MCP Servers; add the common configuration to the `mcpServers` of the opened `cline_mcp_settings.json`

**Codex CLI**

- Option 1 (recommended): run `codex mcp add dota2 -- npx -y dota2-mcp` from the command line
- Option 2: edit `~/.codex/config.toml` (TOML format):
  ```toml
  [mcp_servers.dota2]
  command = "npx"
  args = ["-y", "dota2-mcp"]
  ```
- Verify: `codex mcp list` — dota2 appears in the list with enabled true; or start a new Codex session and have the AI call `dota_status`

**Codex Desktop (Desktop App)**

- The desktop app and CLI **share the same `~/.codex/config.toml`** — there's no separate config entry; just write the TOML via Codex CLI's "Option 2" above
- After writing, **fully quit and restart the desktop app** (config is loaded at startup; it won't take effect without a restart), then start a new session and have the AI call `dota_status` to verify
- The desktop app has no MCP management UI; if you have the CLI installed you can also run `codex mcp list` to confirm the config took effect

**Other MCP clients**

- Find the MCP / mcpServers config entry and paste the common configuration.

### Post-startup verification

1. In the client, dota2 shows connected;
2. Launch Dota 2 (`-vconsole` or `-tools`);
3. Have the AI call `dota_status`: vconsole opens automatically (or is already open), and it returns the project status and next-step guidance.

### Troubleshooting connection issues

| Symptom | Fix |
|------|------|
| Client startup timeout / connection failure | First package pull is slow: change args to `["--prefer-offline", "-y", "dota2-mcp"]` (cache-first, still auto-updates; a new version may lag one cache cycle); Codex TOML can also add `startup_timeout_sec = 120` |
| Windows reports "command not found / not recognized" | Wrap with cmd: JSON clients use `"command": "cmd", "args": ["/c", "npx", "-y", "dota2-mcp"]`; Codex TOML uses `command = "cmd"`, `args = ["/c", "npx", "-y", "dota2-mcp"]` |
| Tools report "not connected to Dota 2" | Launch Dota 2 (`-vconsole` or `-tools`) |
| Tools report "vconsole not open" | It's normally opened automatically; if not, see "FAQ" below |

> Standalone executables (win/linux/mac) are still shipped with each Release, only for special cases where Node is inconvenient; use npx for everyday use.

## Available tools

| Tool | Purpose |
|------|------|
| `dota_status` | Get connection, vconsole, addon, map, and game status plus next-step suggestions. Call this first. |
| `dota_open_vconsole` | Open the vconsole2 window (console-class tools need it open). |
| `dota_launch_game` | Launch a custom game map (waits to enter the match; returns the phase and how to advance when stuck). |
| `dota_disconnect` | Disconnect the current game. |
| `dota_restart` | Reload the current map. |
| `console_send` | Send a command to the Dota 2 console. |
| `console_output` | Read console output. |
| `console_channels` | List available VConsole2 channels. |
| `console_find` | Search console commands or cvars. |
| `console_help` | View a command's help. |
| `console_gui_filter` | Control whether MCP-produced console output shows in the vconsole2 GUI (hidden by default). |
| `dota_api_lua` | Query the Lua API. |
| `dota_api_panorama_js` | Query the Panorama JS API. |
| `dota_api_css` | Query Panorama CSS properties. |
| `dota_api_events` | Query Panorama events. |
| `dota_api_help` | Query the official Lua API docs. |
| `dota_run_lua` | Execute server Lua in the running game. |
| `dota_dump_entities` | List entities in the current scene. |
| `dota_dump_modifiers` | List modifiers. |
| `dota_entity_inspect` | Inspect an entity's Lua scope. |
| `dota_compile_asset` | Compile Source 2 assets. |

## FAQ

**The AI says it can't find Dota 2 — what do I do?**

Make sure Dota 2 is installed via Steam and that VConsole2 is running. The program locates the Dota 2 directory automatically via Steam appid `570` — no need to set the path manually.

**Why does the vconsole2 GUI connect to `29001`?**

Because `dota2-mcp` needs exclusive access to Dota 2's VConsole2 connection, it forwards the GUI to `29001`. This way the human developer and the AI can use the console at the same time.

**I don't want MCP output to appear in the vconsole2 GUI**

It's hidden by default. To show MCP output in the GUI temporarily, call `console_gui_filter` and set `auto: false`.

**The AI says "vconsole not open" — what do I do?**

Normally the relay opens vconsole2 automatically when it detects Dota is ready. If it isn't open: run `{dota 2 beta}\game\bin\win64\vconsole2.exe` directly, or have the AI call `dota_open_vconsole`. Note that when vconsole isn't open, console-class tools are unavailable — so keep the window open (that way you can watch what the AI does in the console). The vconsole button in AssetBrowser is inactive only while vconsole is connected — that's an engine limitation, not a fault.

## Version

Current version: `v1.6.0`

See [CHANGELOG.md](./CHANGELOG.md) and [GitHub Releases](https://github.com/Demon673/dota2-mcp/releases) for details.

---

# dota2-mcp

让 AI 助手直接连接你的 Dota 2 客户端，辅助自定义游戏开发。

`dota2-mcp` 是一个基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 的服务器。接入支持 MCP 的 AI 客户端（如 Claude Code、Cursor 等）后，AI 就能在 Dota 2 运行时：

- 读取并发送控制台命令
- 查询 Lua / Panorama JS / CSS / 事件 API
- 启动、重载、断开自定义游戏地图
- 查看当前场景中的实体、修饰器、实体脚本
- 编译 Source 2 资源

无需手动复制粘贴控制台输出，AI 可以直接从游戏里拿到实时信息。

## 前置条件

- Node.js ≥ 18（自带 npx）
- Dota 2 已安装，并以 `-vconsole` 或 `-tools` 启动

> dota2-mcp 探测到 Dota 2 后会**自动打开 vconsole** 并建立连接，无需手动操作。注意：**vconsole 不开，relay 就不连 Dota**——控制台类工具也不可用，所以窗口请保持开着（这样你也能随时看到 AI 在控制台里做了什么）。

## 配置 vconsole2 GUI 端口

Dota 2 默认只允许一个 VConsole2 客户端连接 `127.0.0.1:29000`。`dota2-mcp` 已经占用了这个端口，并把 GUI 转发到 `127.0.0.1:29001`，所以需要手动把 vconsole2 切过去。

**怎么打开 vconsole2**：**默认不用管**——relay 探测到 Dota 就绪后会自动帮你打开（设 `DOTA2_VCON_AUTO_OPEN_VCONSOLE=0` 可关闭）。注意：**vconsole 不开，relay 就不连 Dota**（控制台类工具也不可用），所以窗口请保持开着。Dota 2 工具模式（AssetBrowser）里的 vconsole 按钮只在 relay 占用 `29000` 期间（即 vconsole 已连接时）被引擎禁用；窗口关闭后按钮恢复可用。也可直接运行 `{dota 2 beta}\game\bin\win64\vconsole2.exe`，或让 AI 调用 `dota_open_vconsole`。晚打开的窗口会自动补齐初始化数据，随开随用。

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
| `dota_open_vconsole` | 打开 vconsole2 窗口（控制台类工具需要它已打开）。 |
| `dota_launch_game` | 启动自定义游戏地图（等待进入对局；卡住时返回相位与推进方法）。 |
| `dota_disconnect` | 断开当前游戏。 |
| `dota_restart` | 重载当前地图。 |
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
| `dota_api_help` | 查询官方 Lua API 文档。 |
| `dota_run_lua` | 在运行中的游戏里执行服务端 Lua。 |
| `dota_dump_entities` | 列出当前场景实体。 |
| `dota_dump_modifiers` | 列出修饰器。 |
| `dota_entity_inspect` | 查看实体 Lua 作用域。 |
| `dota_compile_asset` | 编译 Source 2 资源。 |

## 常见问题

**AI 提示找不到 Dota 2 怎么办？**

确保 Dota 2 是通过 Steam 安装的，并且启动了 VConsole2。程序会通过 Steam appid `570` 自动定位 Dota 2 目录，不需要手动设置路径。

**为什么 vconsole2 GUI 要连 `29001`？**

因为 `dota2-mcp` 需要独占 Dota 2 的 VConsole2 连接，它会把 GUI 转发到 `29001`。这样人类开发者和 AI 都能同时使用控制台。

**我不想让 MCP 输出出现在 vconsole2 GUI 里**

默认就是屏蔽的。如果想临时关闭，调用 `console_gui_filter` 并设置 `auto: false`。

**AI 提示「vconsole 未打开」怎么办？**

正常情况下 relay 探测到 Dota 就绪会自动打开 vconsole2。没有打开时：直接运行 `{dota 2 beta}\game\bin\win64\vconsole2.exe`，或让 AI 调用 `dota_open_vconsole`。注意 vconsole 不开，控制台类工具就不可用（这样你能看到 AI 的操作）。AssetBrowser 里的 vconsole 按钮只在 vconsole 已连接时无效，是引擎的限制，不是故障。

## 版本

当前版本：`v1.6.0`

详情见 [CHANGELOG.md](./CHANGELOG.md) 与 [GitHub Releases](https://github.com/Demon673/dota2-mcp/releases)。

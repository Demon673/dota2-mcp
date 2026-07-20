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

- Node.js ≥ 18（推荐）
- Dota 2 已安装，且以 `-vconsole` 启动

> 启动后 dota2-mcp 会**自动连接** Dota 2 的 VConsole2（端口 `29000`）并保持在线（断线自动重连），无需任何手动操作。
> 如果也想自己打开 vconsole2 GUI 看控制台，把它连到 `127.0.0.1:29001` 即可（见下节）；不开 GUI 不影响 MCP 使用。

## 配置 vconsole2 GUI 端口

Dota 2 默认只允许一个 VConsole2 客户端连接 `127.0.0.1:29000`。`dota2-mcp` 已经占用了这个端口，并把 GUI 转发到 `127.0.0.1:29001`，所以需要手动把 vconsole2 切过去。

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

如果想脱离 MCP 单独使用 vconsole2（直连 `29000`）：先退出所有 MCP 会话，守护进程空闲约 5 分钟自动退出并释放 `29000` 后再连接。平时把 GUI 连在 `29001` 上即可与 MCP 同时使用，无需断开。

## 安装

### 方式一：源码运行（开发推荐）

```bash
git clone git@github.com:Demon673/dota2-mcp.git
cd dota2-mcp
npm install
npm run build
```

### 方式二：通过 npm 安装（推荐，无需手动路径）

全局安装：

```bash
npm install -g dota2-mcp
```

MCP 配置：

```json
{
  "mcpServers": {
    "dota2": {
      "command": "dota2-mcp"
    }
  }
}
```

或者使用 `npx`（无需全局安装）：

```json
{
  "mcpServers": {
    "dota2": {
      "command": "npx",
      "args": ["-y", "dota2-mcp"]
    }
  }
}
```

> 这是 npm / Node.js 运行方式，不是独立 exe。独立 exe 请从 GitHub Releases 下载。

### 方式三：下载独立可执行文件

从 [GitHub Releases](https://github.com/Demon673/dota2-mcp/releases) 下载对应平台的二进制文件，无需安装 Node.js：

| 平台 | 文件名 |
|------|--------|
| Windows | `dota2-mcp-win.exe` |
| Linux | `dota2-mcp-linux` |
| macOS | `dota2-mcp-mac` |

Linux / macOS 下载后需要赋予执行权限：

```bash
chmod +x dota2-mcp-linux
```

## 在 AI 客户端中使用

所有支持 MCP 的客户端都使用同样的格式：指定一个 `command`，必要时加 `args`。推荐用 npm 方式：

```json
{
  "mcpServers": {
    "dota2": {
      "command": "npx",
      "args": ["-y", "dota2-mcp"]
    }
  }
}
```

如果你是全局安装 `npm install -g dota2-mcp`，则把 `command` 改成 `"dota2-mcp"`，去掉 `args` 即可。

### 各客户端配置入口

| 客户端 | 把上面的 JSON 放到哪里 |
|--------|------------------------|
| **Claude Code** | 运行 `/mcp add dota2 npx -y dota2-mcp`，或编辑 `~/.claude/config.json` 的 `mcpServers` |
| **Claude Desktop** | Windows：`%APPDATA%/Claude/claude_desktop_config.json`<br>macOS：`~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Cursor** | Settings → MCP → Add new MCP server |
| **VS Code** | `settings.json` 中的 `mcp.servers`（或工作区设置） |
| **Cline** | Settings → MCP Servers |
| **Codex (OpenAI Codex CLI)** | Windows：`%USERPROFILE%/.codex/config.json`<br>macOS / Linux：`~/.codex/config.json` |
| **其他 MCP 客户端** | 找到 MCP / Tools 配置入口，粘贴同样的 `mcpServers` JSON |

### 不使用 npm 时的配置

如果你选择源码或可执行文件，需要在配置里写**绝对路径**：

```json
{
  "mcpServers": {
    "dota2": {
      "command": "node",
      "args": ["C:/path/to/dota2-mcp/dist/index.js"]
    }
  }
}
```

```json
{
  "mcpServers": {
    "dota2": {
      "command": "C:/path/to/dota2-mcp-win.exe"
    }
  }
}
```

```json
{
  "mcpServers": {
    "dota2": {
      "command": "/path/to/dota2-mcp-linux"
    }
  }
}
```

> `/path/to/dota2-mcp` 是占位符，请替换为你本地的实际绝对路径。

## 可用工具

| 工具 | 用途 |
|------|------|
| `project_info` | 获取当前 addon、地图、游戏状态。建议先调用。 |
| `dota_launch_game` | 启动自定义游戏地图。 |
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

## 版本

当前版本：`v1.3.1`

详情见 [CHANGELOG.md](./CHANGELOG.md) 与 [GitHub Releases](https://github.com/Demon673/dota2-mcp/releases)。

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
- Dota 2 已安装，且启动了 VConsole2（游戏启动参数带 `-vconsole`）
- vconsole2 GUI 连接 `127.0.0.1:29001`（而不是默认的 `29000`）

## 配置 vconsole2 GUI 端口

Dota 2 默认只允许一个 VConsole2 客户端连接 `127.0.0.1:29000`。`dota2-mcp` 已经占用了这个端口，并把 GUI 转发到 `127.0.0.1:29001`，所以需要手动把 vconsole2 切过去。

### 首次设置

1. 打开 vconsole2，在顶部工具栏下方第一排找到连接/设备选择区域。
2. 选择 **Add a new device to connect.**（添加一个新的连接设备），输入 `29001`，标题会显示为 `Localhost:29001`，然后打开连接。
3. 选中默认的 `Localhost`（即 `29000`），断开连接。

完成这一步后，vconsole2 就能正常显示 Dota 2 控制台了。

### 设置自动连接（可选）

不想每次手动切换端口，可以设置开机自动连 `29001`：

1. 选中 `Localhost:29001`，点击菜单栏 **Devices → Properties**，开启 **Auto connect at startup**。
2. 再切换回默认的 `Localhost`（`29000`），同样在 **Devices → Properties** 里关闭 **Auto connect at startup**。

这样下次启动 vconsole2 时会自动连接 `29001`，不会再尝试占用 `29000`。

## 安装

### 方式一：源码运行（开发推荐）

```bash
git clone git@github.com:Demon673/dota2-mcp.git
cd dota2-mcp
npm install
npm run build
```

### 方式二：下载独立可执行文件

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

> 下面配置里的 `/path/to/dota2-mcp` 只是占位符，请替换为你本地实际存放本项目的**绝对路径**。

### Claude Code / Claude Desktop

源码方式：

```json
{
  "mcpServers": {
    "dota2": {
      "command": "node",
      "args": ["/path/to/dota2-mcp/dist/index.js"]
    }
  }
}
```

独立可执行文件方式（Windows）：

```json
{
  "mcpServers": {
    "dota2": {
      "command": "C:/path/to/dota2-mcp-win.exe"
    }
  }
}
```

独立可执行文件方式（Linux / macOS）：

```json
{
  "mcpServers": {
    "dota2": {
      "command": "/path/to/dota2-mcp-linux"
    }
  }
}
```

### Cursor

在 Cursor 设置中找到 MCP 配置，添加上述对应内容即可。

## 环境变量

| 变量 | 说明 |
|------|------|
| `DOTA2_PATH` | Dota 2 beta 目录。未设置时会按平台自动检测常见 Steam 路径。 |
| `DOTA2_ADDON` | 当自动检测失败时使用的 addon 名称。 |

常见 `DOTA2_PATH` 示例：

- Windows：`D:/SteamLibrary/steamapps/common/dota 2 beta`
- Linux：`~/.steam/steam/steamapps/common/dota 2 beta`
- macOS：`~/Library/Application Support/Steam/steamapps/common/dota 2 beta`

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

设置 `DOTA2_PATH` 环境变量指向你的 `dota 2 beta` 目录。

**为什么 vconsole2 GUI 要连 `29001`？**

因为 `dota2-mcp` 需要独占 Dota 2 的 VConsole2 连接，它会把 GUI 转发到 `29001`。这样人类开发者和 AI 都能同时使用控制台。

**我不想让 MCP 输出出现在 vconsole2 GUI 里**

默认就是屏蔽的。如果想临时关闭，调用 `console_gui_filter` 并设置 `auto: false`。

## 版本

当前版本：`v1.1.1`

详情见 [CHANGELOG.md](./CHANGELOG.md) 与 [GitHub Releases](https://github.com/Demon673/dota2-mcp/releases)。

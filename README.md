# dota2-mcp

一个基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 的 Dota 2 自定义游戏开发服务器。

它通过 VConsole2 TCP 协议直接与运行中的 Dota 2 客户端通信，让 AI 代理（如 Claude Code）能够：

- 实时读写 Dota 2 控制台
- 查询 Lua / Panorama JS / CSS / 事件等官方 API（实时从引擎获取）
- 启动、重启、断开游戏
- 查看实体、修饰器、实体脚本作用域
- 编译 Source 2 资源

所有功能纯 Node.js 实现，无额外二进制依赖。

## 前置条件

- Node.js ≥ 18
- Dota 2 已安装并启用了 VConsole2（启动参数带 `-vconsole`，或在游戏中打开 vconsole2）
- vconsole2 GUI 连接到 `127.0.0.1:29001`（而不是默认的 `29000`）

## 安装与构建

```bash
npm install
npm run build
```

## 作为 MCP 服务器使用

### 方式一：直接运行（开发/源码）

```bash
npm run start
```

MCP 客户端配置：

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

### 方式二：使用独立可执行文件（推荐发布）

打包成单个 `.exe`：

```bash
npm run build
npm run package
```

生成 `dist/dota2-mcp.exe`（约 90MB，内含 Node 运行时）。

MCP 客户端配置：

```json
{
  "mcpServers": {
    "dota2": {
      "command": "C:/path/to/dota2-mcp/dist/dota2-mcp.exe"
    }
  }
}
```

### 端口说明

服务器启动后会监听三个端口：

| 端口 | 用途 |
|------|------|
| 29000 | Dota 2 VConsole2（由 relay 独占） |
| 29001 | vconsole2 GUI 连接端口（relay 转发） |
| 29002 | MCP 控制端口（备用，MCP 主要走 stdio） |

### 环境变量

| 变量 | 说明 |
|------|------|
| `DOTA2_PATH` | Dota 2 beta 目录，如 `D:/SteamLibrary/steamapps/common/dota 2 beta`。未设置时自动检测常见 Steam 路径。 |
| `DOTA2_ADDON` | 当自动检测失败时使用的 addon 名称。 |

## 提供的工具

| 工具 | 说明 |
|------|------|
| `project_info` | 当前 addon、地图、游戏状态。建议先调用。 |
| `dota_launch_game` | 启动自定义游戏地图。 |
| `dota_disconnect` | 断开当前游戏。 |
| `dota_restart` | 重载当前地图。 |
| `console_send` | 向 Dota 2 控制台发送命令。 |
| `console_output` | 读取控制台输出，支持按级别、通道、正则过滤。 |
| `console_channels` | 列出当前可用的 VConsole2 通道。 |
| `console_find` | 搜索所有控制台命令/cvar。 |
| `console_help` | 查看命令说明。 |
| `console_gui_filter` | 控制 MCP 产生的控制台输出是否转发到 vconsole2 GUI（默认开启屏蔽）。 |
| `dota_api_lua` | 查询 Lua API（`script_help2` / `cl_script_help2`）。 |
| `dota_api_panorama_js` | 查询 Panorama JS API。 |
| `dota_api_css` | 查询 Panorama CSS 属性。 |
| `dota_api_events` | 查询 Panorama 事件。 |
| `dota_api_help` | 查询官方 Lua API 文档（`script_help`）。 |
| `dota_run_lua` | 在运行中的游戏里执行服务端 Lua。 |
| `dota_dump_entities` | 列出当前场景实体。 |
| `dota_dump_modifiers` | 列出修饰器。 |
| `dota_entity_inspect` | 查看实体 Lua 作用域。 |
| `dota_compile_asset` | 使用 `resourcecompiler.exe` 编译 Source 2 资源。 |

## vconsole2 GUI 输出屏蔽

默认情况下，MCP 发送的命令及其产生的控制台输出不会显示在 vconsole2 GUI 里，避免人类开发者被大量 JSON/API dump 刷屏。

屏蔽方式：MCP 把命令包在 `ai_disabled; <cmd>; ai_disabled` 中一次性发送，relay 检测到 `ai_disabled = false` / `ai_disabled = true` 这两行标记后，把标记之间的输出从 GUI 转发中丢弃。MCP 工具本身仍能通过 `console_output` 等读取完整输出。

如需临时关闭，调用 `console_gui_filter` 并设置 `auto: false`。

## 开发命令

```bash
npm run build    # 编译 src/ 到 dist/
npm run dev      # 监听模式编译
npm run start    # 运行编译后的服务器
npm run check    # 仅类型检查
```

## 测试

```bash
node scripts/test-mcp-tools.mjs
```

该脚本会启动服务器、连接 Dota 2，并逐个调用所有工具，最后输出通过/失败摘要。

## 已知限制

- 同一台机器上只能运行一个 relay 实例（端口 29001/29002 唯一）。
- 很多 API dump / 实体检查工具需要地图已经加载。
- VConsole2 GUI 必须手动配置为连接 `127.0.0.1:29001`。

## 版本

当前版本：`v1.0.0`

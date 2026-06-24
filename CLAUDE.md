# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

`dota2-mcp` 是一个 TypeScript 编写的 MCP（Model Context Protocol）服务器，用于把 AI 代理桥接到 Dota 2 自定义游戏开发流程中。它以 stdio MCP 服务器的形式运行，暴露一组工具，可与运行中的 Dota 2 客户端进行实时控制台通信、游戏启动/控制以及 API 实时查询。

- 语言：TypeScript（Node.js >= 18）
- 入口：`src/index.ts` → `dist/index.js`
- 传输：stdio MCP（`StdioServerTransport`）
- 无外部二进制依赖，纯 Node.js + 原始 TCP socket

## 常用命令

所有命令都定义在 `package.json` 中：

```bash
npm install          # 安装依赖
npm run build        # tsc — 把 src/ 编译到 dist/
npm run dev          # tsc --watch — 监听模式编译
npm run start        # node dist/index.js — 运行编译后的 MCP 服务器
npm run check        # tsc --noEmit — 仅类型检查
```

目前未配置测试、lint 或格式化脚本。

### 开发时运行服务器

服务器通过 stdio 与 MCP 客户端通信，通常由 MCP 客户端调用（例如配置了本地 MCP 的 Claude Code）。手动调试可运行：

```bash
npm run build
npm run start
```

启动后，服务器会立即尝试在 `127.0.0.1:29001`（GUI 端口）和 `:29002`（控制端口）启动 VCon relay。

## 环境变量

- `DOTA2_PATH` — Dota 2 beta 目录。未设置时回退到 `consoleBridge.detectDotaPath()`，它会检查常见 Steam 安装路径。
- `DOTA2_ADDON` — 当自动检测失败时使用的 addon 名称。

## 架构

### 数据流

```
AI 代理（通过 stdio 的 MCP 客户端）
    ↓
src/index.ts  — 注册全部 MCP 工具
    ↓
src/tools/vcon-relay.ts  — VCon relay / 控制端口 :29002
    ├──→ src/tools/vcon-bridge.ts（VConClient）→ Dota 2 引擎 :29000
    └──→ vconsole2 GUI :29001
```

Dota 2 在端口 `29000` 上只允许一个 VConsole2 客户端连接。Relay 独占该连接，并暴露第二个端口 `29001`，使官方 vconsole2 GUI 仍能透明连接。MCP 工具直接通过 relay 注入命令并读取输出。

### 核心模块

| 文件 | 职责 |
|------|------|
| `src/index.ts` | MCP 服务器入口，注册全部工具，把 relay 状态接入工具处理函数。 |
| `src/tools/vcon-relay.ts` | `VConRelay` 类。vconsole2 GUI（`:29001`）与 Dota 2（`:29000`）之间的透明代理；MCP 通过控制端口（`:29002`）注入命令和拉取输出。断开后自动重连 Dota 2。 |
| `src/tools/vcon-bridge.ts` | `VConClient` 类。底层 VConsole2 TCP 协议实现：12 字节帧头解析、`PRNT`/`AINF`/`CHAN`/`ADON`/`CVRB`/`CFGV` 分发、`CMND` 命令发送。 |
| `src/tools/console-bridge.ts` | 降级工具：自动检测 Dota 2 路径、tail `game/dota/console.log`、写入临时 `.cfg` 文件执行命令。 |
| `src/tools/proxy-intercept.ts` | 独立的协议分析工具。用 `npx tsx src/tools/proxy-intercept.ts direct` 或 `proxy` 运行，可抓取或 MITM 分析 VCon 流量。 |

### VConsole2 协议

Relay/Client 实现了已针对 Dota 2 验证的 VConsole2 二进制帧格式：

```
[Type: 4B ASCII] [Version: 2B uint16 BE = 212] [Length: 4B uint32 BE] [Handle: 2B uint16 BE] [Payload]
```

服务端 → 客户端消息类型：`AINF`、`ADON`、`CHAN`、`CVRB`、`PRNT`、`CFGV`。  
客户端 → 服务端命令类型：`CMND`（以 null 结尾的 ASCII）。

### 工具分类

工具注册在 `src/index.ts` 中：

- **游戏控制：** `project_info`、`dota_launch_game`、`dota_disconnect`、`dota_restart`
- **控制台 I/O：** `console_send`、`console_output`、`console_find`、`console_help`
- **API 文档（实时控制台查询）：** `dota_api_lua`、`dota_api_panorama_js`、`dota_api_css`、`dota_api_events`、`dota_api_help`
- **调试检查：** `dota_dump_entities`、`dota_dump_modifiers`、`dota_entity_inspect`

所有 API 参考工具都向运行中的引擎实时查询，不使用本地 JSON 数据库，因为 Dota 2 API 内容随引擎版本变化。

## 来自 AGENTS.md 的重要约定

- **零硬编码：** addon 和地图名称均在运行时动态检测。地图扫描路径为 `{dota2Path}/content/dota_addons/{addon}/maps/*.vmap`。
- **信任边界：** Server Lua 是权威来源，Panorama JS 仅用于客户端 UI 逻辑。
- **编辑源文件，不改动生成文件：** 编辑 `.ts`/`.tsx` 源文件，不动生成的 `.lua`/`.js`。
- 每个工具描述都会标注对应的控制台命令，方便 AI 通过 `console_find` 自行发现相关命令。

## 已知问题 / 注意事项

- `src/index.ts` 直接依赖 `zod` 定义 MCP 工具参数 schema，但 `package.json` 的 `dependencies` 中**没有显式声明 `zod`**。当前 `node_modules` 里能解析到它，是因为 `@modelcontextprotocol/sdk` 把它作为间接依赖引入（npm 依赖提升）。建议执行 `npm install zod` 将其加入 `dependencies`，避免后续环境依赖不完整。
- VCon relay 会占用端口 `29001`（GUI）和 `29002`（MCP 控制）；同一台机器上同时只能运行一个实例。
- VConsole2 GUI 需要手动配置连接 `127.0.0.1:29001`（而不是默认的 `29000`），因为 Dota 2 只允许一个 VCon 客户端直接连 `:29000`。
- Dota 2 必须带 `-vconsole` 参数启动（或已启用 vconsole2 监听器），relay 才能连上 `:29000`。
- 很多 API dump 工具需要地图已加载，调用过早可能返回空结果。

## 相关参考

- `AGENTS.md` — 完整的中文项目笔记、已验证控制台命令和 TODO 列表。
- 相关本地仓库：`C:\Repositories\tui12`、`C:\Repositories\dota2-tools`
- VConsole2 协议参考：VConsole2.Client（C#）、VConsoleLib.python、luaconsole2

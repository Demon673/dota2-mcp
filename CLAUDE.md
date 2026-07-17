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
npm run bundle       # esbuild → dist/bundle.cjs（打包前置步骤）
npm run package      # bundle + Node SEA 单文件可执行程序（scripts/sea-package.mjs）
```

目前没有 lint/format/test 脚本。唯一的测试是 `scripts/test-mcp-tools.mjs`（`node scripts/test-mcp-tools.mjs`）——它会 spawn 服务器并冒烟测试所有工具，**需要 Dota 2 正在运行且已连接 VCon**，不是离线单元测试。

### 开发时运行服务器

服务器通过 stdio 与 MCP 客户端通信，通常由 MCP 客户端调用（例如配置了本地 MCP 的 Claude Code）。手动调试可运行：

```bash
npm run build
npm run start
```

启动后，服务器会立即尝试在 `127.0.0.1:29001`（GUI 端口）和 `:29002`（控制端口）启动 VCon relay。注意：relay 只在 **vconsole2 GUI 连接到 :29001 之后**才会去连 Dota 2 的 `:29000`；GUI 断开时会释放 `:29000`。

## 环境变量

通常情况下**无需配置任何环境变量**。Dota 2 路径通过 Steam appid `570` 自动检测，addon 名称通过 VCon relay 实时获取或在 `content/dota_addons/` 下自动推断。

可选高级配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DOTA2_VCON_DOTA_PORT` | `29000` | Dota 2 VConsole2 端口 |
| `DOTA2_VCON_GUI_PORT` | `29001` | 转发给 vconsole2 GUI 的端口 |
| `DOTA2_VCON_CTRL_PORT` | `29002` | MCP 控制端口（`STATUS/CMD/TAIL`） |

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

### MCP 输出与 vconsole2 GUI 的隔离

为了避免 AI 高频调用 `status_json`、`script_help2` 等命令时把大量 JSON 输出刷到人类开发者的 vconsole2 GUI 上，relay 在发送 MCP 命令时会把命令包装成：

```
ai_disabled; <cmd>; ai_disabled
```

Dota 2 会回显两条 `ai_disabled = false` / `ai_disabled = true` 标记行。relay 识别这两行标记：

- 标记行本身不进入 MCP 缓冲区，也不转发给 GUI；
- 两条标记之间的所有 PRNT 输出仍会进入 MCP 缓冲区，但默认不转发到 GUI；
- 可以通过 `console_gui_filter` 工具关闭该行为，或在 vconsole2 GUI 里仍看到全部输出。

这是一个**约定俗成的功能特性**，不是控制台 cvar 的真实语义，仅用于输出隔离。

### 核心模块

| 文件 | 职责 |
|------|------|
| `src/index.ts` | MCP 服务器入口，注册全部工具，把 relay 状态接入工具处理函数。 |
| `src/tools/vcon-relay.ts` | `VConRelay` 类。vconsole2 GUI（`:29001`）与 Dota 2（`:29000`）之间的透明代理；MCP 通过控制端口（`:29002`）注入命令和拉取输出。断开后自动重连 Dota 2。 |
| `src/tools/vcon-bridge.ts` | `VConClient` 类。底层 VConsole2 TCP 协议实现：12 字节帧头解析、`PRNT`/`AINF`/`CHAN`/`ADON`/`CVRB`/`CFGV` 分发、`CMND` 命令发送。 |
| `src/tools/console-bridge.ts` | 自动检测 Dota 2 路径、tail `game/dota/console.log`。 |
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
- **控制台 I/O：** `console_send`、`console_output`、`console_channels`、`console_find`、`console_help`、`console_gui_filter`
- **API 文档（实时控制台查询）：** `dota_api_lua`、`dota_api_panorama_js`、`dota_api_css`、`dota_api_events`、`dota_api_help`
- **调试检查：** `dota_dump_entities`、`dota_dump_modifiers`、`dota_entity_inspect`、`dota_run_lua`
- **资源：** `dota_compile_asset`（resourcecompiler / Source2Viewer-CLI）

所有 API 参考工具都向运行中的引擎实时查询，不使用本地 JSON 数据库，因为 Dota 2 API 内容随引擎版本变化。

## 文档约定

- `README.md` 是**对外介绍文档**，面向终端用户 / AI 客户端配置者，主要说明项目用途、前置条件、安装方式、客户端配置和常见问题。**不要把实现细节、代码技术层级或内部协议细节写进 README**；这些应写在 `CLAUDE.md` 或代码注释里。

## 来自 AGENTS.md 的重要约定

- **零硬编码：** addon 和地图名称均在运行时动态检测。地图扫描路径为 `{dota2Path}/content/dota_addons/{addon}/maps/*.vmap`。
- **信任边界：** Server Lua 是权威来源，Panorama JS 仅用于客户端 UI 逻辑。
- **编辑源文件，不改动生成文件：** 编辑 `.ts`/`.tsx` 源文件，不动生成的 `.lua`/`.js`。
- 每个工具描述都会标注对应的控制台命令，方便 AI 通过 `console_find` 自行发现相关命令。

## 已知问题 / 注意事项

- VCon relay 会占用端口 `29001`（GUI）和 `29002`（MCP 控制）；同一台机器上同时只能运行一个实例。
- VConsole2 GUI 需要手动配置连接 `127.0.0.1:29001`（而不是默认的 `29000`），因为 Dota 2 只允许一个 VCon 客户端直接连 `:29000`。
- Dota 2 必须带 `-vconsole` 参数启动（或已启用 vconsole2 监听器），relay 才能连上 `:29000`。
- 很多 API dump 工具需要地图已加载，调用过早可能返回空结果。

## 相关参考

- `AGENTS.md` — 完整的中文项目笔记、已验证控制台命令和 TODO 列表。
- 相关本地仓库：`C:\Repositories\tui12`、`C:\Repositories\dota2-tools`
- VConsole2 协议参考：VConsole2.Client（C#）、VConsoleLib.python、luaconsole2

## Agent skills

### Issue tracker

Issues 追踪在 GitHub Issues（`gh` CLI）。见 `docs/agents/issue-tracker.md`。

### Triage labels

使用默认五标签：needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix。见 `docs/agents/triage-labels.md`。

### Domain docs

Single-context：根目录 `CONTEXT.md` + `docs/adr/`（不存在时静默跳过）。见 `docs/agents/domain.md`。

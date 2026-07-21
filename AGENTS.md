# dota2-mcp — DOTA2 自定义游戏全流程 MCP Server

> AI agent 辅助 DOTA2 自定义游戏开发：VCon 实时 Console 桥接、控制台 API 查询、游戏启动/重启/监控。

## Project

- **技术栈**：TypeScript (Node.js >= 18) + `@modelcontextprotocol/sdk`
- **入口**：`src/index.ts` → `dist/index.js`（stdio MCP server，瘦客户端）
- **守护进程**：`src/relay-main.ts` → `dist/relay-main.js`（detached relay，独占 Dota 2 :29000，生命周期独立于任何 MCP 会话）
- **核心机制**：VConsole2 TCP 协议（端口 29000）→ VConRelay 透明代理（监听 29001 供 vconsole2 GUI 连接）
- **依赖**：无外部二进制依赖，纯 Node.js + 原始 TCP socket

## Commands

```bash
npm install           # 安装依赖
npm run build         # 同步版本号 + 编译 TypeScript → dist/
npm run check         # 类型检查 + 版本号一致性检查
npm run sync-version  # 以 package.json 为准同步各处版本号（--check 只校验不修改）
npm run dev           # tsc --watch 监听编译
npm run bundle        # esbuild → dist/bundle.cjs（打包前置步骤）
npm run package       # bundle + Node SEA 单文件可执行程序（scripts/sea-package.mjs）
node dist/index.js    # 启动 MCP server（通过 stdio）
```

**版本号**：只改 `package.json` 的 `version`，其余位置（`src/index.ts` 的 `getVersion()` fallback、`README.md`）由 `npm run sync-version` 同步；`build`/`prepack` 会自动执行。

**测试**：目前没有 lint/format/test 脚本。有两个冒烟脚本：`scripts/test-daemon.mjs`（`node scripts/test-daemon.mjs`，**离线**验证守护进程链路：spawn/握手/多客户端/广播/空闲退出，随机端口，不需要 Dota 2）和 `scripts/test-mcp-tools.mjs`（`node scripts/test-mcp-tools.mjs`，spawn 服务器并冒烟测试所有工具，**需要 Dota 2 正在运行且已连接 VCon**）。没有离线单元测试。

## 环境变量

通常**无需配置任何环境变量**。Dota 2 路径通过 Steam appid `570` 自动检测，addon 名称通过 VCon relay 实时获取或在 `content/dota_addons/` 下自动推断。

可选高级配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DOTA2_VCON_DOTA_PORT` | `29000` | Dota 2 VConsole2 端口 |
| `DOTA2_VCON_GUI_PORT` | `29001` | 转发给 vconsole2 GUI 的端口 |
| `DOTA2_VCON_CTRL_PORT` | `29002` | MCP 控制端口（`STATUS/CMD/TAIL`） |

## 关键发现

- **VConsole2 协议**：12 字节帧头 `Type(4B)+Version(2B=212)+Length(4B)+Handle(2B)` + payload（详见下文「VConsole2 协议」）
- **Dota 2 只允许 1 个 VCon 客户端**：Relay 抢占 29000，vconsole2 GUI 通过 relay 的 29001 端口共存。**已实测的副作用**：relay 持有 29000 期间引擎把 relay 当作已连接的 vconsole——AssetBrowser 的 vconsole 按钮/快捷键被禁用（不拉起进程）。打开 vconsole 请直接运行 vconsole2.exe 或调用 dota_open_vconsole
- **API 全部走控制台**：零本地 JSON 依赖，引擎版本决定 API 内容
- **已验证的控制台命令**：
  - `script_help2` / `cl_script_help2` — Lua API（stub 格式）
  - `cl_panorama_script_help_2` — Panorama JS 枚举
  - `dump_panorama_css_properties` — CSS 属性
  - `dump_panorama_events` — Panel 事件
  - `dota_modifier_dump` / `cl_dump_modifier_list` — Modifier 列表
  - `ent_script_dump` / `cl_ent_script_dump` — 实体脚本作用域
  - `script_find` / `cl_script_find` — VM 搜索（需游戏运行）
  - `script_dump_all` / `cl_script_dump_all` — VM 导出（需游戏运行）

## Architecture

### 开发时运行服务器

服务器通过 stdio 与 MCP 客户端通信，通常由 MCP 客户端调用（例如配置了本地 MCP 的 AI agent）。手动调试可运行：

```bash
npm run build
npm run start
```

### 守护进程架构（多实例共存）

relay 是一个**独立的 detached 后台进程**（`src/relay-main.ts`），生命周期独立于任何 MCP 会话。`src/index.ts` 只是瘦客户端。启动时 `createRelay()`（`src/index.ts`）按顺序：

1. 探测 `:29002` 已有守护进程 → 以 `RelayClient`（瘦客户端）接入；
2. 没有 → `acquireLock()` 抢锁，抢到的人 `spawnRelayDaemon()` 拉起 detached daemon，自己也以瘦客户端接入；没抢到的等它就绪再接入；
3. daemon 方案全部失败 → 退化为本地 `VConRelay`（单实例旧行为），保证工具至少可用。

这样多个 MCP 客户端（多个 AI agent / 多个会话）能同时连同一个 relay，共享对 Dota 2 `:29000` 的独占连接。守护进程状态放在 `os.tmpdir()/dota2-mcp/`（失败时 fallback `~/.dota2-mcp/`）：`relay.lock`（原子抢锁）、`relay.pid`、`relay.token`（0600，瘦客户端 `HELLO` 时校验）、`relay.log`。无客户端连接、无 GUI 且 **Dota 进程不在运行**时，空闲 5 分钟后守护进程自动退出（Dota 在跑 = 用户在开发，29001/29002 常驻）。

relay 启动后**主动连接** Dota 2 的 `:29000` 并常驻持有（断线每 2s 自动重连），不依赖 vconsole2 GUI；GUI 断开也不会释放 `:29000`。

守护进程进程被杀（非空闲退出）时：瘦客户端无限退避重连（封顶 5s），连续失败约 5 次（≈5s）后 MCP 会话内自动重跑 `createRelay()` 拉起新守护进程并整体替换接入（`attachRelay`/`respawnRelay`，`src/index.ts`）。

### 数据流

```
AI 代理（通过 stdio 的 MCP 客户端）
    ↓
src/index.ts  — 注册全部 MCP 工具，瘦客户端
    ↓  (控制端口 :29002，NDJSON 协议：HELLO/STATUS/CMD/TAIL/SETFILTERS/SETMCPSUPPRESS)
src/relay-main.ts  — detached 守护进程
    ↓
src/tools/vcon-relay.ts  — VConRelay 透明代理
    ├──→ src/tools/vcon-bridge.ts（VConClient）→ Dota 2 引擎 :29000
    └──→ vconsole2 GUI :29001
```

Dota 2 在端口 `29000` 上只允许一个 VConsole2 客户端连接。Relay 独占该连接，并暴露第二个端口 `29001`，使官方 vconsole2 GUI 仍能透明连接。MCP 工具通过控制端口 `:29002` 注入命令并读取输出。

**注意**：relay 启动后**主动连接** Dota 2 的 `:29000` 并常驻持有（断线每 2s 自动重连），不依赖 vconsole2 GUI；GUI 断开也不会释放 `:29000`。

**vconsole 契约**：控制台类工具要求 vconsole2 已接入 `:29001`（显式契约，保证使用者能旁观 agent 的控制台活动），否则报明确错误并给出打开路径。relay 给晚接入的 GUI 重放初始化帧（AINF/CHAN/CVRB/CFGV/ADON）；对 Dota 连接做活性探测（静默发 `echo` 探针，超时判死重连）；Dota 进程在跑时守护进程不做空闲退出。

### MCP 输出与 vconsole2 GUI 的隔离

为避免 AI 高频调用 `status_json`、`script_help2` 等命令时把大量 JSON 输出刷到人类开发者的 vconsole2 GUI 上，relay 在发送 MCP 命令时会包装成：

```
ai_disabled; <cmd>; ai_disabled
```

Dota 2 会回显两条 `ai_disabled = false` / `ai_disabled = true` 标记行。relay 识别这两行标记：

- 标记行本身不进入 MCP 缓冲区，也不转发给 GUI；
- 两条标记之间的所有 PRNT 输出仍会进入 MCP 缓冲区，但默认不转发到 GUI；
- 可通过 `console_gui_filter` 工具关闭该行为，或在 vconsole2 GUI 里仍看到全部输出。

这是一个**约定俗成的输出隔离特性**，不是控制台 cvar 的真实语义。

### 核心模块

| 文件 | 说明 |
|------|------|
| `src/index.ts` | MCP server 入口（瘦客户端）。注册全部工具；`createRelay()` 探测/拉起守护进程并以 `RelayClient` 接入，失败时退化为本地 `VConRelay` |
| `src/relay-main.ts` | relay 守护进程入口（detached）。独占 Dota 2 `:29000`，监听 `:29001`(GUI)/`:29002`(控制)，空闲 5 分钟自动退出 |
| `src/relay-client.ts` | `RelayClient` 类。瘦客户端，实现 `VConRelay` 公共接口子集，通过 `:29002` 与守护进程通信；断线自动重连并补发缓冲命令 |
| `src/daemon-utils.ts` | 守护进程协调：原子锁、PID、token(0600)、spawn/等待。状态目录 `os.tmpdir()/dota2-mcp` |
| `src/tools/vcon-relay.ts` | `VConRelay` 类。vconsole2 GUI（`:29001`）与 Dota 2（`:29000`）之间的透明代理；向各瘦客户端广播 PRNT/状态。断开后自动重连 Dota 2 |
| `src/tools/vcon-bridge.ts` | `VConClient` 类。底层 VConsole2 TCP 协议实现：12 字节帧头解析、`PRNT`/`AINF`/`CHAN`/`ADON`/`CVRB`/`CFGV` 分发、`CMND` 命令发送 |
| `src/tools/console-bridge.ts` | 自动检测 Dota 2 路径、cfg 文件写命令 + tail `game/dota/console.log` 降级方案 |
| `src/tools/proxy-intercept.ts` | 独立协议分析工具。`npx tsx src/tools/proxy-intercept.ts direct` 或 `proxy` 运行，可抓取或 MITM 分析 VCon 流量 |
| `skills/<name>/SKILL.md` | 内置技能目录。`dota2_skill` 工具从 `skills/` 读取带 frontmatter(name/description) 的 SKILL.md 并返回内容 |

### VConsole2 协议

Relay/Client 实现了已针对 Dota 2 验证的 VConsole2 二进制帧格式：

```
[Type: 4B ASCII] [Version: 2B uint16 BE = 212] [Length: 4B uint32 BE] [Handle: 2B uint16 BE] [Payload]
```

服务端 → 客户端消息类型：`AINF`、`ADON`、`CHAN`、`CVRB`、`PRNT`、`CFGV`。  
客户端 → 服务端命令类型：`CMND`（以 null 结尾的 ASCII）。

### 当前已实现的 22 个 MCP 工具

**游戏控制**
| 工具 | 控制台命令 | 说明 |
|------|-----------|------|
| `dota_status` | `status`/`status_json` + 文件扫描 | 入口/导航：连接、vconsole、addon/maps、实时状态、下一步指引（不抛异常） |
| `dota_launch_game` | `dota_launch_custom_game` | 启动（自动补全 addon）；轮询到 GAME_IN_PROGRESS，卡相位返回推进指引 |
| `dota_disconnect` | `disconnect` | 断开 |
| `dota_restart` | `restart` | 重载地图 |
| `dota_open_vconsole` | spawn vconsole2.exe | 打开 vconsole 窗口（AssetBrowser 按钮被引擎禁用时的显式路径） |

**Console 通信**
| 工具 | 控制台命令 | 说明 |
|------|-----------|------|
| `console_send` | 任意 | 发送命令 |
| `console_output` | VCon 流 | 读输出，支持 `level`（0=all,1=warn+,3=error）和 `filter` |
| `console_channels` | VCon `CHAN` | 列出 VCon 通道 |
| `console_find` | `find <kw>` | 搜索所有 5248 个控制台命令 |
| `console_help` | `help <cmd>` | 查看单个命令帮助 |
| `console_gui_filter` | relay 内部 | 开关 MCP 输出对 GUI 的隔离 |

**API 文档（全部走控制台实时查询）**
| 工具 | 控制台命令 | side |
|------|-----------|:--:|
| `dota_api_lua` | `script_help2` / `cl_script_help2` | 可选 |
| `dota_api_panorama_js` | `cl_panorama_script_help_2` | client |
| `dota_api_css` | `dump_panorama_css_properties` | client |
| `dota_api_events` | `dump_panorama_events` | client |
| `dota_api_help` | 组合 | API 查询入口/导航 |

**调试**
| 工具 | 控制台命令 | 说明 |
|------|-----------|------|
| `dota_dump_entities` | `ent_dump` 等 | 实体 dump |
| `dota_dump_modifiers` | `dota_modifier_dump` / `cl_dump_modifier_list` | Modifier 列表 |
| `dota_entity_inspect` | `ent_script_dump` / `cl_ent_script_dump` | 实体脚本作用域 |
| `dota_run_lua` | `script_exec` 等 | 执行 Lua 片段 |

**资源**
| 工具 | 说明 |
|------|------|
| `dota_compile_asset` | 调 resourcecompiler / Source2Viewer-CLI 编译资源 |

**技能**
| 工具 | 说明 |
|------|------|
| `dota2_skill` | 暴露 dota2 运行时开发技能内容 |

## Conventions

- **API 数据源**：只走控制台实时查询，不使用本地 JSON 数据库（引擎版本决定 API 内容）
- **信任边界**：Server Lua 权威，Panorama JS 客户端 UI 逻辑
- **零硬编码**：addon/map 全部动态检测，不写死任何项目名。地图扫描路径 `{dota2Path}/content/dota_addons/{addon}/maps/*.vmap`
- **工具描述**：每个工具清晰标注对应的控制台命令，AI 可通过 `console_find` 自行发现
- **TSTL/SolidJS 优先**：编辑 `.ts`/`.tsx` 源文件，不动生成的 `.lua`/`.js`
- **文档分工**：`README.md` 是对外介绍文档（面向终端用户 / AI 客户端配置者），不写实现细节、代码层级或内部协议细节；这些写在 `AGENTS.md` 或代码注释里。公共信息的改动优先更新 `AGENTS.md`，不要在 `CLAUDE.md` 复制一份

## 已知问题 / 注意事项

- 守护进程占用端口 `29001`（GUI）和 `29002`（控制）；多个 MCP 会话通过瘦客户端共享同一个守护进程，不再互斥。仅在守护进程拉起失败退化为本地 relay 时，才受单实例限制
- **vconsole 使用路径**：vconsole2 连接目标固定为 `127.0.0.1:29001`（relay 的 GUI 口）。AssetBrowser 的 vconsole 按钮在 relay 持有 29000 时被引擎禁用（已实测），请直接运行 `game/bin/win64/vconsole2.exe` 或调用 `dota_open_vconsole`；晚接入的窗口会收到初始化帧重放，随开随用
- Dota 2 必须带 `-vconsole` 参数启动（或已启用 vconsole2 监听器），relay 才能连上 `:29000`
- 很多 API dump 工具需要地图已加载，调用过早可能返回空结果

## References

| 项目 | 路径/URL |
|------|----------|
| tui12（守卫雅典娜2） | `C:\Repositories\tui12` |
| vscode-dota2-tools | `C:\Repositories\dota2-tools` |
| VRF / Source 2 Viewer | https://github.com/ValveResourceFormat/ValveResourceFormat |
| VConsole2.Client (C#) | https://github.com/yuijzeon/VConsole2.Client |
| VConsoleLib.python | https://github.com/uilton-oliveira/VConsoleLib.python |
| luaconsole2 (Lua) | https://github.com/eepycats/luaconsole2 |
| Dota 2 路径 | `D:\SteamLibrary\steamapps\common\dota 2 beta` |
| console.log 路径 | `{dota 2 beta}\game\dota\console.log` |
| VCon 端口 | 引擎监听 29000，relay 监听 29001（GUI）、29002（MCP 控制） |

## Agent skills

### Issue tracker

Issues 追踪在 GitHub Issues（`gh` CLI）。见 `docs/agents/issue-tracker.md`。

### Triage labels

使用默认五标签：needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix。见 `docs/agents/triage-labels.md`。

### Domain docs

Single-context：根目录 `CONTEXT.md` + `docs/adr/`（不存在时静默跳过）。见 `docs/agents/domain.md`。

## TODO — 后续计划

- [ ] **FileOps** — 读写 KV/Lua/TS/JS/CSS/XML 源文件
- [ ] **BuildTools** — npm/tstl/rollup 构建集成 + 脚手架生成
- [ ] **AssetInspector** — VRF CLI 子进程调用，解析 .vmdl_c/.vmap_c/.vpcf_c 等
- [ ] **Claude MCP 配置** — 写配置让 AI agent 直接调用
- [ ] 验证 `script_find` / `script_dump_all` 在游戏运行时的实际输出
- [ ] 测试 dota_launch_game 在各种 addon/map 组合下的表现

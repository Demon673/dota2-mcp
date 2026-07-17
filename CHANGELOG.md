# Changelog

## 1.3.0 (2026-07-17)

### 新增

- **`dota_status` 任务入口工具**：用户说"测试 / 验证 / 调试 Dota 2 项目"时 agent 的第一个抓手。报告连接 + addon + 地图状态，并根据状态指明下一步该调的工具（launch / console_output 查错 / dota_run_lua 验证），把工作流直接交给 agent。

### 改进

- **全部工具描述改为任务导向**：以"什么时候用"开头、用任务语言（"用户报告游戏内 bug 时用""用户想测试 addon 时启动地图"），修复了之前实现视角描述（"Send console command via VCon TCP"）导致 agent 匹配不到用户意图、转而去用别的工具的问题。

### 修复

- **addon 首次检测**：瘦客户端连上已运行的 daemon 时拿不到历史 addon（`adon` 事件早已发过），导致 `dota_status` 首次返回 `addon: "(detecting...)"`、maps 为空。启动时改从 hello-ok 握手读取 addon/maps；ADON 帧异步延迟时 `dota_status` 最多等待 3s。

## 1.2.1 (2026-07-17)

### 修复

- **守护进程 spawn 接线**：`createRelay` 现在真正通过 `acquireLock → spawnRelayDaemon → waitForRelay` 拉起 detached 守护进程。此前这些 API 是死代码，每个实例仍本地启动 relay，"守护进程独立于 MCP 会话存活"未真正实现。
- **安全：控制端口握手强制**。设了 token 后，未完成 HELLO 的连接无法发送任何命令，修复本机进程跳过握手直接 `CMD:` 注入（RunScriptCode 等于 RCE）的绕过。
- **connect 僵尸 Promise**：`hello-ok` 永不到达（如 daemon 握手前崩溃）时 8s 超时 reject，修复 `createRelay` 永久 await 导致 MCP 启动卡死。
- **daemon 重启崩所有 MCP 进程**：连接丢失不再抛 unhandled `error` 事件，静默走自动重连（指数退避封顶 5s），断线期间命令缓冲重连后补发。
- **VCon 帧重组（GUI→Dota）**：按 12 字节帧头 length 重组，修复大命令或网络抖动时半帧转发导致的引擎协议错乱。
- **npm 包缺失 daemon 文件**：`files` 字段从仅 `dist/index.js` 改为 `dist/*.js`，否则 npx 安装后 `require.resolve('./relay-main.js')` 抛错（发布阻断）。
- **Dota 2 路径检测**：`find-steam-app` 无法解析新版 `libraryfolders.vdf` 导致 `detectDotaPath()` 恒 null、地图扫描静默失效。改为 注册表 SteamPath → STEAM_PATH 环境变量 → 平台默认位置，每个来源展开 VDF 枚举所有库，支持任意盘/目录名。
- 检测不到 Dota 2 路径时 `dota_compile_asset` 给出可操作错误，而非静默拼出相对路径失败。
- token 生成改用 `crypto.randomBytes` + `wx` 原子创建。
- `livePid()` stale 清理比对内容，避免误删新 daemon 的 PID。
- 空闲退出时清理 `relay.pid`。

## 1.2.0 (2026-07-17)

### 新增

- **多实例共存：relay 守护进程 + 瘦客户端模式。** 多个 AI agent / 会话可同时通过 MCP 接入，共享同一个常驻 relay（独占 Dota 2 `:29000`），不再因 `:29001/:29002` 端口冲突导致后启动实例全部不可用。
- relay 守护进程独立存活（detached spawn），无客户端连接 5 分钟后自动退出。
- 瘦客户端通过 `:29002` 接入：`HELLO` 握手 + token 校验（`<tmpdir>/dota2-mcp/relay.token`，0600）、`STREAM` 实时 PRNT 推送、`SHUTDOWN` 空客户端自杀。
- 守护进程协调：文件锁 + PID + stale 检测，防止并发 spawn 竞态。
- 端口被占用时工具报错明确指向"另一个实例冲突"，而非误导性的"未连接 Dota 2"。
- 新增 `scripts/test-daemon.mjs`：离线守护进程链路测试（无需 Dota 2）。

### 修复

- `zod` 补入 `dependencies`（此前依赖 `@modelcontextprotocol/sdk` 的间接提升）。
- relay 的 Dota 2 路径硬编码改为跟随 `detectDotaPath()` 自动检测。

## 1.1.1 (未发布)

### 改进

- 使用 `find-steam-app` 库替代手写路径解析，自动跨平台查找 Dota 2 安装目录。
- README 补充占位路径说明。

## 1.1.0 (2026-06-25)

### 新增

- 跨平台支持：Windows、Linux、macOS。
- 按平台自动检测 Steam / Dota 2 安装路径。
- `npm run package` 现在使用 Node SEA 生成当前平台的独立可执行文件。
- 新增 GitHub Actions Release workflow，发布 Release 时自动构建三平台二进制并上传。
- 添加 MIT 开源协议。

## 1.0.0 (2026-06-25)

首个可用版本。

### 新增

- 基于 stdio 的 MCP 服务器，注册 20 个工具。
- VConsole2 TCP relay：在 Dota 2 `:29000` 与 vconsole2 GUI `:29001` 之间透明转发，MCP 通过 `:29002` 注入命令。
- 实时控制台 I/O：`console_send`、`console_output`、`console_channels`、`console_find`、`console_help`。
- 游戏控制：`project_info`、`dota_launch_game`、`dota_disconnect`、`dota_restart`。
- 运行时 API 查询：`dota_api_lua`、`dota_api_panorama_js`、`dota_api_css`、`dota_api_events`、`dota_api_help`。
- 调试检查：`dota_dump_entities`、`dota_dump_modifiers`、`dota_entity_inspect`、`dota_run_lua`。
- 资源工具：`dota_compile_asset`。
- vconsole2 GUI 输出屏蔽：默认把 MCP 命令输出用 `ai_disabled; ...; ai_disabled` 包裹，relay 自动隐藏标记间输出；MCP 仍可读完整输出。
- 全量冒烟测试脚本 `scripts/test-mcp-tools.mjs`。
- 支持打包为独立 Windows 可执行文件 `dist/dota2-mcp.exe`（esbuild + Node SEA）。

### 修复

- `console_find`、`console_help`、多个 API dump 工具因控制台输出捕获时机问题返回空结果的缺陷。

### 项目

- 补充 `README.md` 与 `CHANGELOG.md`。
- `package.json` 升级到 `1.0.0`，增加 `files` / `keywords` 等发布字段。

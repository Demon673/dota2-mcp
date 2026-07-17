# Changelog

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

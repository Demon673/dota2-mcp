# Changelog

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

### 修复

- `console_find`、`console_help`、多个 API dump 工具因控制台输出捕获时机问题返回空结果的缺陷。

### 项目

- 补充 `README.md` 与 `CHANGELOG.md`。
- `package.json` 升级到 `1.0.0`，增加 `files` / `keywords` 等发布字段。

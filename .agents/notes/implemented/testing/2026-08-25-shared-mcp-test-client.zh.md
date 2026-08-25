# Agent Note: 共享的 MCP stdio 测试客户端；合并遗留的 all-tools 冒烟测试

[English](2026-08-25-shared-mcp-test-client.md) | 中文

Status: implemented

## Problem

九个脚本各自手写同一个 MCP-over-stdio 客户端——spawn node dist/index.js + 换行 JSON 的 id-map + 轮询定时器 call()，外加每个脚本自己的 assert/sleep。另外，test-mcp-tools.mjs 已经过时：EXPECTED_TOOLS 仍然列出已删除的 project_info，并且漏掉 10 个更新的工具，所以它永远以 1 退出；工具枚举已经由 test-mcp-offline 的 31-tool + no-project_info 断言负责。但 test-mcp-tools 是 11 个工具（五个 dota_api_* 查询、dota_dump_entities/modifiers、dota_entity_inspect、console_find/help/gui_filter）唯一的实机冒烟测试。

## Decision

scripts/lib-mcp.mjs 提供 spawnMcpServer({timeoutMs, env})，返回 { call, notify, kill }，外加共享的 assert/sleep，spawn 真实的 dist/index.js。九个 stdio spawn 位置全部导入它，它们手写的 spawn/map/call/assert/sleep 副本被删除（每个脚本的 timeout、env、断言和流程得以保留）。test-mcp-tools.mjs 被重写：EXPECTED_TOOLS 枚举和 MCP SDK 客户端导入已删除；它的 11 个实机冒烟调用运行在共享辅助模块上。test-relay.mjs/test-daemon.mjs 里定制的假 Dota 服务器不动。

## Alternatives considered

- **直接删除 test-mcp-tools.mjs。** 否决：它是 11 个工具唯一的实机覆盖；合并必须保留这些冒烟测试。
- **顺便抽出 fake-server/帧头构建器。** 否决：属于投机——每个假服务器断言不同的不变量；共享它们会削弱边界真实性。

## Consequences

一套接线实现服务九个脚本；11 个工具的实机冒烟覆盖在合并后得以保留；不再有任何脚本导入 MCP SDK 客户端。该辅助模块只替换每个脚本的接线——边界真实性（真实的 dist/index.js、定制的假服务器）不变。

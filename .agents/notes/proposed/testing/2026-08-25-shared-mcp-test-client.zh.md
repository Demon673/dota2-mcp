# Agent Note: 共享的 MCP stdio 测试客户端；合并遗留的 all-tools 冒烟测试

[English](2026-08-25-shared-mcp-test-client.md) | 中文

Status: proposed

## Problem

九个脚本各自手写同一个 MCP-over-stdio 客户端——spawn node dist/index.js + 换行 JSON 的 id-map + 轮询定时器 call()，外加每个脚本自己的 assert/sleep（test-mcp-offline:12、test-mcp-live:10、test-crash-recovery:20、test-launch-phases:11、带本地 mcpClient() 工厂的 test-multi-session:6、test-fileops:13、test-asset-inspect:90、test-vfx-live:10、drill-vfx-workflow:6）。另外，test-mcp-tools.mjs 已经过时：EXPECTED_TOOLS（:15-32）仍然列出已删除的 project_info，并且漏掉 10 个更新的工具，所以它永远以 1 退出；工具枚举已经由 test-mcp-offline 的 31-tool + no-project_info 断言负责。但 test-mcp-tools 是 11 个工具（五个 dota_api_* 查询、dota_dump_entities/modifiers、dota_entity_inspect、console_find/help/gui_filter）唯一的实机冒烟测试。

## Proposal

- 新增一个共享辅助模块（scripts/lib-ctrl.mjs 或新的 lib-mcp.mjs）：spawnMcpServer({timeoutMs}) 返回 { call, notify, kill }，外加共享的 assert/sleep，spawn 真实的 dist/index.js——边界真实性不变；该辅助模块只替换每个脚本的接线，正如 lib-ctrl 已经为控制端口所做的那样。
- 把 test-mcp-tools.mjs 里 11 个实机 API/转储/控制台冒烟测试折进一个基于该辅助模块维护的实机脚本；删除 EXPECTED_TOOLS 枚举（它的职责由 test-mcp-offline 承担）。
- 保持 test-relay.mjs / test-daemon.mjs 里定制的假 Dota 服务器不动（它们断言不同的不变量，是有意为之的离线边界）。

## Alternatives considered

- **直接删除 test-mcp-tools.mjs。** 否决：它是 11 个工具唯一的实机覆盖；合并必须保留这些冒烟测试。
- **顺便抽出 fake-server/帧头构建器。** 否决：属于投机——每个假服务器断言不同的不变量；共享它们会削弱边界真实性。

## Acceptance criteria

- 一个辅助模块服务全部九个 spawn 位置；11 个实机冒烟测试从合并后的脚本运行；EXPECTED_TOOLS 已删除；不再有任何脚本导入 MCP SDK 客户端。
- 所有离线测试通过；实机套件（运行时）通过。

## Risks

- 该辅助模块绝不能吞掉每个脚本的 timeout/idle-exit 预期：把 timeoutMs 参数化，并保留脚本自己持有的等待。

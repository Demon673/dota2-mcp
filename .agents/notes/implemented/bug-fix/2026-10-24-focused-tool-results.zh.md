# Agent Note: 聚焦的控制台与 API 工具结果

[English](2026-10-24-focused-tool-results.md) | 中文

Status: implemented

## Problem

活体工具审查发现，例行调用有几种方式会返回误导性结果或消耗过多的 agent 上下文：

- `script_help2`、`cl_panorama_script_help_2` 和 `dump_panorama_events` 忽略查询参数，返回完整转储。工具层把全部内容都返回了：一次 Lua 函数查询产出 454 KB，一次 Panorama 查询产出 310 KB。实体与修饰器转储也有同样的问题，而且修饰器工具默认使用庞大的客户端注册表，而不是活跃的服务端修饰器。
- 瘦客户端若在 Dota 已经发出 CHAN 帧之后才接入，则在下一个 CHAN 帧到达之前没有任何通道名，所以 `console_channels` 是空的。
- `dota_run_lua` 把每个表达式都交给 `DeepPrintTable`，而它不接受数字、字符串、布尔值和 nil。它的示例引用了一个不存在的 API。`dota_api_help` 宣传全局函数，尽管 `script_help` 接受 scope。`vfx_preview_stop` 会打印 `ok=nil`，因为 `ParticleManager:DestroyParticle` 返回 void。

## Decision

- `filterDumpBlocks` 解析观察到的引擎格式：以 `---[[ <symbol>` 开头的 Lua 条目、以 `=== <name> ===` 开头的 Panorama/CSS 块，以及以 `| <code>event(…)</code>` 开头的事件行。符号或 class 成员的精确匹配优先；都不存在时，返回大小写不敏感的子串匹配结果。无匹配的查询返回一条简短消息，绝不返回完整转储。省略查询参数会有意保留完整转储。事件表的分隔行会被移除。
- `dota_dump_entities` 与 `dota_dump_modifiers` 接受大小写不敏感的子串 `filter`。修饰器工具默认 `side: "server"`；`side: "client"` 仍返回已注册类型列表。
- 守护进程在 `hello-ok` 中带上当前通道列表，`RelayClient` 在握手时保存这份快照。之后到达的 `chan` 广播仍会替换它。
- 表达式求值会保存结果值，只对表使用 `DeepPrintTable`，其他值则带 `[MCP-LUA]` 前缀打印。工具描述以 `GameRules:State_Get()` 作为表达式示例，把 `dota_api_help` 描述为 class/scope 检查，并说明服务端执行 Lua 需要 `sv_cheats=1`。
- `vfx_preview_stop` 报告销毁已执行，不再凭空编造一个布尔返回值。

## Alternatives considered

- **每个查询都用子串匹配。** 否决：精确的函数或事件查询也会返回名字相近的条目，例如 `CreateUnitByNameAsync` 或 `SetChildPanelsSelected`。对于部分名称和带前缀的 Panorama class，子串匹配仍作为回退。
- **把完整转储截断到固定行数。** 否决：请求的条目可能出现在任何位置，任意截断并不能保证结果有用。
- **在每次 Lua 调用前后自动开启 `sv_cheats` 并在之后恢复。** 未实现：`RunScriptCode` 要到后续帧才执行，游戏挂起或客户端被杀都会导致无法恢复，关闭 cheats 会重置 cheat cvar，而且 addon 也可能有意强制 `sv_cheats=0`。开发用 addon 可以改为在 tools 模式下允许 cheats。

## Consequences

聚焦查询只返回相关条目，晚接入的 MCP 会话也可以立即用通道名进行 `console_output`。引擎仍会在过滤之前把完整 API 转储发送到本地 relay，因此过滤减少的是 agent 上下文，而不是引擎工作量或收集时间。部分名称的查询可能返回多个条目。修饰器工具的默认值是有意做成不同的；需要客户端注册表的调用方必须显式请求它。

## Testing

- `scripts/test-collect-output.mjs` 在假引擎边界提供逼真的 Lua、Panorama、CSS、事件、实体与修饰器转储，同时忽略查询参数。它经真实的 MCP 服务器断言精确匹配与 class 过滤、未知名称不回退到完整转储、大小写不敏感的转储过滤、修饰器的服务端默认值、标量表达式输出，以及粒子停止输出不含 `ok=`。
- `scripts/test-relay.mjs` 从假 Dota 发送一个结构化 CHAN 帧，在注册之后再接入真实的 `RelayClient`，并断言它初始的通道列表已经包含 `VScript`。
- 变更后 `npm run check`、`scripts/test-relay.mjs` 与 `scripts/test-collect-output.mjs` 均通过。

活体（Dota 2 带 `-tools`，地图已加载）：新接入的瘦客户端列出了 `VScript`。Lua 函数查询返回 9 行，不含 `CreateUnitByNameAsync`；`GameUI` 查询返回它的 210 行 class 区块，不含 `GameEvents`；CSS 与事件查询分别返回 2 行和 3 行。数字与字符串表达式都打印了值，实体与修饰器过滤返回匹配行，修饰器默认列出 9 条服务端生效条目，粒子停止输出不含 `ok=`。后来的自定义光晕返回非零 PID，出现在截图中，并在 `vfx_preview_stop` 后消失。手动的保存 → 开启 → 执行 → 恢复 `sv_cheats` 实验在正常执行和 Lua 报错两条路径也都通过并恢复原值；这并不改变不自动切换的决定，因为崩溃或永久卡死仍可能阻止恢复。该实验在 tools 模式下完成。另一次验证 addon 非 tools cheats 守卫的尝试未能在 29000 建立 VConsole 监听，因此该守卫仍未验证。

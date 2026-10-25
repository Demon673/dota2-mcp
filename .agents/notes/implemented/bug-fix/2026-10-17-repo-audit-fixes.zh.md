# Agent Note: 全仓审计修复

[English](2026-10-17-repo-audit-fixes.md) | 中文

Status: implemented

## Problem

一次全仓审计发现了一批缺陷，它们要么静默给出错误结果，要么削弱信任边界：

- `file_edit` 把 `new_string` 作为字符串传给 `String.replace`，于是 `$'`、`$&`、`$1` 会被展开。把一行替换成 `t = '$' + g;`，会把文件剩余部分写进这一行中间。
- FileOps 边界用 `addon` 参数拼出来，却没校验它。传 `addon: "../../.."` 时，允许的根变成了 Dota 安装目录的上一级。
- VConsole2 文本按 `ascii` 编解码。Node 解码 `ascii` 时会清掉最高位，所以中文 `print` 输出和经 `dota_run_lua` 发送的非 ASCII Lua 都会被破坏。
- `status_json` 没有回应时，`queryStatusJson` 回落到 `prntLog.slice(-0)`，也就是整个日志，解析出几分钟前的过期状态。
- 本地降级 relay 在 `:29002` 监听但不设 token，本机任何进程都能发 `CMD:`（`RunScriptCode` 即代码执行）。
- `collectOutput` 收集时间窗口内的所有 PRNT 行，于是共享守护进程的其他会话的输出、以及游戏自身的打印都会落进工具结果。
- VRF 失败被报告为成功：`asset_inspect` 对错误文本做摘要（全为 0），`asset_check_refs` 对打不开的资产报 `checked: 0` 且无损坏项。
- 较小的缺陷：已加载其他地图时，`dota_launch_game` 不发启动命令。被取代的 vconsole socket 的 `close` 会清掉在线 GUI 的状态。在两个标记之间切换 MCP 屏蔽，会让 GUI 一直静默。Linux/macOS Steam 路径里的 `~` 从未被展开。`prepack` 不编译。

## Decision

- `file_edit` 传 `() => new_string`，替换文本按字面写入。
- `src/index.ts` 的 `requireAddon()` 是 FileOps 与资产工具共用的唯一 addon 解析入口。它拒绝 `.`、`..`，以及任何含 `/`、`\` 或 `:` 的名字。
- `vcon-bridge.ts` 按 UTF-8 读写 PRNT 与 CMND 文本，与 CHAN 名称已经使用的编码一致。
- `queryStatusJson` 即 `extractLastStatusJson(collectOutput("status_json", …))`。它只解析本次命令窗口内的输出，没有输出时返回 `null`。
- 降级 relay 调用 `setExpectedToken(ensureToken())`，执行与守护进程相同的握手。
- `collectOutput` 把 `echo __mcp_<id>_begin; <cmd>; echo __mcp_<id>_end` 作为一个 CMND 发出，其他会话的命令插不进来，只保留两个标记之间的行。收到结束标记即返回；把输出推迟到 echo 之后的命令会被截断。`ent_fire … RunScriptCode` 就是这类命令（下一帧才执行），所以 `collectLuaOutput` 让 Lua 自己打印结束标记，并统一承担三个 Lua 工具原先各自做的双引号转义。结束标记一直不到时（例如用户 Lua 报错），以 `settleMs` 兜底。`MCP_MARKER_RE` 与 `newMcpMarkers()` 是标记格式的唯一定义；`prntLog` 丢弃与之匹配的行。Lua 输出如何不进 vconsole 窗口、以及控制台语句的长度上限，见[推进到可玩对局的标准流程](../feature/2026-10-17-advance-to-game.md)。
- VRF CLI 失败、或反编译根资产抛错时，资产工具返回 `ok: false`。反编译成功但文本为空不算失败。
- `RelayClient` 丢弃断线期间发送的命令，不在重连后补发。`requireConsole` 已在断线时拦下调用，而补发一条过期的 `restart` 比丢掉它更糟。
- 除非正在加载、或请求的地图已经加载，`dota_launch_game` 都会发出启动命令。`status_json` 报告的是裸地图名（`my_map`）。比较时两侧都去掉目录和 `.vmap`/`.vpk` 扩展名并转小写，名字里带点的地图不会被截断。
- `_onGuiConnect` 会销毁之前的 GUI socket；socket 被更新的连接取代后，它的 `close` 处理不再做任何事。`setMcpSuppressEnabled` 会重置标记状态。
- Steam 检测去掉 `find-steam-app`（按它自己的注释，它在当前 `libraryfolders.vdf` 格式上抛错）。Linux/macOS 默认根用 `os.homedir()` 拼接。`prepack` 运行 `npm run build`。

## Alternatives considered

- **转义 `new_string` 中的 `$`**，而不是用替换函数。否决：函数形式是让替换文本按字面写入的标准做法，不需要任何转义规则。
- **只按时间关联输出，缩短静默窗口。** 否决：它无法区分在同一窗口内到达的、来自其他会话的行。
- **Lua 类工具也用单个结束 echo。** 否决：`ent_fire` 把执行推迟一帧，结束 echo 会先于 Lua 输出到达，把它截掉。
- **保留重连补发缓冲，但缩短保留时长。** 否决：工具层已经按连接门控，这个缓冲只会补发时机已过的命令。

## Consequences

收益：文件编辑按字面写入，FileOps 无法借 `addon` 参数离开 addon，非 ASCII 控制台文本双向保真，工具结果只含发起命令的输出。代价：每次控制台类工具调用多发两条 `echo`；关闭 MCP 屏蔽时，标记会出现在 vconsole GUI 里。如果用户 Lua 以 `--` 行注释结尾，注释会吞掉追加的结束标记 `print`，该次调用退回 `settleMs` 兜底。

## Testing

- `scripts/test-collect-output.mjs`（新增，离线）运行一个假 Dota（在 `begin` 之前和 `end` 之后注入噪声行）加一个假 GUI。它断言 `dota_api_css` 只返回窗口内的那一行、UTF-8 文本完整解码、标记既不出现在结果里也不出现在 `console_output` 里。
- `scripts/test-collect-output.mjs` 还断言中文 `console_send` 命令以完整的 UTF-8 到达引擎。
- `scripts/test-relay.mjs` 用假控制端断言：`RelayClient` 断线期间发送的命令在重连后不会到达，重连后发送的命令会到达。
- `scripts/test-fileops.mjs` 搭一个最小 Steam 库并把 `STEAM_PATH` 指向它，在没有 Dota 的 runner 上也能跑；经注册表找到的真实 Steam 安装仍然优先。它断言 `$'` 与 `$&` 按字面写入，且 `addon` 取 `..`、`../..`、`<addon>/../..` 时被拒绝。
- `scripts/test-asset-inspect.mjs` 与 `scripts/test-asset-check-refs.mjs` 断言失败路径。它们在 win32 上跳过，所以 Windows 上的失败路径是用替身可执行文件手工验证的。

活体（Dota 2 带 `-tools`，一个 addon）：中文文本经 `echo` 与 `dota_run_lua` 往返无损。`status_json`、`script_help2`（3,537 行）、`find`、`dump_panorama_css_properties` 的输出全部落在两个标记之间，结束标记之后没有输出。`dota_launch_game` 能从菜单启动；地图已加载时，传 `MY_MAP.vmap` 不会重新启动。`dota_run_lua` 经结束标记约 30 ms 返回，Lua `error()` 退回 `settleMs` 兜底，traceback 完整。

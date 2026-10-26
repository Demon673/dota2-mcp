# Agent Note: Panorama 调试器检视与多根访问

[English](2026-10-26-panorama-ui-control.md) | 中文

Status: proposed

## 问题

HUD 桥（见[已实现 note](../../implemented/feature/2026-10-26-panorama-bridge-and-input.md)）只覆盖 HUD 顶层窗口。引擎的 Panorama 调试器暴露每个面板的位置、class、属性和样式，它的 JavaScript 控制台能在选中面板的上下文里执行代码，但检视数据只以文本渲染，同级的其他顶层窗口（dashboard、调试器）又有独立的 JavaScript 上下文。agent 仍然无法检视这些根、以机器可读方式读取检视器的树/样式，也无法判断调试器辅助路径是否值得它带来的脆弱性。

## 方案

### 调试器驱动的检视

- 不用热键打开调试器：`panorama_dispatch_event CreateDebuggerWindow()`；不需要游戏前台。控制台仍要求选中一个具备 JavaScript 上下文的面板，并在调试器持有前台时键入文本；单槽缓存让控制台只能当退路，不是主路径。
- 事件字符串使用 `Name(args...)`，字符串参数用单引号；`panorama_dispatch_event` 创建的 event 没有 creating panel，所以 `TextEntrySetText` 对控制台输入是 no-op。
- 检视器只把数据渲染成文本。机器可读的回读需要另一条通道（剪贴板、调试器日志或其他引擎钩子），这条通道决定调试器工具是否值得发布。
- 控制台的粘贴上限在 128 字符附近，第一段编译成功的脚本在整个进程内被缓存；一次杂项提交就可能污染它直到下次重启 Dota。走这条路径的工具必须自己完成首次提交，或检测到陈旧缓存。

### 多根访问

- 桥只能到达 `DotaHud`，再往上没有：`DotaHud.GetParent()` 为 null，从桥里调用 `RunScriptInPanelContext` 会因 domain 不匹配被拒绝，活体 JavaScript API 也没有 `GetRootPanel`/`GetAllPanels`。同级顶层窗口有独立上下文。
- 在调试器辅助的逐根上下文桥与接受 HUD 边界之间做决定；用具体的同级 id 验证（`MCP.select('#Dashboard')`/`#DashboardCenter` 从 HUD 根返回 null，而 dashboard 布局仍在布局缓存里）。

### 桥生命周期加固

- 已交付的桥仍需要：进程被杀后的失败供给清扫、一次完整 Dota 进程重启/缓存清空的实测矩阵，以及大结果/分块边界。
- 投喂的 JavaScript 受 `dota_run_lua` 语句上限约束（包装后约 510 字节，约 300 字节 Lua）；更长的代码需要事件分块加客户端重组、客户端读取文件，或另一座桥。
- 进程布局缓存按资源路径做键，同一路径上的桥版本可能继续提供旧源码；决定桥版本变更是否需要新路径，或每个游戏进程只用一个版本。

## 实测行为

以下均在 `-dev -tools` 会话中实测；除特别说明外，每条结论都来自运行中的引擎。桥与输入的实测已移入已实现 note。

- 调试器是 Dota 进程内的第二个顶层 `SDL_app` 窗口，标题为 `Panorama Debugger`，没有子窗口。
- `panorama_toggledebugger_mode` 是隐藏 ConVar，帮助文本为 "Toggledebugger key operation : 0 = open/inspect, 1 = open/close"；在活体会话里设置它既没有创建也没有关闭窗口。真正起作用的是引擎的调试器热键：`Dota 2` 窗口处于前台时，合成的 F6 能创建 `Panorama Debugger` 窗口；`WM_CLOSE` 关闭后，再次 F6 会重新创建。
- `panorama_dispatch_event CreateDebuggerWindow()` 也能创建调试器：窗口出现后，`panorama_print_cache_status` 里出现 `panorama/layout/debugger.xml (87 refs)`；`PrintWindow` 截到了空白检视器和它的 JavaScript Console 输入框。打开它不需要热键或游戏前台。
- ConVar 的两个模式与帮助文本一致。设为 `1`（open/close）时，F6 打开带内容的检视器：树、样式面板和 context 行都是活的——点击树行会切换选中项，检视按钮加点击游戏小地图选中了 `DOTAMinimap#minimap`，搜索框和控制台输入框都能接受键入。设为 `0`（open/inspect）时，F6 打开的是空白窗口，对同样的点击和按键没有反应。更早观察到的空窗口就是这个模式，不是窗口坏了。
- 只有当调试器窗口真正持有前台时，键入 JavaScript 控制台才有效。每条提交的行都会回显；调用在进入 V8 之前返回时，回显后面会跟一个 `1`；真正执行时，回显后面是脚本自己的输出，不再出现 `1`。
- 当选中的面板属于具备 JavaScript 上下文的布局时，控制台会执行。一个最小的 addon 自定义 UI（`custom_ui_manifest.xml`、带 `<scripts>` 的布局和一个 JS 文件）经 `resourcecompiler` 编译后在游戏里加载；`$.Msg("MCP_UI_TEST_LOADED")` 到达了 `PanoramaScript` 通道。调试器的检视点击选中 `#McpUiTestLabel` 后，提交 `McpUiTestPing("HELLO123")` 真的执行了：标签文本变成 `PING HELLO123`，`MCP_UI_TEST_PING HELLO123` 出现在 `PanoramaScript` 上。基础游戏的 dashboard 布局也提供了可用的上下文，所以只要有 JavaScript 上下文的布局就够了；addon UI 只是本次测试方便使用的载体。
- 顶层边界已实测：`DotaHud.GetParent()` 返回 null；从桥里对 `DotaHud` 调用 `RunScriptInPanelContext` 抛出 `RunScriptInPanelContext must be called from a context with a domain that matches this panel`；活体 `$` API 没有根访问器；dashboard 布局仍在布局缓存中时，`MCP.select('#Dashboard')`/`#DashboardCenter` 从 HUD 根返回 null。因此桥覆盖的是 HUD 顶层窗口，不是同级的其他顶层窗口。
- 控制台会在整个客户端进程范围内缓存第一段成功编译的脚本。之后的每次提交——无论文本不同、面板不同、上下文不同——都重跑第一段脚本，而不是编译新输入；缓存键是固定的源名 `JSConsoleInput`。整张地图重载创建了新上下文（调试器的 context 指针变了，布局的 `$.Msg` 也重跑了），缓存的脚本仍然执行；在 dashboard 上下文里它抛出了 `Uncaught ReferenceError: McpUiTestPing is not defined`。
- 关闭再打开调试器窗口、`hud_reloadscheme`、地图重载都不会清掉缓存；只有重启 Dota 进程才会。控制台命令列表里也没有重置入口：`find panorama`、`find reload`、`find lrucache`、`find v8` 和 `find script` 都没有脚本缓存命令，`lrucache_flush` 只覆盖资产缩略图和词过滤缓存。
- 运行时失败会在调试器和引擎控制台打印：`JS Exception! *** Skipping rest of script ***`、`JSConsoleInput` 源名与行号、脚本正文和堆栈；`PanoramaScript` 在 verbosity 3 上带同样的文本。具备 JavaScript 上下文的场景里没有制造出编译失败，因此编译错误的输出尚未验证。
- 控制台输入是一个 Panorama TextEntry，不是普通编辑框。窗口在前台时剪贴板粘贴可用；`Ctrl+A` 不会选中已有文本（多次粘贴会追加）。TextEntry 会丢弃过长的粘贴：113 字符的脚本能进去，133 字符的被静默丢弃，所以实际上限在 128 附近；109 字符的桥可以放下。多段粘贴不可靠。调试器窗口有时会以空树和空样式面板打开；让游戏窗口保持前台打开它、用检视点击选中面板、再关闭重开一次，就能得到有内容的检视器。
- 即使模式是 `1`，只要窗口打开时焦点在初始化期间移走，树和样式面板也可能是空的；窗口会保留之前做过的选中项，关闭重开就会填充。
- `1` 确认不是执行结果；成功执行要通过副作用（面板变化）和 `PanoramaScript` 上的 `$.Msg` 输出来观察。
- 调试器窗口会忽略 `WM_CHAR` 和 `SendMessageTimeout` 投递的文本。窗口处于前台后 `SendKeys`/`SendInput` 可用；从助手进程执行 `AttachThreadInput` + `BringWindowToTop` + `SetForegroundWindow` + `ShowWindow` 序列可以成功取得前台。
- `panorama_dump_symbols <type>` 在活体可用：`0` 打印 14,471 条事件符号（`MoveUp`、`JSScheduledFunction`、`ReloadChangedUIFiles` 等），`1` 打印 581 条文件符号；其他类型值都只打印用法行。
- `panorama_print_cache_status` 打印布局缓存摘要（267 个布局，带引用计数）。`panorama_print_render_tree` 是字符串 ConVar——"Print the RenderOperation_t tree for the given root window; set to * to print all"——但活体里 `*`、`Dota` 和 `dota2` 都没有任何输出。
- `panorama_dispatch_event` 从参数字符串创建事件并在没有 creating panel 的情况下派发。可接受的语法是 `EventName(args...)`；解析器要求 `(`，在符号表里查事件名，并在嵌套括号之外按逗号切分参数，字符串用单引号。`CreateDebuggerWindow()` 打开了调试器；扁平名字、花括号形式和没有 creating panel 的 `TextEntrySetText(...)` 都没有产生可观察到的事件效果。
- `cl_script_reload_code <name>` 执行 `{addon}/game/scripts/vscripts/` 里的客户端 VScript Lua 文件（`CL_VM_OK`）。该挂载之外的外部路径失败，报 "type does not match VM type"；缺扩展名时会按 `.lua` 查找。客户端 VScript 暴露 154 个函数，包括 `SendToConsole` 和 `DoIncludeScript`，但没有 Panorama 或 JavaScript 入口。

## 引擎接口

桥侧的 `RunScriptInPanelContext`/`CustomUIManager` 接口记录在已实现 note 里；以下是调试器侧的事实。

- `panorama_dispatch_event` 以空的 creating panel 调用 `CUIEngine` vtable 槽位 `+0x330`（`CreateEventFromString`），再经 vtable 槽位 `+0x178` 派发创建的事件。解析器读到第一个 `(` 为止作为事件名，在符号表里查找，再按顶层逗号切分参数，处理嵌套括号和单引号字符串。
- 调试器的控制台提交实现在 client.dll（`CPanoramaClientDebugger`）里，不在 panorama.dll：一个针对 `JSConsoleInput` 文本框 `TextEntrySubmit` 的原生处理器会以选中面板的上下文、输入文本和源名 `JSConsoleInput` 调用 `CUIEngine::RunScript (compile+run)`——UIEngine vtable 槽位 `+0x268`。这个固定源名同时是缓存键：第一段编译成功的脚本会被之后每次提交复用，因此控制台每个进程只运行一段脚本。
- `CUIEngine::RunScript` 通过 `GetContextForPanel` 解析 V8 上下文；解析不到时（没有 JavaScript 上下文的布局）直接静默返回；对具备 JavaScript 上下文的布局则编译并运行文本。只有 `RunFunction` 会把结果（`=> value`）经 `JSConsoleOutput` 打印出来；控制台的 `RunScript` 路径不打印返回值，因此结果要通过副作用和 `$.Msg` 观察。`GetContextForPanel` 会复用按面板缓存的上下文，或新建一个 V8 上下文，并对带特定标志的面板有一条提前返回 null 的路径。
- 二进制字符串还暴露了 `JSConsoleOutput`、`ToggleDebugger` 和 `CreateDebuggerWindow`；它们是注册的 Panorama UI 事件 schema。`CreateDebuggerWindow` 可以经 `panorama_dispatch_event` 派发；调试器热键对应 `CDebuggerInputHandler` 类，绑定 `PanoramaDebuggerHotkey`。
- 调试器布局里的 JavaScript 处理器（`PrevSearch`、`UpdateJSConsolePriorHistory`）只以事件表达式出现在 `panorama/layout/debugger.vxml_c` 中；原生提交处理器和 `JSConsoleInput`/`JSConsoleText` 绑定编译进了 client.dll。

## 待解问题

- 剩余的桥加固：进程被杀后的失败供给清扫、一次完整 Dota 进程重启实测，以及大结果/分块边界。桥靠 ping 识别，而不是一次性的 `MCP_BRIDGE_READY` 标记。
- 更长的投喂代码怎么传输：拆分多个事件并由客户端重组、客户端读取文件，还是专用桥？当前事件受 `dota_run_lua` 语句上限约束。
- 能否不经焦点把 `TextEntrySetText` 或 `TextEntrySubmit` 派发到指定面板？`panorama_dispatch_event` 创建的 event 没有 creating panel，这种形式对调试器输入是 no-op；另一条事件路线或原生提交路径能从退路里去掉焦点/键入步骤。
- 调试器渲染出来的检视数据（树、样式面板、context 行）能否通过剪贴板或引擎钩子以机器可读的方式取回，而不做 OCR？
- 控制台能否在不取得前台的情况下操作？投递消息会被忽略，所以目前的答案是不能。
- 调试器辅助的逐根上下文是否可达，还是 HUD 边界就是最终结论？活体 API 没有根访问器，这需要具体的同级窗口实验。

## 备选方案

- **把调试器控制台当作主执行路径。** 否决：它需要前台键入、具备 JavaScript 上下文的选中面板，以及进程级单槽脚本缓存。已交付的桥接过了这个角色（见已实现 note）。
- **调试器辅助的逐根上下文桥。** 待定：桥无法到达同级顶层窗口，调试器能跨根选中面板，但读取它的结果与键入仍是未解问题。
- **接受 HUD 边界。** 没有机器可读检视通道时的退路；这会留下 dashboard/调试器根无法检视。
- **截取调试器的输出面板再做 OCR。** 否决：如果控制台或事件通道能带回结果，这条路径脆弱、慢且完全不需要。
- **通往同级根的原生路径。** 未验证：活体 `$` API 没有根访问器；二进制层钩子比调试器路线的投入大得多。

## 验收标准

- 对多根访问做出明确决定，并用具体的同级顶层窗口验证。
- 如果发布调试器工具，检视结果必须机器可读且不依赖 OCR；控制台缓存与前台键入必须被处理或显式限定。
- 记录剩余的桥生命周期矩阵：失败供给、一次完整 Dota 进程重启，以及大结果处理。

## 风险

- 调试器及其控制台是未文档化的引擎工具；一次更新就可能改掉窗口标题、命令或 JavaScript 绑定。脚本缓存是实测出来的、与版本相关的行为，因此依赖控制台前每个引擎版本都要重新实测。
- 进程级单槽缓存让调试器退路很脆弱：任何一次杂项提交——包括开发者手动输入的 `$.Msg(1)`——都会占住它直到下次重启 Dota。依赖这条退路的工具必须自己完成首次提交，或检测到陈旧缓存并要求重启。
- 调试器退路的监听器会随布局的 V8 上下文在地图重载时销毁；重新武装意味着在具备 JavaScript 上下文的场景里再提交一次。工具必须处理这个循环，或接受重载后退路失效。
- TextEntry 会丢弃超过约 128 字符的长粘贴，而且控制台只在持有前台时接受输入。
- 多根访问可能离不开前台输入，而原生钩子的面远大于桥。

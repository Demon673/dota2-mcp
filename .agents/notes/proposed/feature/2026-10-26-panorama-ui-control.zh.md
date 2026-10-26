# Agent Note: Panorama UI 控制与 JavaScript 执行

[English](2026-10-26-panorama-ui-control.md) | 中文

Status: proposed（桥与 `dota_input` 已实现；调试器/多根和剩余生命周期加固未完成）

## 问题

MCP 现在能运行服务端 Lua、能读 VCon 控制台，却看不见也操作不了客户端 UI。agent 无法回答某个位置是哪个面板、面板的边界与可见性如何、某个按钮怎么点——这些都要靠人。于是服务端 Lua 验证不了的 UI 工作被卡住，任何视觉回归闭环的交互部分也做不了。

Panorama 调试器是引擎自带的 UI 检查器：它暴露每个面板的位置、class、属性和样式，其中的 JavaScript 控制台能在选中面板的上下文里执行代码。把它和现有 VCon 通道合起来，就有机会在不改 addon 的前提下覆盖大部分游戏内观察与操作。用户的约束是尽量不占用其输入；只有在确实没有后台路径时，才接受一次有边界、会还原的短暂焦点接管。

## 方案

执行路径先定，检视和 OS 输入随后。

### 第 0 层：临时供给的动态 HUD 桥（已验证）

- 注入点在服务端 Lua：`CustomUI:DynamicHud_Create(PlayerID, ElementID, LayoutFileName, DialogVariables)` 从布局创建一个 HUD 元素，客户端加载该布局并在新的 JavaScript 上下文里运行它的 `<scripts>`。
- 桥的源文件放在 MCP 服务端，而不是 addon 里：一份布局 XML，加一个通过 `<scripts><include src="file://{resources}/layout/custom_game/<bridge>/<bridge>.js" /></scripts>` 引入的 JavaScript 文件。官方布局文档描述了内联 `<script>` 块，但当前即时编译器在活体里拒绝它：“`<script />` tags within XML files are no longer supported. Please create a separate script file that is included via an `<include />` in the `<scripts />` section.”因此桥是两份源文件，作为一个整体复制和删除。
- 供给流程是复制 → 引擎编译 → ready → 删除（主路径）。两份源文件复制到 `{dota2Path}/content/dota_addons/<addon>/panorama/layout/custom_game/<bridge>/`；`DynamicHud_Create` 让引擎即时编译到 addon game 树；`MCP_BRIDGE_READY` 出现在 `PanoramaScript` 后，删除源文件副本和两份编译产物。进程级布局缓存维持运行中的桥。不留下 addon 源文件，也不创建 junction：在开发者的 content 目录 junction 下，文件只在复制/编译/删除窗口内出现在仓库里。Dota 重启或缓存丢失后重新供给；地图重载只需重建 HUD。
- addon 只读或引擎不支持源文件即时编译时的已验证替代：
  - **基座游戏松散资源：** 把编译产物复制到 `{dota2Path}/game/dota/panorama/layout/custom_game/<bridge>/`。加载器会在基座游戏里查找已编译的松散资源，但不会即时编译基座游戏的源布局 XML。
  - **addon 游戏目录 junction：** 把 `{addon}/game/panorama/layout/custom_game/<bridge>` 建成指向外部编译目录的目录 junction。不写 Dota 安装；链接位于 addon 的 game 树里。目录 junction 不需要管理员权限或开发者模式，可跨本地 NTFS 卷使用，要求目标目录先存在，并且可以跨 Dota 重启一直挂着。
  布局路径必须是资源相对路径（`file://{resources}/layout/custom_game/<bridge>/<bridge>.xml`）。绝对路径会被拒绝，任何 `..` 段都是致命错误。
- `DynamicHud_Create` 加载编译布局并运行它的 JS。JS 订阅服务端自定义事件并调用 `<panel>.RunScriptInPanelContext(d.code)`；服务端用 `CustomGameEventManager:Send_ServerToAllClients` 投喂任意 JavaScript。不需要调试器输入、单槽缓存或焦点接管。
- 布局加载后，删除源文件和编译产物不会停止桥：客户端进程级布局缓存维持它（已验证：删除暂存文件后 `13579`；Dota 重启会清空缓存）。桥的上下文和监听器在 `DynamicHud_Destroy` 或地图重载时销毁；再次 `DynamicHud_Create` 重建（可能直接命中缓存），Dota 重启后重新供给。清理扫描处理供给失败或 MCP 进程被杀的情况，确保没有桥文件残留。
- 退路 A 是 addon 内的桥布局（源文件在 addon content 里，由引擎即时编译或用 `resourcecompiler` 编译），保留给显式 opt-in 的开发场景，以及临时复制被阻止的环境。退路 B 是第 1 层的调试器单槽引导，用于两种桥都不可用时。

### 桥协议与生命周期

- **身份与命名。** 随机 128 位 token 只生成一次并随守护进程状态保存，用来命名每个事件、元素 id 和资源目录：`d2mcp_<token>_<generation>_exec`、`..._ack`、`..._ping`、`..._pong`；元素 id 和目录使用 `d2mcp_<token8>_<generation8>`。generation 对桥源码、协议版本和 helper API 做哈希，因此新桥版本使用新名字，不会与游戏事件、其他 addon 或缓存的旧布局冲突。
- **请求/确认。** 客户端桥用 pong 回应 ping，用两个 ack 回应 exec：编译执行前发 `started`，结束后发 `done`，载荷为 `{id, phase, ok, result|error, logs}`。客户端用 `GameEvents.SendCustomGameEventToServer` 发 ack（已活体验证）；服务端用 `CustomGameEventManager:RegisterListener` 注册的监听器把 ack 存进 Lua 表并打印带 token 前缀的行。MCP 工具在控制台流里按 id 和 phase 匹配；Lua 可以异步查看这张表。
- **Lua 不能阻塞。** 服务端 Lua VM 和客户端 JavaScript VM 是分开的；`Send_ServerToAllClients` 在客户端执行前就返回。Lua 通过监听器回调和 ack 表得知结果；真正等待控制台标记并决定是否重建的是 MCP 工具。同步的 Lua 返回需要协程/定时器，而且没有必要。
- **Ensure 是幂等的。** 每次 exec 前，工具先安装服务端监听器（用 token 命名的全局变量防重复），再 ping 桥；pong 的 generation 匹配就复用。没有 pong 时先尝试从进程缓存 `DynamicHud_Create`；只有缓存未命中才复制两份源文件、让引擎编译、等 ping 成功，然后删除源码和编译产物。供给由守护进程/共享锁串行化；状态文件记录 token、generation、Dota 进程/地图键和元素 id。
- **失效与重建。** 状态键包含 Dota 进程启动时间、地图、addon 和 generation。`dota_restart`、地图重载、Dota 崩溃/重启、`DynamicHud_Destroy` 或 ping 失败都会使客户端 HUD 失效；下一次 exec 重新安装监听器、尝试缓存、必要时重新供给。编译或加载失败会返回控制台错误并清理临时文件。
- **不盲目重试 exec。** exec 可能有副作用。缺少 `started` ack 说明事件没到桥，可以安全重试；有 `started` 但没有 `done` 时返回 `exec_incomplete`，不重复执行。桥在 HUD 生命周期内按请求 id 缓存 ack，重试同一个 id 会返回缓存结果而不是再次执行。
- **通用 JavaScript 接口。** 桥预定义 `MCP`：`top`、`select`、`$`、`context`、`locate`、`panel`、`text`、`cls`、`style`、`visible`、`snap`、`log`、`help`（第一片；`tree`/`click` 等面板 API 验证后再加）。包装器把提交的代码放进带 `try/catch` 的函数并自动返回其值，所以模型写 `MCP.text('#Label', 'Hi'); return MCP.snap('#Label')` 这样的短表达式，而不是重复面板查找和 `$.Msg`。桥运行在自己的动态 HUD 布局上下文，不是 addon 自定义 UI 的 JS 上下文：addon 定义的全局变量不在作用域内，标准引擎全局变量以及可达面板实例上的方法和属性可用。原生 `$`/`$.FindChildInContext` 只在桥布局内解析；`MCP.select('#id')`/`MCP.$('#id')` 从最外层面板（`MCP.top()`，实测为 `DotaHud`）用 `FindChildTraverse` 加有界子节点遍历搜索，可选的第二个面板参数用于限定范围；`MCP.panel` 以及 text/visible/cls/style/snap 都使用这个全局选择器。`MCP.context()` 报告根面板、最外层、父链、存在哪些标准全局变量以及区域提示。 已交付的 helper 还包括几何（`MCP.rect`/`center`/`isVisible`/`panelAt`）、世界与光标转换（`MCP.cursor`/`entitiesAt`/`worldToScreen`/`screenToWorld`）、游戏状态（`MCP.units`/`unitInfo`/`selection`/`selectUnit`/`selectAllUnits`/`camera`/`order`），以及上面的后台事件 helper；活体检查覆盖可见 panel 的几何、世界坐标到屏幕的往返、英雄选择、镜头状态读取和一条无害的 stop 命令。helper 还包括 `map()`（锚点、标签、当前 HUD/custom UI 区域）、`children(sel)`（一层子节点）、`customUi(sel?)`（锚定 `CustomUIRoot`，addon UI 最常用入口）和 `hudElements(sel?)`（锚定 `HUDElements`）；锚定搜索在锚点或面板不存在时返回 null，不会退回整个 HUD。后台事件驱动覆盖引擎无需 OS 输入即可引发的事件：`focus(sel)`/`blur(sel)`（`SetInputFocus`/`DropInputFocus`）、`selectPanel(sel, selected?)`（`TogglePanelSelected`/`SetPanelSelected`）、`setValue(sel, value)`（在 slider 上触发 `onvaluechanged`）、`setText(sel, text)`（在文本框上触发 `ontextentrychange`）；`dispatch(event, sel, ...args)` 转发 `dump_panorama_events` 列出的任意引擎事件，`on(sel, event, fn)`/`emit(sel, event, ...args)` 注册并直接调用通过桥挂上的 handler。活体实测：`SetInputFocus`/`DropInputFocus` 触发 `onfocus`/`onblur`，`TogglePanelSelected` 在选中时触发 `onselect`（取消选中可能不触发），slider 值和文本框文本的 setter 触发各自的变更事件，且游戏不在前台也能工作。普通 `Button` 接受 `SetPanelSelected(panel, true)` 但不会触发事件；后台 `onselect` 的可靠路径是 `TogglePanelSelected`。`$.DispatchEvent('onactivate')` 和所有 `onmouse*` 名称都会以 `Invalid event name` 被拒绝，所以按钮激活和 hover 仍需要真实输入或 addon 测试钩子；`emit` 只覆盖通过桥注册的 handler。桥的可达范围止于自己所在顶层窗口的根：其他顶层窗口有独立的 JS 上下文，活体 API 不提供 `GetRootPanel`/`GetAllPanels`；`DotaHud.GetParent()` 为 null，从桥里对 `DotaHud` 调用 `RunScriptInPanelContext` 会因 domain 不匹配被拒绝。要访问其他根，需要调试器或原生路径。新 UI 可以用 `$.CreatePanel('Panel', MCP.top(), '<id>')` 创建，位于 HUD 窗口根下、与引擎 HUD 根 `Hud` 同级；这不会创建新的顶层窗口，已有引擎面板不能重新挂父。每个 helper 上线前都做活体验证；几何/样式 helper 依赖面板 API 版本。
- **并发。** 守护进程（或本地退路）持有唯一的桥管理器、供给锁和 ack 路由；请求带唯一 id，按控制台标记关联。多个 MCP 会话共享同一座桥；桥按顺序处理事件，ack 缓存让重复 id 安全。generation 变化时销毁已知的旧元素 id，并且只清扫 token 命名的目录。
- **失败码。** `bridge_unavailable`、`bridge_compile_failed`、`bridge_ping_timeout`、`exec_not_started`、`exec_incomplete`、`js_error`、`lua_listener_failed`；每个错误带 generation、请求 id 和相关控制台行。清理失败是警告，不是桥失败。
- **测试。** 离线：假 VCon 服务覆盖 ensure/复用/重建/超时/错误路径和文件暂存/清理。活体：首次创建、第二次复用、删除文件、地图重载、Dota 重启、`DynamicHud_Destroy`、编译失败、JavaScript 异常、并发会话、content junction 仓库干净。客户端到服务端的 ack 路径已用探针验证（`MCP_ACK_REPLY 42 1 PONG`）。

### 第 1 层：调试器驱动的检视

- 不用热键打开调试器：`panorama_dispatch_event CreateDebuggerWindow()` 通过引擎的事件工厂创建 `Panorama Debugger` 窗口。窗口加载 `panorama/layout/debugger.xml`，可以用 `PrintWindow` 截图，不需要 OCR。
- 调试器的 JavaScript 控制台仍要求选中一个具备 JavaScript 上下文的面板，并在调试器持有前台时键入文本。进程内每次提交都会重跑第一段成功编译的脚本（单槽缓存），所以控制台是退路，不是主路径。
- 事件字符串使用 `Name(args...)`，字符串参数用单引号。扁平名字和花括号形式都失败；`TextEntrySetText('...')` 会被接受，但因为 `panorama_dispatch_event` 创建的 event 没有 creating panel，它不会改变任何输入。
- 调试器只把检视信息渲染成文本。机器可读的检视结果需要另一条通道（剪贴板、调试器日志或其他引擎钩子），这是待解问题。

### 第 2 层：窗口与输入操作

- 已实现为 `dota_input`：`window_info` 报告外框/客户区矩形、客户区原点、DPI 和前台状态；move/click/down/up/drag/wheel、key press/down/up 和 Unicode 文本均使用客户区坐标。
- 输入前校验边界；结果返回客户区几何、焦点/光标状态和还原标记。只有 `restore_focus:true` 才还原前一个前台窗口；`-tools` 模式下还原焦点会隐藏游戏窗口，因此默认让游戏保持前台，显式还原时会以不激活方式重新显示被隐藏的窗口。
- 活体验证：探针 Button 收到真实 `onactivate`、悬停进入/离开；原生聊天 TextEntry 收到 Unicode 文本和按键；输入后游戏窗口仍可用。

## 实测行为

以下均在 `-dev -tools` 会话中实测；除特别说明外，每条结论都来自运行中的引擎。

- 调试器是 Dota 进程内的第二个顶层 `SDL_app` 窗口，标题为 `Panorama Debugger`，没有子窗口。
- `panorama_toggledebugger_mode` 是隐藏 ConVar，帮助文本为 "Toggledebugger key operation : 0 = open/inspect, 1 = open/close"；在活体会话里设置它既没有创建也没有关闭窗口。真正起作用的是引擎的调试器热键：`Dota 2` 窗口处于前台时，合成的 F6 能创建 `Panorama Debugger` 窗口；`WM_CLOSE` 关闭后，再次 F6 会重新创建。
- `panorama_dispatch_event CreateDebuggerWindow()` 也能创建调试器：窗口出现后，`panorama_print_cache_status` 里出现 `panorama/layout/debugger.xml (87 refs)`；`PrintWindow` 截到了空白检视器和它的 JavaScript Console 输入框。打开它不需要热键或游戏前台。
- ConVar 的两个模式与帮助文本一致。设为 `1`（open/close）时，F6 打开带内容的检视器：树、样式面板和 context 行都是活的——点击树行会切换选中项，检视按钮加点击游戏小地图选中了 `DOTAMinimap#minimap`，搜索框和控制台输入框都能接受键入。设为 `0`（open/inspect）时，F6 打开的是空白窗口，对同样的点击和按键没有反应。更早观察到的空窗口就是这个模式，不是窗口坏了。
- 只有当调试器窗口真正持有前台时，键入 JavaScript 控制台才有效。每条提交的行都会回显；调用在进入 V8 之前返回时，回显后面会跟一个 `1`；真正执行时，回显后面是脚本自己的输出，不再出现 `1`。
- 当选中的面板属于具备 JavaScript 上下文的布局时，控制台会执行。一个最小的 addon 自定义 UI（`custom_ui_manifest.xml`、带 `<scripts>` 的布局和一个 JS 文件）经 `resourcecompiler` 编译后在游戏里加载；`$.Msg("MCP_UI_TEST_LOADED")` 到达了 `PanoramaScript` 通道。调试器的检视点击选中 `#McpUiTestLabel` 后，提交 `McpUiTestPing("HELLO123")` 真的执行了：标签文本变成 `PING HELLO123`，`MCP_UI_TEST_PING HELLO123` 出现在 `PanoramaScript` 上。基础游戏的 dashboard 布局也提供了可用的上下文，所以只要有 JavaScript 上下文的布局就够了；addon UI 只是本次测试方便使用的载体。
- 首段脚本桥已端到端验证。109 字符的第一段脚本 `$.p=$.GetContextPanel();$.Msg("B");GameEvents.Subscribe("j",function(d){$.p.RunScriptInPanelContext(d.code)})` 在 addon 自定义 UI 上下文里编译并运行（控制台出现 `B`），并订阅了自定义事件 `j`。服务端随后通过现有 Lua 通道发送 `CustomGameEventManager:Send_ServerToAllClients('j', { seq = 1, code = 'McpUiTestPing(777)' })`；监听器调用面板方法 `RunScriptInPanelContext(d.code)`，引擎编译并运行这段代码，`MCP_UI_TEST_PING 777` 出现在 `PanoramaScript` 上，非陈旧截图里标签文本变成 `PING 777`。第二个事件携带 `$.Msg("DIRECT456")`，打印出 `DIRECT456`，所以这条桥可重复，执行的是任意 JavaScript，而不只是一个固定函数。
- 无调试器路径已验证：`CustomUI` 是服务端表（`type(CustomUI) == "table"`），暴露 `DynamicHud_Create`、`DynamicHud_Destroy`、`DynamicHud_SetDialogVariables` 和 `DynamicHud_SetVisible`。`CustomUI:DynamicHud_Create(-1, 'mcp_dyn_bridge', 'file://{resources}/layout/custom_game/mcp_dyn_bridge.xml', {})` 让客户端加载该布局并运行它的脚本（`PanoramaScript` 上出现 `DYN_READY`）；布局 JS 注册了自定义事件 `k` 的监听器，`CustomGameEventManager:Send_ServerToAllClients('k', { seq = 10, code = '$.Msg("DYN_EXEC")' })` 通过 `RunScriptInPanelContext` 执行并打印 `DYN_EXEC`。全程没有调试器、控制台输入或单槽缓存。客户端到服务端的反馈路径也已验证：动态 HUD JS 的 `GameEvents.SendCustomGameEventToServer('mcp_ack_reply', { id: 42, ok: 1, payload: 'PONG' })` 到达服务端 `CustomGameEventManager:RegisterListener`，打印 `MCP_ACK_REPLY 42 1 PONG`；客户端打印 `MCP_ACK_RECV 42`。
- 桥的 JavaScript 上下文是自己的动态 HUD 布局，不是 addon 的自定义 UI 作用域：`MCP.context()` 报告的父链是 `<bridge> -> CustomHudElements -> CustomUIRoot -> Hud -> DotaHud`，`top_id` 为 `DotaHud`；`Game`、`GameEvents`、`GameUI`、`Players` 和 `Entities` 是对象，`CustomUI` 是 undefined（仅服务端）。原生 `$('#Hud')` 返回 null，而 `$('#<桥元素>')` 找到了桥根，所以 `$` 只在桥布局内解析。从 `DotaHud` 出发，`FindChildTraverse` 找到了 `Hud`、`HUDElements`、`CustomUIRoot` 和 `minimap_container`；`minimap_container.FindChildTraverse('minimap')` 找到了深层子节点 `minimap`。`DOTAMinimap` 是调试器显示的 panel 类型名，不是 JavaScript 可见的 id，这正是先前 `MCP.locate('DOTAMinimap')` 找不到的原因。同样的顶层搜索找到了桥根，并对不存在的 id 返回 null；把桥根作为范围时 `Hud` 被排除。`$.CreatePanel('Panel', MCP.top(), 'McpTopProbe')` 创建的 panel 父节点是 `DotaHud`；游戏窗口未聚焦时 `DeleteAsync(0)` 没有删除它，直到强制 `r_always_render_all_windows 1` 后才消失，所以运行时 UI 删除要等客户端渲染一帧；随后清理了这些探针 panel，并把 cvar 恢复为 false。顶层边界也已实测：`DotaHud.GetParent()` 返回 null；从桥里对 `DotaHud` 调用 `RunScriptInPanelContext` 抛出 `RunScriptInPanelContext must be called from a context with a domain that matches this panel`；活体 `$` API 没有根访问器；dashboard 布局仍在布局缓存中时，`MCP.select('#Dashboard')`/`#DashboardCenter` 从 HUD 根返回 null。因此桥覆盖的是 HUD 顶层窗口，不是同级的其他顶层窗口。`MCP.map()` 活体返回路径 `DotaHud > Hud > { HUDElements | CustomUIRoot > CustomHudElements }`、10 个 custom UI 区域（含 `CustomUI` 和 `CustomUIContainer_*`）、38 个引擎 HUD 组件（含 `topbar`、`minimap_container`、`shop`）以及标签；`MCP.customUi('#CustomHudElements')` 找到了桥容器，`MCP.customUi('#HUDElements')` 返回 null，`MCP.hudElements('#minimap_container')` 找到了小地图容器，`MCP.children('#CustomUIRoot')` 返回了它的 10 个子节点。addon 定义的全局变量不在作用域内；可达面板实例上的方法和属性可用。
- 桥布局是一个带 `<scripts>` include、根面板不带 `id` 的最小 XML，加上它的 JS。根面板带 `id` 会被拒绝，报 "Found root panel with 'id' attribute, which is not permitted"。
- 布局加载器拒绝绝对布局路径，报 `FixupResourceName: Illegal full path passed in (...)` 并加载失败。任何 `..` 段都是致命的：`FATAL ERROR: Error loading ...: paths to layout files cannot contain '..'` 会终止游戏。二进制字符串显示 CSS 和 UI script include 也有同样的规则。绝不要在活体会话里探测 `..`。
- 加载器接受基座游戏根目录下的已编译松散布局：把编译产物复制到 `{dota2Path}/game/dota/panorama/layout/custom_game/...` 后能加载并运行（`EXT_RC_LOADED`）。同一基座游戏树里的源 XML 不会即时编译；加载器只找 `.vxml_c`，找不到就失败。
- 加载器也会跟随 addon game 树里的目录链接：`{addon}/game/panorama/layout/custom_game/<name>` 处的目录符号链接和目录 junction 指向外部编译目录时，两者的布局都能加载（`EXT_GDIR_LOADED`）。挂载的 junction 是持久的：完全重启 Dota 后，`mcp_bridge` junction 仍从 `%TEMP%` 加载了编译产物，并执行了投喂的 `$.Msg(445566)`（`MCP_BRIDGE_READY`）。junction 不需要管理员权限或开发者模式，可跨本地 NTFS 卷使用（addon 在 D:，目标在 C:），但要求目标目录先存在；目标悬空时创建失败。Git 会把挂载的链接报告为未跟踪目录（`?? game/panorama/`），因此不能提交。
- addon content 树里的源文件会被即时编译：`content/panorama/layout/custom_game/` 下符号链接的 `mcp_sym.xml`/`.js` 在加载时被编译并运行（`EXT_SYM_LOADED`），普通源文件副本也能同样编译（`EXT_SRC_LOADED`）。content 树里的目录 junction 不会被源查找遍历；那次加载失败，也没有触发即时编译。官方 Panorama JavaScript 文档允许布局 XML 内联 `<script>` 块（自动包进 CDATA），安装的多个 addon 里也有这种写法；但当前即时编译器在活体里拒绝它：`mcp_inline.xml(2,3): RESOURCE COMPILE ERROR: <script /> tags within XML files are no longer supported. Please create a separate script file that is included via an <include /> in the <scripts /> section.`；随后 `CreateElement` 加载布局失败。当前编译器要求 XML 加单独的 JS include 文件。
- 只有当输入路径写成 `content/dota_addons/<addon>` 下时，`resourcecompiler` 才会把临时 addon 的布局和 JS 编译成 `.vxml_c`/`.vjs_c`；在 Dota 安装里建临时 junction 让这条路径成立。产物落在临时 game 树里。普通临时源路径失败，报 `File "" doesn't exist!`。
- 外部桥已端到端验证：编译产物暂存在基座游戏后，`DynamicHud_Create` 打印 `MCP_BRIDGE_READY`；完全重启 Dota 后，服务端事件投喂 `$.Msg(24680)` 打印 `24680`。删掉暂存文件后运行中的桥仍继续工作（`13579`）；`DynamicHud_Destroy` 会停止监听器；从缓存重建 HUD 又打印 `MCP_BRIDGE_READY` 并接受 `77777`，此时磁盘上已没有任何暂存文件。完整的复制 → 引擎编译 → ready → 删除循环已验证：源文件对经测试 addon 的 content 目录 junction 复制后编译进它的 game 树，桥执行了 `$.Msg(12345)`；删除源文件和两份编译产物后桥仍活着，`$.Msg(13579)` 仍能执行；测试仓库的 git 状态未变。之后一次地图重载销毁了 HUD，下一次 exec 重建成功（`rebuilt:true`，结果 `42`）。新建的 Panel 走通了 text/visible/style（`hello`、`false`、`10.0px`），语法错误返回 `js_error` 和 `RunScriptInPanelContext was unable to compile provided script`。
- 桥的生命周期与 addon 内桥一致：删除源文件和编译产物不影响运行中的桥，因为客户端把已加载的布局留在进程里；这份内存缓存会随游戏重启清空。
- Panorama 的 V8 上下文禁止 `eval` 和字符串代码生成：第一次桥尝试（`eval(d.code)` 监听器）抛出 `EvalError: Code generation from strings disallowed for this context`。`RunScriptInPanelContext` 才是可用的引擎侧编译并运行入口。
- 没有 JavaScript 上下文的布局里的面板（`hud_reborn.xml` 的小地图、旁观者监听器）仍然拿不到上下文：`GetContextForPanel` 返回 null，`RunScript` 在进入 V8 之前返回，控制台只回一个确认。之前“控制台从不执行”的结论完全是在这些面板上测出来的。
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

- 引擎二进制把 `RunScriptInPanelContext(script)` 暴露为面板方法，约束是调用方与面板必须同 domain，并记录 `%s#%s - script run in context`。调试器控制台走的是 `CUIEngine::RunScript`；已验证的桥则从 JavaScript 调用面板方法（`<panel>.RunScriptInPanelContext(code)`），它会在该面板的上下文里编译并运行代码，是绕过被禁 `eval` 的唯一可用路径。
- `CDOTA_CustomUIManager`（全局 `CustomUI`）是服务端注入面：四个 `DynamicHud_*` 方法分别创建、销毁、更新对话变量和切换可见性，元素由客户端按布局文件加载。`DynamicHud_Create` 就是让客户端加载桥布局并执行其 JS 的入口。
- `CDOTA_CustomUI_Root::CreateElement` 通过资源系统解析 `file://{resources}/layout/...`：addon game 树和基座游戏的 `game/dota` 根都会被查找已编译资源；基座游戏里的松散编译文件会被接受，addon content 里的源文件会被即时编译。布局和它的脚本必须是两个文件；当前编译器会拒绝内联 `<script />`，报 `<script /> tags within XML files are no longer supported. Please create a separate script file that is included via an <include /> in the <scripts /> section.` 绝对路径被拒绝，layout、CSS 或 UI script 路径里的任何 `..` 都是致命的。
- `panorama_dispatch_event` 以空的 creating panel 调用 `CUIEngine` vtable 槽位 `+0x330`（`CreateEventFromString`），再经 vtable 槽位 `+0x178` 派发创建的事件。解析器读到第一个 `(` 为止作为事件名，在符号表里查找，再按顶层逗号切分参数，处理嵌套括号和单引号字符串。
- 调试器的控制台提交实现在 client.dll（`CPanoramaClientDebugger`）里，不在 panorama.dll：一个针对 `JSConsoleInput` 文本框 `TextEntrySubmit` 的原生处理器会以选中面板的上下文、输入文本和源名 `JSConsoleInput` 调用 `CUIEngine::RunScript (compile+run)`——UIEngine vtable 槽位 `+0x268`。这个固定源名同时是缓存键：第一段编译成功的脚本会被之后每次提交复用，因此控制台每个进程只运行一段脚本。
- `CUIEngine::RunScript` 通过 `GetContextForPanel` 解析 V8 上下文；解析不到时（没有 JavaScript 上下文的布局）直接静默返回；对具备 JavaScript 上下文的布局则编译并运行文本。只有 `RunFunction` 会把结果（`=> value`）经 `JSConsoleOutput` 打印出来；控制台的 `RunScript` 路径不打印返回值，因此结果要通过副作用和 `$.Msg` 观察。`GetContextForPanel` 会复用按面板缓存的上下文，或新建一个 V8 上下文，并对带特定标志的面板有一条提前返回 null 的路径。
- `CUIEngine::CompileScript` 只有三个已解析调用方：`RunScriptInPanelContext`、`SetPanelEvent` 的脚本字符串形式，以及按 `;` 拆分多语句、经 vtable 到达的运行器。`RunScript（预编译）` 有两个：面板事件派发器（事件 kind 3）与 `RunScriptInPanelContext`。`panorama.dll` 里没有其他原生脚本编译路径。
- 二进制字符串还暴露了 `JSConsoleOutput`、`ToggleDebugger` 和 `CreateDebuggerWindow`；它们是注册的 Panorama UI 事件 schema。`CreateDebuggerWindow` 可以经 `panorama_dispatch_event` 派发；调试器热键对应 `CDebuggerInputHandler` 类，绑定 `PanoramaDebuggerHotkey`。
- 调试器布局里的 JavaScript 处理器（`PrevSearch`、`UpdateJSConsolePriorHistory`）只以事件表达式出现在 `panorama/layout/debugger.vxml_c` 中；原生提交处理器和 `JSConsoleInput`/`JSConsoleText` 绑定编译进了 client.dll。
- `GameEvents.SendCustomGameEventToServer` 已在具备 JavaScript 上下文的动态 HUD 里验证：服务端 `CustomGameEventManager:RegisterListener` 收到了它发的载荷。`Game.ServerCmd` 与 `Game.AddCommand` 来自第三方 API 快照，只在 null 上下文里试过，仍按未验证处理。活体 TypeScript 声明转储还列出了 `Panel.RunScriptInPanelContext`、`Panel.BLoadLayout`、`$.CreatePanel`、`$.DispatchEvent` 和 `Game.AddCommand`。

## 待解问题

- 运行期主路径是复制 → 引擎编译 → ready → 删除循环；已活体验证，包括经过开发者 content 目录 junction 的情况（测试仓库的 git 状态恢复到之前）。现在由记录的 element id 驱动旧 generation HUD 清理。剩余：进程被杀后的失败供给清扫、一次完整 Dota 进程重启实测，以及大结果/分块边界。
- 进程级布局缓存按资源路径做键。如果后续 MCP 版本在同一路径换了桥源码，缓存可能继续提供旧布局；决定是否给桥目录加版本号，或接受每个游戏进程只用一个桥版本。
- 地图重载后的 HUD 重建已实测（`rebuilt:true`，结果 `42`）；完整 Dota 进程重启和缓存被清空仍需要同一套活体矩阵。桥靠 ping 识别，而不是一次性的 `MCP_BRIDGE_READY` 标记。
- 服务端事件携带代码，所以投喂的 JavaScript 受 `dota_run_lua` 语句上限约束（包装后约 510 字节，约 300 字节 Lua）。更长的代码怎么传输：拆分多个事件并由客户端重组、客户端读取文件，还是专用桥？
- 能否不经焦点把 `TextEntrySetText` 或 `TextEntrySubmit` 派发到指定面板？`panorama_dispatch_event` 创建的 event 没有 creating panel，对调试器输入是 no-op；另一条事件路线或原生提交路径能从退路里去掉焦点/键入步骤。
- 调试器渲染出来的检视数据（树、样式面板、context 行）能否通过剪贴板或引擎钩子以机器可读的方式取回，而不做 OCR？
- 控制台能否在不取得前台的情况下操作？投递消息会被忽略，所以目前的答案是不能。

## 备选方案

- **addon content 的临时桥副本。** 主路径：桥源码放在 MCP 服务端，把 XML 和它 include 的 JS 复制进 addon content，让引擎即时编译，用 `DynamicHud_Create` 加载，经服务端事件投喂 JavaScript，并在 `MCP_BRIDGE_READY` 后删除源文件副本和两份编译产物。没有 junction，也没有持久的 addon 文件；在开发者的 content 目录 junction 下，文件只在复制/编译/删除窗口内出现在仓库里。完整循环已活体验证：源文件对经测试 addon 的 content 目录 junction 即时编译，桥执行了 `$.Msg(12345)`，删除后仍活着（`$.Msg(13579)`），仓库 git 状态未变。addon 只读或引擎不能即时编译时，仍可把编译产物暂存到基座游戏或 addon game 目录 junction。
- **addon 内的动态 HUD 桥。** 已端到端验证，保留为 opt-in 退路：服务端从 addon 里的编译桥布局创建 HUD 元素，布局 JS 注册监听器，同一套事件投喂通过 `RunScriptInPanelContext` 运行任意代码。代价是 addon 里要有一份桥布局。
- **用调试器唯一允许的那段脚本引导常驻 JavaScript 桥。** 已端到端验证：第一段脚本订阅服务端事件并调用 `RunScriptInPanelContext`，服务端用 `CustomGameEventManager:Send_ServerToAllClients` 投喂代码。作为无文件退路保留，因为单槽缓存、JavaScript 上下文面板要求和 TextEntry 让它很脆弱。
- **用 `panorama_dispatch_event CreateDebuggerWindow()` 打开调试器，而不是 F6。** 已验证：它去掉了打开检视器的热键和游戏前台要求，但没有去掉控制台的前台/键入要求。
- **先从 OS 级窗口与点击自动化开始。** 它能给出坐标和点击，但拿不到面板身份、属性或样式，而且必然占用输入设备。保留为第二层和退路。
- **向用户 addon 写入文件来注入 JavaScript 桥。** 产品层面否决：这会编辑不属于我们的源码，需要重新加载，也违背「addon 文件属于开发者」的契约。活体实验只向测试 addon 加了测试文件作为夹具。
- **把控制台末尾的 `1` 当作执行证据。** 否决：`1` 是调用在进入 V8 之前返回时的确认；真正执行会显示脚本自己的输出和副作用。
- **截取调试器输出面板再做 OCR。** 第一片否决：脆弱、慢，而且如果控制台或事件通道能带回结果就完全不需要。

## 验收标准

- 实测主路径已记录：存放在 MCP 服务端的桥源码被复制进 addon content、即时编译、经 `CustomUI:DynamicHud_Create` 加载、运行 JS、注册监听器，并通过 `RunScriptInPanelContext` 执行服务端事件送来的任意代码；`MCP_BRIDGE_READY` 后删除源码和编译产物，不留下桥文件。addon 内桥和调试器单槽引导是退路。本 Note 只主张检视加已验证的桥，不主张从任意面板通用的一次调用执行。
- 面板检查能从活体 UI 返回指定面板或子树的 id、class、位置、尺寸和可见性。
- 交互操作只在有边界的动作期间取得焦点；`dota_input` 默认让游戏保持前台，只在显式请求时还原前一个窗口；越界坐标在取得焦点前就带着几何信息失败。
- 所有用到的引擎 API 都先活体验证再硬编码；离线测试覆盖坐标换算、越界拒绝和结果解析。
- Agent Note、工具契约与双语文档同批交付；活体证据在实现后移入 implemented 的 Agent Note。

## 风险

- 主路径会把两份源文件写进 addon content，引擎会把两份编译产物写进 addon game 树。MCP 进程若在复制与删除之间被杀，文件会留下；在开发者的 content 目录 junction 下，它们会以未跟踪文件出现在仓库里。工具必须使用专用桥目录、只删除自己写入的文件，并在下次守护进程启动或客户端断开时清扫失败的供给。基座游戏和 addon junction 退路各自保留足迹：基座游戏暂存会把松散编译资源写进 Dota 安装（显式 opt-in、加载后删除，不用于在线或天梯对局；Steam 完整性和 anti-cheat 行为尚未验证）；挂载的 junction 会以未跟踪目录出现在 git 里，不能提交，且目标被清理后必须检测并重新供给。
- 主路径每次供给都从源码编译，消除了编译产物跨构建失效的问题，但它依赖引擎的源文件即时编译器（在 `-tools` 开发会话中可用）。如果某个构建去掉了这个编译器，工具必须退回编译产物或 addon 内桥。进程级布局缓存还可能在同一路径上掩盖改过的桥源码，因此桥版本变更需要新路径或新的游戏进程。
- 布局加载器把任何 `..` 段当作致命错误。绝不要在活体会话里探测路径穿越；失败的绝对路径不致命，但 `..` 会让游戏退出。
- 桥依赖未文档化的 `CDOTA_CustomUIManager` API 和 `RunScriptInPanelContext`；两者都可能随补丁改变。addon 内退路还需要生成一份可删除的桥布局。
- 动态 HUD 和它的监听器随地图销毁；地图重载已实测能正确重建。完整 Dota 进程重启和缓存清空仍需要同一套活体矩阵。工具靠 ping 而不是一次性的 ready 标记来区分缓存桥和缺失的桥。
- 调试器及其控制台是未文档化的引擎工具；一次更新就可能改掉窗口标题、命令或 JavaScript 绑定。脚本缓存是实测出来的、与版本相关的行为，因此每个引擎版本都要重新实测后才能依赖它。
- 进程级的单槽缓存仍让调试器退路很脆弱：任何一次杂项提交——包括开发者手动输入的 `$.Msg(1)`——都会占住它直到下次重启 Dota。依赖这条退路的工具必须自己完成首次提交，或检测到陈旧缓存并要求重启。
- 调试器退路的监听器会随布局的 V8 上下文在地图重载时销毁；重新武装意味着在具备 JavaScript 上下文的场景里再提交一次。工具必须处理这个循环，或接受重载后退路失效。
- `eval` 被禁，桥依赖未文档化的面板方法 `RunScriptInPanelContext`；一次更新就可能移除或改名。调试器引导还必须压在 TextEntry 约 128 字符的粘贴上限之下。
- 自动化焦点切换可能打断用户正在进行的输入。`dota_input` 把接管限制在有边界的动作内，默认让游戏保持前台，并在显式还原焦点导致游戏窗口隐藏时重新显示它。
- 控制台传输是行式的；JSON 结果需要转义、分块，以及控制台实际能承载的大小上限。

# Agent Note: Panorama 桥与 OS 输入工具

[English](2026-10-26-panorama-bridge-and-input.md) | 中文

Status: implemented

## 问题

MCP 能运行服务端 Lua、能读 VCon 控制台，却看不见也操作不了客户端 UI：没有面板身份、边界、可见性或实时状态，也不能在不靠人的情况下激活控件。服务端 Lua 无法访问 Panorama；引擎的调试器路径又需要前台键入和进程级单槽脚本缓存。交付的方案必须在不改 addon 的前提下，在具备 JavaScript 上下文的 Panorama 里执行任意代码，并在没有后台路径时用真实 OS 输入操作游戏。

## 决定

**执行路径：临时供给的动态 HUD 桥。** 两份源文件（布局 XML 加一个被 include 的 JS 文件）随 MCP 服务端发布。供给流程是复制 → 引擎编译 → ready → 删除：把它们复制到 `{dota2Path}/content/dota_addons/<addon>/panorama/layout/custom_game/<bridge>/`，调用 `CustomUI:DynamicHud_Create(PlayerID, ElementID, 'file://{resources}/layout/custom_game/<bridge>/<bridge>.xml', {})`，等 `PanoramaScript` 上出现 `MCP_BRIDGE_READY`，然后删除源文件副本和两份编译产物。客户端进程级布局缓存维持运行中的桥；地图重载销毁 HUD，下一次 exec 重建；Dota 重启清空缓存并重新供给。布局路径必须是资源相对路径（`file://{resources}/...`）；绝对路径被拒绝，任何 `..` 段都会让游戏致命退出。XML 通过 `<scripts><include .../></scripts>` 引入脚本；当前即时编译器拒绝内联 `<script />`。

**协议与归属。** 守护进程持有随机 128 位 token 和源码哈希 generation，用来命名每个事件、元素 id 和目录（`d2mcp_<token>_<generation>_exec|ack|ping|pong`）。桥用 pong 回应 ping，用 `started`（编译前）和 `done`（执行后）两个 ack 回应 exec；ack 经 `GameEvents.SendCustomGameEventToServer` 从客户端发到服务端 `CustomGameEventManager:RegisterListener`，由它打印带 token 前缀的控制台行供工具匹配。Lua VM 不能阻塞等待客户端 VM，所以由工具等待控制台标记。Ensure 是幂等的：安装监听器、ping、pong 匹配就复用、尝试从进程缓存 `DynamicHud_Create`，只有缓存未命中才复制/编译/删除。缺少 `started` 可以安全重试；有 `started` 没有 `done` 返回 `exec_incomplete`，不会重复执行；ack 按请求 id 缓存。失效键包含 Dota 进程启动时间、地图、addon 和 generation。多个 MCP 会话共享同一个桥管理器、供给锁和 ack 路由；generation 变化时销毁已知的旧元素 id，并且只清扫 token 命名的目录。失败码：`bridge_unavailable`、`bridge_compile_failed`、`bridge_ping_timeout`、`exec_not_started`、`exec_incomplete`、`js_error`、`lua_listener_failed`；清理失败是警告，不是桥失败。

**工具面。** `panorama_exec_js` 执行短 JavaScript（`return <value>`），提供 `MCP` helper：发现（`map`、`customUi`、`hudElements`、`children`、`top`、`select`、`$`、`context`、`locate`、`panel`、`text`、`cls`、`style`、`visible`、`snap`、`log`、`help`）、几何（`rect`、`center`、`isVisible`、`panelAt`）、光标/世界转换（`cursor`、`entitiesAt`、`worldToScreen`、`screenToWorld`）、游戏状态（`units`、`unitInfo`、`selection`、`selectUnit`、`selectAllUnits`、`camera`、`order`），以及后台事件（`dispatch`、`focus`、`blur`、`selectPanel`、`setValue`、`setText`、`on`、`emit`）。桥运行在自己的动态 HUD 布局上下文：引擎全局变量和可达面板上的方法可用；addon 定义的全局变量不可用。原生 `$` 只在桥布局内解析；`MCP.select`/`MCP.$` 从最外层面板（`MCP.top()`，实测为 `DotaHud`）搜索，可传第二个面板限定范围。`focus`/`blur` 触发 `onfocus`/`onblur`，`TogglePanelSelected` 是可靠的后台 `onselect` 路径，值和文本 setter 在游戏失焦时也能触发各自的变更事件；`$.DispatchEvent('onactivate')` 和所有 `onmouse*` 名称都会被拒绝，所以按钮激活和 hover 仍需真实输入或 addon 测试钩子。新建面板可以挂在 `MCP.top()` 下，但只在客户端渲染一帧后才消失；已有引擎面板不能重新挂父。桥只覆盖 HUD 顶层窗口；同级的其他顶层窗口（dashboard、调试器）有独立上下文，由[提案](../../../proposed/feature/2026-10-26-panorama-ui-control.md)负责。结果超过约 12 KB 会截断并返回头部。

**OS 输入。** `dota_input` 是窗口/输入路径：`window_info` 报告外框/客户区矩形、客户区原点、DPI 和前台状态；move/click/down/up/drag/wheel、key press/down/up 和 Unicode 文本使用客户区坐标；越界坐标在输入前失败。默认让游戏保持前台；只有 `restore_focus:true` 才还原前一个前台窗口，显式还原时会以不激活方式重新显示被隐藏的游戏窗口。

## 验证

活体：复制 → 编译 → ready → 删除循环经过 content 目录 junction 运行，仓库 git 状态未变；删除源文件和编译产物后桥仍活着（删除后 `13579`）；地图重载后重建成功（`rebuilt:true`，结果 `42`）；语法错误返回 `js_error`；面板 text/visible/style 往返成功；探针 Button 收到真实 `onactivate` 和悬停进入/离开；Unicode 文本和按键到达原生聊天 TextEntry；输入后游戏窗口仍可用；新建面板只在客户端渲染一帧后消失。调试器单槽引导、addon 内桥和基座游戏/junction 变体在设计阶段验证过，作为退路保留，不是交付默认路径。

## 备选方案

- **基座游戏松散资源或 addon 游戏目录 junction。** addon 只读或引擎不支持源文件即时编译时的已验证退路：把编译产物放到 `{dota2Path}/game/dota/panorama/...`，或把 junction 指向那里。否决为主路径：基座游戏暂存会写进 Dota 安装，挂载的 junction 会以未跟踪目录出现在 git 里，不能提交。
- **addon 内的桥。** 已端到端验证，保留为显式 opt-in 退路：编译好的桥布局放在 addon 里。否决为默认路径，因为它会编辑开发者拥有的 addon 文件。
- **调试器单槽引导。** 已端到端验证，保留为无文件退路：调试器控制台的第一段脚本订阅服务端事件并调用 `RunScriptInPanelContext`。否决为主路径，因为控制台需要前台键入、选中具备 JavaScript 上下文的面板，并且有进程级单槽脚本缓存。
- **把桥写进用户 addon 作为产品行为。** 否决：这会编辑不属于我们的源码，违背 addon 所有权契约；活体实验只使用测试 addon。
- **只从 OS 级自动化开始。** 保留为输入路径而不是检视路径：它能给出坐标和点击，但拿不到面板身份、属性或样式，而且必然占用输入设备。
- **截取调试器输出再做 OCR。** 否决：脆弱、慢，而且控制台或事件通道能带回结果时完全不需要。
- **在桥里 `eval(d.code)`。** 被引擎否决：禁止从字符串生成代码；`RunScriptInPanelContext` 是唯一可用的编译执行入口。

## 后果

换来的：不修改 addon 就能在具备 JavaScript 上下文的 Panorama 里执行任意代码；实时面板检视与操作；游戏失焦时仍可用的后台事件驱动；几何与游戏状态 helper；所有 MCP 会话共享一座桥；以及没有后台路径时的真实 OS 输入。

代价：桥依赖未文档化的 `CDOTA_CustomUIManager` API、`RunScriptInPanelContext` 和 tools 模式的即时编译器；进程级布局缓存可能在同一路径继续提供旧源码，所以桥版本变更需要新路径或新的 Dota 进程；供给会在短时间内写入两份源文件和两份编译产物，进程被杀可能留下文件（专用目录和清理扫描限制影响）；投喂代码受 `dota_run_lua` 语句上限约束（包装后约 510 字节，约 300 字节 Lua）；新建面板只在客户端渲染一帧后消失；桥只覆盖 HUD 顶层窗口；OS 输入会在有边界的动作期间取得焦点；布局加载器把任何 `..` 段当作致命错误，绝不能活体探测路径穿越。

推迟：调试器检视回读、多根访问和剩余生命周期矩阵由[提案](../../../proposed/feature/2026-10-26-panorama-ui-control.md)负责。

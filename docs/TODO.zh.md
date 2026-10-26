# 后续工作

[English](TODO.md) | 中文

这是当前后续工作清单。完成后移除对应条目；详细设计以链接的 Agent Note 为准。

## 截图契约待决项

- [ ] **确定 WGC 构建失败时的退路与 issue #12 一致。** 规格要求 PrintWindow 退路，但有界活体实验表明它可能随游戏一起卡住。要么实现独立有界、明确卡死限制的退路，要么更新规格与所属 Agent Note，统一为无退路行为。绝不静默改截全屏。
- [ ] **找到可靠的运行时独占全屏信号，或明确接受保存配置的局限。** 活体探测表明，`WS_POPUP`、`WS_EX_TOPMOST`、显示器矩形和 DWM 属性在独占与无边框窗口之间都可能重合，因此已撤回样式启发式，没有将其交付。除非找到引擎支持的数据源，未保存的显示模式变化仍是明确的限制。
- [ ] **明确首次卡死且无缓存的行为。** 如果 WGC 从未交付过帧，持续卡死仍会得到 `no_frame`。要么提供经过验证的安全退路，要么修改“卡死必能拿图”的用户故事，明确这一限制。
- [ ] **决定是否每次成功都打印 `hung: false`**，以满足元数据契约，而不是只在 `hung: true` 时打印。
- [ ] **补齐剩余活体检查：**恢复窗口过程中的真实超时、截图边框、Windows“无响应”占位画面，以及真实窗口 resize。resize 需要用户手动或引擎支持的路径；当前 Dota 视频模式已拒绝 Win32、cvar 和临时窗口样式三种尝试。

## 生产级 VFX 制作

遵循[生产级 VFX 配方与视觉验收](../.agents/notes/proposed/feature/2026-10-25-production-vfx-recipes.md)。

- [ ] **为三个配方实测每帧开销。** 每个配方都记录了 sprite 数量，但都还没有实测帧开销。要相对基线场景测量并写明测量环境，预算不能变成通用常数。
- [ ] 在真实 ability/modifier 中验证范围预警和投射物配方，而不只是 `vfx_preview`。光环已经在 `LinkLuaModifier` 注册的 modifier 里跑通，创建、时长到期和移除都有截图。
- [ ] 增加新 agent 验收：只使用选中的配方调整颜色、半径和持续时间，再完成编译 → 引用检查 → 预览 → 分时视觉验收 → 停止，且没有结构错误或实例泄漏。
- [ ] 单独决定运动效果是否需要视频/序列帧捕获。不能通过暗示来削弱当前单张截图的契约。

## 运行时与工具跟进

- [ ] **验证非 tools cheats 守卫。** 找到不使用 tools 模式也能启用 29000 VConsole 监听的方式，再验证 addon 会强制 `sv_cheats=0` 以及临时开启流程的表现。tools 模式下的包装实验已通过，实际非 tools 守卫仍未验证。
- [ ] **如果临时 cheats 成为正式功能，必须显式 opt-in。** 保存原值、等待延迟 Lua 完成，并报告恢复未确认的情况。绝不默认静默开启，也不与 addon 有意的守卫对抗。
- [ ] **恢复或替换本地 pre-commit hook 路径**（`Can't find lefthook in PATH`）。手工运行离线套件和文档门禁仍是必需的基线。
- [ ] **决定当前测试 addon 中 `particles/mcp_preview_test/visible_glow.vpcf` 测试粒子及其编译产物的去留。** 可以作为最小示例保留，或仅在明确确认后删除；不修改其他 addon 文件。
- [ ] **再次修改控制台收集代码时明确标记归属：**`src/index.ts` 的 `newMcpMarkers()` 与 `vcon-relay.ts` 的 `MCP_MARKER_RE` 不能发生格式漂移。

## Panorama 调试器与 UI 操作

遵循[通过调试器控制 Panorama UI](../.agents/notes/proposed/feature/2026-10-26-panorama-ui-control.md)。

- [x] **Panorama 桥生命周期核心（2026-10-26）：** `panorama_exec_js` 已在 addon content 临时动态 HUD 桥上实现：两份源文件复制进 addon content，按需编译，用 `CustomUI:DynamicHud_Create` 加载，经 `RunScriptInPanelContext` 执行，ping 成功后删除；守护进程持有 token/状态和 ping/started/done ack 协议，桥可幂等复用。桥还提供几何、世界/光标、选择、镜头和单位命令 helper，以及后台事件 helper（`MCP.on`/`emit`/`dispatch`）。活体验证：`1+1=2`；长分块代码 `42`；`MCP.context()` 父链/全局探针；从 `DotaHud` 的全局选择器（`MCP.top/select/$`）；探针 panel 创建/删除；`MCP.text/visible/cls/style/snap` 往返；语义 helper 冒烟；地图重载后 `rebuilt:true`；通过记录的 element id 清理旧 generation HUD；content junction 仓库未变。
- [ ] **加固 Panorama 桥剩余生命周期：** 清扫失败供给、实测完整 Dota 进程重启/缓存清空，并补齐完整活体矩阵。从主菜单发起供给会返回 `bridge_compile_failed`（地图加载前 addon content 未挂载）；游戏内供给正常。
- [x] **MCP 输出与 vconsole2 GUI 的隔离（2026-10-26）：** 真正的边界是输出收集的 echo 标记对（`__mcp_<hash>_begin/end`）：relay 按标记 id 维护开放窗口集合（匹配的 end 只关闭自己的窗口，并发会话互不干扰；未闭合窗口 15 秒后过期），Lua 路径在延迟执行完才打印结束标记，异步 MCP 前缀继续过滤，直接命令使用定时静默窗口，连接时丢弃引擎回放的控制台积压。实机替身 GUI 抓包显示人类自己的 echo 在场，而 status/console/Lua/bridge/API/实体探针都没有出现。见[隔离笔记](../.agents/notes/implemented/bug-fix/2026-10-26-console-output-isolation.md)。
- [x] **隔离的实机覆盖（2026-10-26）：** 替身 GUI 接在 29001 抓原始流，同时用 MCP 工具打真引擎——status、`dota_api_lua`、`dota_dump_entities`、`dota_run_lua`、`console_send`、`dota_disconnect` → `dota_launch_game`、`panorama_exec_js`、`vfx_preview`/stop、`dota_test_run` 和 `dota_restart`。裸命令（vconsole2 路径）的人类 echo 在电池前后都可见；所有 MCP 探针签名缺席；替身 GUI 拆除后 Dota 存活。
- [x] **实机双会话交错（2026-10-26）：** 两个 MCP 会话并发发命令——A 发延迟执行的 `dota_run_lua`，B 发同步收集的 `console_send`。替身 GUI 只收到两行裸命令（vconsole2 路径）的人类 echo：两边的输出和标记都没有泄漏，且 A 在 B 结束标记之后才执行的延迟打印仍然隐藏，证明 B 的结束标记关不掉 A 的窗口。
- [ ] **决定 Panorama 的多根访问方案。** 桥只覆盖 HUD 顶层窗口：`DotaHud.GetParent()` 为 null，从桥里调用 `RunScriptInPanelContext` 会因 domain 被拒绝，活体 JS API 也没有根面板访问器，所以同级的其他顶层窗口（dashboard/调试器）无法按 id 选择。需要在调试器辅助的按 root 上下文桥和接受 HUD 边界之间做决定，并用一个具体的同级 id 验证。
- [ ] **评估可用的控制台诊断作为只读工具。** `panorama_dump_symbols 0|1`（事件与文件符号表）和 `panorama_print_cache_status`（布局引用计数）在活体可用；`panorama_print_render_tree` 对 `*` 和具名根都没有输出；`panorama_dispatch_event` 现在可用 `EventName(args...)` 语法（`CreateDebuggerWindow()` 不需要热键或游戏前台就能打开调试器；`TextEntrySetText` 仍需要 creating panel）。
- [x] **在任何交互工具之前先定下焦点接管契约。** `dota_input` 默认让游戏保持前台，恢复光标，并把 `restore_focus` 作为可选项；还原时以不激活方式重新显示被隐藏的游戏窗口。`-tools` 模式实测：Dota 失焦会隐藏游戏窗口，所以保持游戏前台才是可用的默认值。
- [x] **窗口与输入工具：** `dota_input` 提供真实鼠标/键盘输入、客户区坐标、越界拒绝、窗口信息与焦点/光标控制。活体检查覆盖激活、悬停进入/离开、Unicode 文本和按键。
- [ ] **增加阻塞式控制台等待**（`console_wait`：pattern 或 regex、超时、可选触发命令），建立在每会话游标之上，并加一个 `errors` 过滤预设。参考项目评审认为这是最有用的调试回路原语。
- [ ] **截图失败时诊断隐藏弹窗。** 当 WGC 返回 `no_window` 或 `no_new_frames`，枚举 Dota 顶层窗口，把 assert/卡死/对话框文字附到错误里；保持只读，绝不自动关弹窗。
- [ ] **评估参考项目评审里的知识层吸收项：**把 77 条 patterns 作为 `dota2_skill` 数据文件，以及通过 VRF 读 base-game KV。放弃随包 API 快照（控制台仍是权威）和手写解码器。

## 既有路线图

- [ ] **BuildTools**——npm/tstl/rollup 构建集成与脚手架生成。
- [ ] **[dota_map_error](../.agents/notes/proposed/feature/2026-08-05-dota-map-error-tool.md)**——生成的 Lua 行号到 TypeScript 源行的静态映射。
- [ ] 在游戏运行中验证 `script_find` 与 `script_dump_all` 的实际输出。
- [ ] 在更多 addon/地图组合上测试 `dota_launch_game`。

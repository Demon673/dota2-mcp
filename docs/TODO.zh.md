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

## 既有路线图

- [ ] **BuildTools**——npm/tstl/rollup 构建集成与脚手架生成。
- [ ] **[dota_map_error](../.agents/notes/proposed/feature/2026-08-05-dota-map-error-tool.md)**——生成的 Lua 行号到 TypeScript 源行的静态映射。
- [ ] 在游戏运行中验证 `script_find` 与 `script_dump_all` 的实际输出。
- [ ] 在更多 addon/地图组合上测试 `dota_launch_game`。

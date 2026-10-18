# Agent Note: 游戏截图工具

[English](2026-10-18-dota-screenshot.md) | 中文

Status: implemented

## Problem

测试 addon 的 agent 看不到游戏画面。地图一直加载不出来、相位一直不推进、或者控制台不再应答时，唯一的证据是控制台文本，而活体运行表明这些文本可能对真实状态只字不提：比如一次根本没开始的启动，或者 addon 正停在队伍选择界面上等待。这时只能由开发者看屏幕再描述出来。通过引擎控制台截图在这些情况下恰恰帮不上忙，因为它需要游戏能响应、控制台连接正常。

## Decision

`dota_screenshot` 返回一张游戏截图（见 `GLOSSARY.md`）：从游戏外部获取的 Dota 2 游戏窗口画面。spec：issue #12。

- **来源**：对游戏视口窗口使用 Windows.Graphics.Capture，即 `dota2.exe` 可见的、标题为 "Dota 2" 的顶层窗口。tools 模式下的其他窗口不在范围内。截图从不给游戏发消息、从不使用控制台。
- **后台**：窗口不需要焦点、也不需要置顶；挡在它前面的窗口不会被截进来。系统支持时关闭鼠标指针捕获和截图边框；这两个属性通过反射设置，因为较老的 Windows 10 元数据里没有它们，直接引用会让那些机器上编译失败。
- **辅助程序**：C# 源码内嵌在 TypeScript 模块里，首次使用时用 Windows 自带的 .NET Framework `csc.exe` 编译，缓存在 `os.tmpdir()/dota2-mcp/capture/<源码哈希>/`。它只引用每台 Windows 10/11 都有的 GAC facade 和 `System32\WinMetadata` 里拆分的 WinRT 元数据。`System.Runtime.WindowsRuntime` 的 await 与事件辅助依赖只有 SDK 才有的合并版 `Windows.winmd`，所以辅助程序自己包装 WinRT 异步调用，并轮询 free-threaded 帧池，而不是订阅 `FrameArrived`。仓库不附带任何二进制。
- **协议**：`helper <outPath> <maxWidth> <jpeg|png> <restore 0|1>` 输出一行 JSON：`ok`、`path`、`width`、`height`、`hung`、`restored`，或 `ok: false` 加 `error`（`no_window`、`minimized`、`no_frame`、`internal`）与 `message`。`DOTA2_CAPTURE_HELPER` 可替换辅助程序（`.js`/`.mjs` 路径用当前 node 运行）；这是离线测试替换的唯一接入点。
- **隔离**：辅助程序作为子进程运行，超时 5 秒即被杀掉。工具不受 vconsole 门控，relay 断开时也能用。
- **游戏卡死**：`IsHungAppWindow` 为真时照常返回图片，附 `hung: true` 和一条说明。
- **窗口最小化**：`restore`（默认 `true`）时，辅助程序用 `SW_SHOWNOACTIVATE` 恢复窗口，丢弃前 300 ms 的帧，最多等 2 秒拿到一帧，截图后用 `SW_SHOWMINNOACTIVE` 重新最小化。未最小化的窗口立即截图。`restore: false` 时，或保存的视频设置表明是独占全屏（`setting.fullscreen "1"`）时，最小化的窗口只报告、不恢复。
- **输出**：缩放到 `max_width`（默认 1280），默认 `jpeg` 质量 80，或 `png`，作为 MCP image 内容连同保存路径返回。文件存到 `os.tmpdir()/dota2-mcp/screenshots/`（`DOTA2_SCREENSHOT_DIR` 可覆盖），保留最近 20 张。
- **没有 Dota 窗口**：报错，绝不改为截取屏幕。**平台**：只支持 Windows。
- **其他工具**：共用的卡相位报告会提到 `dota_screenshot`；没有工具会自动附带截图。

## Alternatives considered

- **引擎控制台 `screenshot` / `jpeg`。** 否决：需要游戏能响应、控制台已连接，而这正是最需要截图时缺失的条件。
- **对窗口 DC 做 GDI `BitBlt`。** 否决：DirectX 窗口通常截出来是黑的，被遮挡的区域也截不到。
- **带 `PW_RENDERFULLCONTENT` 的 `PrintWindow`。** 否决：它要等游戏的消息循环，游戏卡死时会跟着阻塞。它原本是 WGC 辅助程序无法从源码构建时的退路；没有实现，因为源码构建在原版 Windows 11 上可行。
- **DXGI 桌面复制。** 否决：它截取整个显示器，包括挡在游戏前面的窗口。
- **附带预编译的截图程序。** 否决：它打破"无外部二进制依赖"的约定，而源码构建让它变得不必要。
- **恢复最小化窗口后保持恢复状态。** 否决：重新最小化能让桌面回到开发者离开时的样子。

## Consequences

收益：一次调用就能让 agent 看到游戏画面，每次约 0.35 秒（首次调用含编译约 0.6 秒），不涉及控制台、vconsole 或焦点。代价：只支持 Windows；首次调用需要系统的 `csc.exe`；恢复最小化窗口时会短暂闪一下；图片会消耗 agent 的 token，默认宽度限制了开销。独占全屏检查读的是保存的设置，游戏里改了模式但没保存时检测不到。

## Testing

- `scripts/test-screenshot.mjs`（离线，Windows 和 Linux 都能跑）：经 stdio 驱动真实的 MCP server，`DOTA2_CAPTURE_HELPER` 指向一个假的 node 辅助程序。它断言 image 内容和保存路径、`max_width`/`format`/`restore` 能传到辅助程序及其默认值、`hung: true` 标注、最小化窗口被恢复、`restore: false`、没有窗口和超时三种错误，以及只保留 20 个文件——全程没有 Dota、vconsole 或 relay 连接。
- 活体（Windows 11，Dota 2 带 `-tools`）：系统 `csc.exe` 编译出了辅助程序；对主菜单窗口截图，返回的 1280×741 JPEG 和 640×370 PNG 只包含游戏视口，开发者的前台窗口没有变化。

未覆盖：Dota 2 忽略来自外部的最小化请求（`SW_SHOWMINNOACTIVE` 与 `WM_SYSCOMMAND SC_MINIMIZE`），所以恢复路径只对假辅助程序跑过；截取卡死的游戏、Windows 换上"无响应"占位窗口后 WGC 返回的画面、截图边框是否真的被隐藏，都尚未活体验证。独占全屏分支和非 Windows 报错没有自动化测试。

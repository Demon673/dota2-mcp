# Agent Note: 游戏截图工具

[English](2026-10-18-dota-screenshot.md) | 中文

Status: implemented

## Problem

测试 addon 的 agent 看不到游戏画面。地图一直加载不出来、相位一直不推进、或者控制台不再应答时，唯一的证据是控制台文本，而活体运行表明这些文本可能对真实状态只字不提：比如一次根本没开始的启动，或者 addon 正停在队伍选择界面上等待。这时只能由开发者看屏幕再描述出来。通过引擎控制台截图在这些情况下恰恰帮不上忙，因为它需要游戏能响应、控制台连接正常。

## Decision

`dota_screenshot` 返回一张游戏截图（见 `GLOSSARY.md`）：从游戏外部获取的 Dota 2 游戏窗口画面。spec：issue #12。

- **来源**：对游戏视口窗口使用 Windows.Graphics.Capture，即 `dota2.exe` 可见的、标题为 "Dota 2" 的顶层窗口。tools 模式下的其他窗口不在范围内。截图从不给游戏发消息、从不使用控制台。
- **后台**：窗口不需要焦点、也不需要置顶；挡在它前面的窗口不会被截进来。系统支持时关闭鼠标指针捕获和截图边框；这两个属性通过反射设置，因为较老的 Windows 10 元数据里没有它们，直接引用会让那些机器上编译失败。
- **辅助程序**：C# 源码内嵌在 TypeScript 模块里，首次使用时用 Windows 自带的 .NET Framework `csc.exe` 异步编译（冷编译不阻塞 MCP server），缓存在 `os.tmpdir()/dota2-mcp/capture/<源码哈希>/`。它只引用每台 Windows 10/11 都有的 GAC facade 和 `System32\WinMetadata` 里拆分的 WinRT 元数据。`System.Runtime.WindowsRuntime` 的 await 与事件辅助依赖只有 SDK 才有的合并版 `Windows.winmd`，所以辅助程序自己包装 WinRT 异步调用，并轮询 free-threaded 帧池，而不是订阅 `FrameArrived`。每个编译者写自己的源文件和产物，再改名放进缓存；竞争失败的会话直接使用已缓存的 exe。仓库不附带任何二进制。
- **常驻缓存**：`helper --watch <stateDir> <helperPath>` 是同一状态目录下所有 MCP 会话共享的 detached 单例进程，在控制台首次连接 Dota 或首次调用截图时启动。原子 `watcher.lock` 记录协议版本、PID 和辅助程序路径，C# 进程在整个生命周期内以 `FileShare.Read` 持有它。升级时比较同一个锁实例里的路径，停止旧助手并等待锁释放。句柄已不再持有的陈旧锁会先改名隔离再删除，绝不凭其中可能已复用的 PID 杀进程。助手只在内存里保存既有 WGC 会话交付的最新帧，不会定时写截图文件，也不会定时重建会话：新会话可能重放同一张旧窗口画面，这不能刷新 `captured_at` 或清除 `stale`。Dota 窗口或进程变化会清空缓存。连续五分钟没有 Dota 进程且没有请求时退出。
- **协议**：请求是四行的 `<id>.request` 文件（`outPath`、`maxWidth`、`format`、`restore`）；辅助程序原子替换 `<id>.reply`，JSON 包含 `ok`、`width`、`height`、`hung`、`restored`、`stale`、`captured_at`，或 `ok: false` 加 `error`（`no_window`、`minimized`、`no_frame`、`internal`）与 `message`。开始处理前写入 `{"accepted":true}`，恢复最小化窗口前写入 `{"restoring":true}`。`helper --minimize` 仍是助手异常退出后用于清理的一次性命令。`DOTA2_CAPTURE_HELPER` 可替换辅助程序（`.js`/`.mjs` 路径用当前 node 运行）；这是离线测试替换的唯一接入点。`DOTA2_CAPTURE_DISABLE_WATCHER=1` 只为离线控制台测试禁用自动启动；显式截图调用仍会启动 watcher。
- **隔离**：请求超时为 5 秒。只有已 accepted 的请求超时才会停止 watcher；仍在串行队列里等待的请求不会杀掉健康的共享助手。工具等待锁释放（假助手则等待进程退出），只删除仍与旧锁一致的状态。助手若已报告 `restoring`，超时和意外退出两条路径都会运行 `helper --minimize`，不激活地把窗口重新最小化。旧协议文件会被丢弃或定期清理。截图失败时删除输出文件。截图相关子进程使用已清除常见凭据的环境。工具不受 vconsole 门控，relay 断开时也能用。
- **游戏卡死**：没有新帧到达时，watcher 立即返回最新的缓存帧。恢复最小化窗口后没有新帧、缓存尺寸与窗口不再一致、或缓存超过一秒未更新时，结果标为 `stale: true`；始终带 `captured_at`，让 agent 能判断新鲜度。`hung: true` 独立来自 `IsHungAppWindow`。如果 watcher 从未取到帧，持续卡死仍返回针对卡死的 `no_frame` 错误；工具不会改为截取屏幕或返回没有旧帧标记的旧图片。
- **窗口最小化**：`restore`（默认 `true`）时，辅助程序用 `SW_SHOWNOACTIVATE` 恢复窗口，保留 300 ms 内到达的最新一帧（活体实测：不激活恢复的 Dota 不会渲染新帧，而 Windows 立即交出的那一帧就是窗口的正确内容），截图后用 `SW_SHOWMINNOACTIVE` 重新最小化。未最小化的窗口立即截图。`restore: false` 时，或保存的视频设置表明是独占全屏（`setting.fullscreen "1"`）时，最小化的窗口只报告、不恢复。
- **输出**：缩放到 `max_width`（默认 1280），默认 `jpeg` 质量 80，或 `png`，作为 MCP image 内容连同保存路径返回。文件存到 `os.tmpdir()/dota2-mcp/screenshots/`（`DOTA2_SCREENSHOT_DIR` 可覆盖），保留最近 20 张；清理只涉及工具自己生成的文件名。
- **没有 Dota 窗口**：报错，绝不改为截取屏幕。**平台**：只支持 Windows。
- **其他工具**：共用的卡相位报告会提到 `dota_screenshot`；没有工具会自动附带截图。

## Alternatives considered

- **引擎控制台 `screenshot` / `jpeg`。** 否决：需要游戏能响应、控制台已连接，而这正是最需要截图时缺失的条件。
- **对窗口 DC 做 GDI `BitBlt`。** 否决：DirectX 窗口通常截出来是黑的，被遮挡的区域也截不到。
- **带 `PW_RENDERFULLCONTENT` 的 `PrintWindow`。** 否决：它要等游戏的消息循环，游戏卡死时会跟着阻塞。一次有时间上限的独立活体实验确认，卡死时它会超过 3 秒上限。WGC 辅助程序构建失败的机器上，工具返回带编译器输出的错误，不提供截图。
- **每次调用都新建 WGC 会话。** 不用于工具主路径：持续卡死时，新会话可能完全收不到帧。常驻会话改为保留最后一个正常帧。一次性 CLI 只保留作兼容路径和 `--minimize`。
- **定时重建 WGC 会话或用 `SystemRelativeTime` 去重。** 否决：重建会把旧画面重放成新帧，而且即使编码后的图片逐字节相同，该时间戳也可能前进。因此新鲜度只以当前常驻会话的交付为准。
- **返回旧图片但不给新鲜度信息。** 否决：`stale` 和 `captured_at` 明确区分当前帧与缓存帧。
- **只用 PID 判断 watcher 锁。** 否决：崩溃后 Windows 可能复用 PID，存活判断与终止必须绑定到仍被持有的锁句柄，不能只凭这个数字。
- **DXGI 桌面复制。** 否决：它截取整个显示器，包括挡在游戏前面的窗口。
- **附带预编译的截图程序。** 否决：它打破"无外部二进制依赖"的约定，而源码构建让它变得不必要。
- **恢复最小化窗口后保持恢复状态。** 否决：重新最小化能让桌面回到开发者离开时的样子。

## Consequences

收益：一次调用就能让 agent 看到游戏画面，新帧约 0.35 秒、缓存帧约 0.07 秒，不涉及控制台、vconsole 或焦点。只要 watcher 已经取到过一帧，之后持续卡死就不再依赖 Windows 提供新帧。代价：只支持 Windows；首次调用需要系统的 `csc.exe`，只在一台 Windows 11 上验证过；Dota 运行期间保留一个常驻助手及其帧内存；Dota 在后台停止呈现时，结果保持 `stale`，直到既有会话再次交付；恢复最小化窗口时会短暂闪一下；图片会消耗 agent 的 token，默认宽度限制了开销。如果第一次调用时游戏已长期卡死，仍可能因为没有缓存而失败。独占全屏检查读的是保存的设置，游戏里改了模式但没保存时检测不到。

## Testing

- `scripts/test-screenshot.mjs`（离线，Windows 和 Linux 都能跑）：经 stdio 驱动真实的 MCP server，`DOTA2_CAPTURE_HELPER` 指向一个假的常驻 node 辅助程序。覆盖助手复用、图片字节与保存路径、参数传递、新帧与缓存结果、卡死与无缓存错误、最小化恢复、accepted 请求超时后终止、排队请求超时不终止、超时或助手丢失后的补最小化、协议文件清理、空锁恢复、启动失败、独占全屏和截图清理。进程退出钩子会清理 MCP 启动的和进程内启动的假 watcher。
- 活体（Windows 11，Dota 2 带 `-tools`）：系统 `csc.exe` 编译辅助程序。普通 MCP 控制台调用就会在未显式请求截图时启动常驻 watcher。后台停止渲染时，连续截图保留原时间戳并标记 `stale`；测试中临时开启 `r_always_render_all_windows` 后，时间戳前进、结果恢复为新帧。三个并发 MCP 会话共享一个 watcher 且都取得图片。可见与最小化窗口都只返回游戏视口；最小化窗口被恢复、截图、再最小化，前台窗口不变，`restore: false` 则保持最小化。
- 生命周期活体测试：真实助手在报告 `restoring` 后被杀，Dota 仍会重新最小化，下一次调用会启动替代助手。Dota 进程快速重启后不会返回旧缓存，同一 watcher 会得到新的帧时间戳。Dota 缺席且无请求时，watcher 约五分钟退出（实测 303 s）；重新启动 Dota 后，截图会按需拉起它。隔离测试把调用方自己仍在运行的 PID 写进陈旧锁，锁被隔离而调用方未被杀。
- watcher 已有缓存后，用次数有限的 Lua 忙等做活体测试：约第 3 秒和第 8 秒的截图都在约 0.07–0.09 秒返回正确的游戏视口。后一次结果带 `hung: true`、`stale: true` 和原帧时间戳，不再出现此前的 `no_frame` 错误。游戏跑完有限循环后，后续 Lua 执行成功。另一项使用真实助手的隔离测试把调用方自己仍在运行的 PID 写进未持有的陈旧锁：锁被隔离，新 watcher 正常启动，调用方没有被杀。完整离线套件也能在活体 daemon 和 watcher 旁通过，二者状态与 PID 不变，且没有测试辅助程序残留。

未经活体覆盖：Windows 换上“无响应”占位窗口后 WGC 返回的画面、截图边框是否被隐藏、窗口尺寸变化后的缓存失效（当前视频模式拒绝了 Win32 和 cvar 两种调整尝试）。恢复窗口过程中的真实超时仍只由假助手测试覆盖；真实助手异常退出路径已单独验证。

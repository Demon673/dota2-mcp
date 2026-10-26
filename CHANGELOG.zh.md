# 更新日志

[English](CHANGELOG.md) | 中文

## 2.0.0 (2026-10-25)

### 新增

- **`dota_screenshot`**：在后台截取 Dota 2 游戏窗口画面并返回给 agent。多个 MCP 会话共享的常驻助手在控制台连接 Dota 或首次调用工具时启动，在内存里缓存最新帧。缓存结果带 `captured_at` 和 `stale: true`，所以助手启动后即使游戏卡死、Windows 不再供帧，也能返回已有画面。不需要控制台或 vconsole，不抢焦点，最小化的窗口只在截图时临时恢复。仅支持 Windows；辅助程序在首次使用时用系统自带的 C# 编译器编译。
- **`dota_advance_to_game`**：一次调用把已加载的游戏从任一开局前相位推进到 GAME_IN_PROGRESS，每个玩家都有英雄（随机，或指定 `hero`），只按观测到的游戏状态行动。标准流程：`dota_launch_game` 或 `dota_restart`，然后 `dota_advance_to_game`。`dota2-game-phases` skill 与卡相位指引现在都指向它。
- **按需读取 skill**：`dota2_skill` 的目录包含 `###` 小节，`section` 同时支持 skill 正文和 Markdown 数据文件，JSON 数据支持 `e_combos.top10` 这类点路径 `data_path`。仍保留全文和整文件读取，但 VFX/模型制作不再依赖这些大结果。
- **`dota2-vfx` 提供第一个端到端配方**：“Recipe: AoE telegraph + impact” 覆盖父子结构、贴地环状 sprite、以控制点 0 作为标记位置、1.5 秒前摇、创建与销毁实例的 modifier 钩子，以及带分时证据的 sprite 预算。
- **`dota2-vfx` 增加投射物配方**：“Recipe: Projectile + trail + impact” 说明为什么短寿命高频的头部会跟随控制点 0、而寿命更长的轨迹会留在原地，为什么命中特效要在落点单独创建而不是做成延迟子特效，以及 ability 需要每帧更新控制点。
- **`dota2-vfx` 增加光环配方**：“Recipe: Persistent buff/debuff aura” 覆盖用 `PATTACH_ABSORIGIN_FOLLOW` 代替自己管理控制点、逐粒子淡入淡出让循环看起来像呼吸、`DestroyParticle` 即时截断与自然淡出的取舍，以及单个资产无法按队伍染色时颜色该放在哪里。配方同时带上 `LinkLuaModifier` 接线，并用真实 modifier 验证了创建、时长到期和移除三种情况下画面都会清干净。
- **`vfx_preview` 会说明粒子到底能不能被画出来**：它先把路径解析为 addon 资产，再扫 addon 的 `scripts/vscripts` 找是否有 `PrecacheResource` 声明了这个路径。没声明的资产会返回 `precache: MISSING` 以及需要补的那一行，而不是给出一份看起来成功、实际什么都不画的预览结果；引擎自带资产则说明它从游戏自己的包里加载。
- **`dota_record`**：录制游戏窗口（Windows.Graphics.Capture，窗口被遮挡或失焦也能录）为 MP4，返回路径、时长、帧率与实际编码尺寸。默认 12 fps，上限 30。当 Windows 对失焦窗口停止出帧时，工具会在控制台可用时自动设 `r_always_render_all_windows 1`、重试一次并还原；没有控制台时直接给出补救方法。窗口最小化会明确失败。
- **`dota_perf`**：用固定版本的 PresentMon（首次使用时下载并做 sha256 校验）采集帧时间，返回 p50/p95/p99、样本数与采集时长；`baseline` 可对比两次采集。PresentMon 需要管理员终端——没有提权时工具会说明这一点，而不是返回空采样。失焦游戏可能停止呈现新帧；控制台可用时空采样会自动用 `r_always_render_all_windows` 重试一次（随后恢复原值）。
- **`dota_test_run`**：在真实游戏里执行 `scripts/vscripts/tests/<name>.lua` 的断言测试。每条测试走独立控制台语句，单条失败不中断其余；挂起的测试按单条与整体两级预算限时。返回结构化的 `{name,status,detail}` 与 pass/fail/timeout 计数。
- **`panorama_exec_js`**：在临时的动态 HUD 桥里执行 JavaScript，让 agent 不改 addon 就能检视和操作客户端 UI。桥的布局与脚本会复制进 addon content、按需编译、经 `CustomUI:DynamicHud_Create` 加载、通过 `RunScriptInPanelContext` 执行，并在 ping 成功后删除；守护进程持有 token、generation 与 started/done ack 协议，并复用存活的桥。它提供面板发现与搜索、几何、世界与光标转换、游戏状态和后台事件。覆盖范围是 HUD 顶层窗口；dashboard 与调试器根有独立的 JavaScript 上下文。地图重载会重建 HUD，多个 MCP 会话共享同一座桥。
- **`dota_input`**：向游戏窗口发送真实的 OS 鼠标与键盘输入——move/click/down/up/drag/wheel、key press/down/up 与 Unicode 文本——使用客户区像素坐标，越界坐标在发送前就被拒绝。`window_info` 只读取窗口几何和前台状态，不发送输入。默认让游戏保持前台（`-tools` 模式下失焦会隐藏游戏窗口），只有 `restore_focus:true` 才还原前一个前台窗口。仅支持 Windows。

### 变更

所有工具现在返回同一种契约形状：成功为 `{"ok":true, ...}`，载荷为 `lines`、`text` 或 `data` 之一；失败为 `{"ok":false, "code": "...", "message": "..."}` 且 `isError`。38 个工具全部带四类 MCP annotations，每条描述都写明何时使用、做什么、返回什么、上限与相关工具。工具名保持不变；旧参数名在本版本内继续作为别名可用。

| 范围 | 2.0 之前 | 2.0 |
|---|---|---|
| 所有返回值 | 裸文本，少数工具是原始 JSON | `{ok:true, lines\|text\|data}` / `{ok:false, code, message}` |
| 工具元数据 | 没有 annotations | 全部工具四类 hint（`readOnly`/`destructive`/`idempotent`/`openWorld`） |
| `console_output` | 最后 N 行，每次读取都重复 | 游标增量；`tail` / `since_seq` / `from_start`，回报 `next_seq` 与 `dropped`，过滤器不吞掉未匹配行；`lines` 保留为 `tail` 的别名；首次调用取最近 50 行 |
| `console_send` | 只回 `Sent N command(s)` | 返回该命令自己的输出窗口并推进游标；之后的输出仍可用 `console_output` 读到 |
| `dota_status` | 文本摘要，含 `running` / `allMaps` | `data` 能力矩阵（`daemon`、`vconsole`、`dota`、`phase`、`cheats`、`addon`、`map`、`available_actions`）；移除 `running` / `allMaps` |
| `dota_restart` | 文本 | 20 秒无变化现在是 `timeout` 失败 |
| `file_read` | 原始文件内容 | `data:{path,bytes,text}` |
| `dota2_skill` | `data_path` 直接返回原始 JSON | JSON 放在 `text` 字段里 |

### 修复

- **Lua 工具输出漏进 vconsole**：`dota_run_lua` / `vfx_preview` 的输出和收集标记不再出现在 vconsole 窗口；Lua 运行时报错不再让窗口一直静默。
- **过长的 Lua 静默无效**：引擎会丢弃超过约 510 字节的控制台语句；`dota_run_lua` 现在对这样的代码明确报错。
- **`dota_launch_game` 把正常的地图加载误报为卡在 INIT。**
- **`dota_restart` 在重启生效前就返回**：现在等到重载真正开始才返回。
- **重启与子进程加固**：`dota_restart` 使用真实的 20 秒墙钟 deadline，不再因慢状态轮询累加超时。截图与 VRF 子进程会移除常见凭据变量，VPK 查询缓存也有上限。
- **`sv_cheats` 关闭时 Lua 类工具不报错**：此时引擎忽略 `ent_fire`；`dota_run_lua`、`dota_advance_to_game` 和 VFX 工具现在立即失败，错误里点名 `sv_cheats`。
- **`dota_launch_game` 把地图加载期间引擎不应答误判为卡相位**；启动后游戏仍停在主菜单时，现在会明确报告。
- **API 查询返回整份引擎转储**：`dota_api_lua`、`dota_api_panorama_js`、`dota_api_css` 和 `dota_api_events` 现在只返回匹配条目。实体与 modifier 转储也支持子串过滤；`dota_dump_modifiers` 默认列出服务端生效的 modifier，而不是客户端注册表。
- **晚接入的瘦客户端用 `console_channels` 查不到通道**：守护进程握手现在带上已经从 Dota 注册的通道表。
- **Lua 与 VFX 结果错误**：标量 `expression` 直接打印结果；工具描述改用有效 API 示例并写明 `sv_cheats=1` 要求；`vfx_preview_stop` 不再把 `DestroyParticle` 的 void 返回值写成 `ok=nil`。
- **卡死截图失败的原因含糊**：持续无响应导致 Windows.Graphics.Capture 不再供帧时，`dota_screenshot` 返回常驻缓存，并明确标注 `stale` 和采集时间。如果从未缓存到帧，则报告真实原因，而不是提示窗口正在启动或位于其他桌面。它不会改为截取屏幕或返回没有旧帧标记的旧图片。
- **截图超时预算含糊**：helper 就绪后，每次调用在 watcher 启动、捕获、停止和补最小化之间共享一个 5 秒墙钟 deadline。冷编译仍是独立的一次性准备阶段。若恢复窗口时到期，结果明确说明清理未完成，而不是无限等待。
- **截图新鲜度被高估**：watcher 不再定时重建捕获会话，新会话不能把同一张旧窗口画面重新标成新帧。后台画面保持旧帧标记，直到既有会话真正交付新帧。
- **VFX 最小模板无法渲染**：现在包含经过实机验证的 `C_OP_RenderSprites` 路径，工作流除检查非零粒子 PID 外，还要求比较创建和停止后的截图。旧演练中放错块的 emitter 和错误发射字段已修正。
- **自建粒子因为没 precache 而永远不显示**：客户端只绘制地图加载时已载入的系统，因此没写进 addon `Precache(context)` 的路径会返回有效粒子 ID、在 `cl_particles_dumpsimlist` 里也照样有条目，但画面上什么都没有。`dota2-vfx` skill 现在把 precache 写成工作流的一步和一条陷阱，`vfx_preview` 的工具描述也写明了这一点。同一轮还记录了两件事：resourcecompiler 会静默丢弃 `m_nControlPointNumber` 和任何简写形式的 `m_TransformInput` 结构体，导致特效停在世界原点；以及带 `stale: true` 的截图是旧帧，不代表画面为空。
- **VRF 与粒子引用兼容性**：VRF pin 升级到 20.1，可读取当前引擎的 KV 类型 26。`asset_check_refs` 现在会解析共享 addon 产物和 `pak01_dir.vpk` 中的精确路径，不再把有效的引擎材质误报为 broken。`asset_inspect` 现在同时统计持续和瞬时 emitter。VRF 失败产物留在临时工作目录，不再写入调用方仓库。

- **`file_edit` 写坏含 `$` 的文件**：`new_string` 里的 `$'`、`$&`、`$1` 现在按字面写入，不再被展开。
- **借 `addon` 绕过 FileOps 路径边界**：`.`/`..` 或含 `/`、`\`、`:` 的 addon 名会被拒绝。所有 FileOps 与资产工具共用同一个 addon 解析入口。
- **非 ASCII 控制台文本**：VConsole2 输出与命令改为 UTF-8，中文 `print` 输出和非 ASCII Lua 不再乱码。
- **过期游戏状态**：查询没有回应时，`dota_status` / `dota_launch_game` 不再回落到日志里旧的 `status_json`。
- **工具结果混入其他输出**：控制台类工具只保留每次调用的 begin/end 回显标记之间的行，隔离其他会话与游戏自身的打印。每个标记对只开关自己的窗口（未闭合窗口 15 秒后过期），并发会话不会互相截断输出。
- **本地降级 relay 的 :29002 无认证**：现在执行与守护进程相同的 token 握手。
- **离线守护进程测试破坏活体状态**：改用独立的 `DOTA2_VCON_STATE_DIR`，不再删除真实的 relay token、pid 和锁文件。
- **VRF 失败被报告为成功**：CLI 失败或根资产无法反编译时，`asset_inspect` 与 `asset_check_refs` 返回错误。
- **`dota_launch_game`** 在已加载其他地图时也会启动请求的地图。
- **vconsole 重连**：被取代的 GUI socket 不再断掉在线连接；命令执行中途切换 MCP 屏蔽不再让 GUI 静默。
- **关闭 relay 的 Dota socket 可能让 Dota 致命报错（10038）**：有未读数据或发送未完成时，引擎的 socket 关闭路径会触发 `Plat_FatalError`。现在的拆除流程会先等待约 300 毫秒输出安静、半关闭并排空，控制端口提供 `SHUTDOWN` 以便干净地停止守护进程。
- **Linux/macOS Steam 检测**：默认 Steam 根目录从用户主目录解析（`~` 此前从未被展开）。
- **打包**：`prepack` 打包前先编译。
- **独立可执行程序启动即失败**：SEA 包在模块加载时因 `createRequire(import.meta.url)` 抛错；修掉之后，exe 在没有现成守护进程时仍起不来。现在包使用双模式 `require`，通过 `node:sea` 识别 SEA，exe 内跳过守护进程 spawn、回退到本地 relay，并在可执行文件旁解析 skills。Windows 产物保留 `.exe` 扩展名，发布工作流在上传前会先运行打包产物。

### 变更

- 瘦客户端断线期间发送的命令直接丢弃，不再在重连后补发。

### 依赖

- 移除 `find-steam-app`（它在当前 `libraryfolders.vdf` 格式上抛错，手动解析已覆盖）。

## 1.6.0 (2026-08-20)

### 新增（特效与模型处理能力，9 个新工具，总数 22 → 31）

- **FileOps 四件（离线）**：`file_read` / `file_write` / `file_edit`（old_string→new_string 恰好一次匹配）/ `file_delete`（返回内容快照）——读写 addon 内文本源文件；路径限制 `content|game/dota_addons/{addon}/`，规范化前缀检查拒绝 `../` 逃逸与其他 addon。

- **`vrf_ensure`（离线）**：VRF CLI 半集成——检测 / 下载 pin 版本（默认 20.0，自包含无 .NET 依赖）/ sha256 校验（篡改拒绝且不缓存）/ 缓存 `os.tmpdir()/dota2-mcp/vrf/`；按 release assets[] 动态匹配 `cli-{os}-{arch}.zip`，缺了才联网。

- **`asset_inspect`（离线）**：VRF 反编译 + 五类型结构化摘要（vpcf/vmdl/vmat/vtex/unknown），键排序稳定可 diff；`include_raw` 显式截断 4000 字符。

- **`asset_check_refs`（离线）**：单资产递归引用完整性——ok / uncompiled（源在产物缺）/ engine_refs（两级解析落 game/dota）/ broken 四桶；`max_depth=3` + visited 防环。

- **`vfx_preview` / `vfx_preview_stop`（需游戏 + vconsole）**：运行时粒子实例预览——ParticleManager:CreateParticle（PATTACH_* 全枚举、可选世界坐标）返回 pid；以 console 加载错误为准（id 不能证明加载成功）；继承 `dota_run_lua` 门控通道（非新增限制）。

- **内置 skill `dota2-vfx` / `dota2-model`**：vpcf/vmdl/vmat/vtex KV3 写作速查（真实模板验证）、管线模型、SOP、工具映射、常见错误表、最小模板；完整字段参考章节 TODO(rare) 分批补全。

- **`dota2_skill` 分节参数**：`section`（返回单个 `##` 章节）/ `outline`（标题目录），应对字面全量 skill 的大正文。

### 修复

- **WSL 路径检测**：`detectDotaPath()` 加 `toHostPath()`——非 win32 平台 Windows 盘符路径映射 `/mnt/<drive>/`；注册表经 WSL interop 查询、默认位置全平台探测。修复 WSL 下所有文件系统类工具不可用的问题。

### 依赖

- 新增 `adm-zip`（纯 JS；VRF 发布包解压，保持无外部二进制规则）。

### 测试

- 新离线脚本：`test-fileops` / `test-vrf-ensure` / `test-asset-inspect` / `test-asset-check-refs`；新活体脚本：`test-vfx-live`（launch → spawn → stop）。

- 活体测试暴露并记录测试 addon 两前置：basic 模板 `addoninfo.txt` 为空 KV3 需声明 maps/IsPlayable；地图先编译（resourcecompiler → `game/maps/*.vpk`）才能 launch。

## 1.5.1 (2026-07-22)

### 文档

- **README 安装路径收敛为 npx 唯一推荐**（保证使用者始终自动最新），删除全局安装与独立 exe 安装指引（exe 仅保留一行特殊场景说明）；各客户端配置从一行表格扩为完整指引（Claude Code/Desktop、Cursor、VS Code、Cline、Codex TOML，含配置文件位置与粘贴即用 JSON）；新增启动后验证步骤与连接问题排查表（`--prefer-offline`、cmd 包装、未连接/vconsole 报错指向）；前置条件与 FAQ 按门控模型同步。

## 1.5.0 (2026-07-22)

### 行为变更（Breaking）

- **严格 vconsole 门控连接模型：没窗口就不连 Dota**。1.4.0 的契约是「政策假象」——工具物理上能用（29000 通着）却被规则拦下，使用者分不清是设计还是 BUG。现改为状态物理为真：无 GUI 时 relay 只以 1s 间隔探测 `:29000` 就绪（TCP 连一下即断，不持有）；vconsole2 连上 `:29001` 后 relay 才连 `:29000`；GUI 断开立即断开 29000。从此「没窗口 = 没连接 = 没工具」，没有例外。**接受代价：agent 不能脱离 vconsole 工作**（产品哲学：人必须能旁观 agent 的控制台活动）。副产品：窗口一关 29000 即释放，AssetBrowser 的 vconsole 按钮恢复可用——「自己点不开」在根上消失。

- 状态广播/hello-ok 增加 `ready` 字段，工具报错精确区分「Dota 没在跑」与「只是没开 vconsole」。

### 新增

- **探测到 Dota 就绪自动打开 vconsole**：就绪上升沿（Dota 由不在变为在）且无 vconsole2.exe 进程时自动拉起（`DOTA2_VCON_AUTO_OPEN_VCONSOLE=0` 关闭）。触发点只有就绪沿，天然无拉起循环；手动关闭后不会被立刻重开，下次 Dota 重启才会再次尝试。

### 修复

- `close()` 未关闭控制端口 server 的端口泄漏。

## 1.4.0 (2026-07-22)

### 行为变更（Breaking）

- **vconsole 显式契约**：控制台类工具（17 个）现在要求 vconsole2 已打开并连接 `127.0.0.1:29001`，否则报明确错误并给出打开路径（调用 `dota_open_vconsole`，或手动运行 exe）。设计意图：保证使用者始终能旁观 agent 的控制台活动，失败显式可见而非隐式兜底。注意：AssetBrowser 的 vconsole 按钮在 relay 持有 29000 时被引擎禁用（实测：引擎把 relay 当作已连接的 vconsole），打开 vconsole 请直接运行 `game/bin/win64/vconsole2.exe`。

- **`project_info` 删除，并入 `dota_status`**：`dota_status` 吸收其全部字段（allMaps/clients/cpu_usage 等），作为入口/导航工具永不抛异常——Dota 未连接或 vconsole 未打开时返回状态与下一步指引。工具总数 22 不变。

- `dota_status` 输出结构随之变化（新增 `vconsole`/`maps`/`allMaps`/`running{}` 字段）；各控制台工具描述统一追加「需要 vconsole 已打开」前提。

### 新增

- **`dota_open_vconsole`**：显式拉起 vconsole2.exe 并等待其接入 relay（30s）。检测到已有未接入的陈旧实例时给显式提示（vconsole2 单实例，重复 spawn 只聚焦旧窗口）。

- **`dota_launch_game` 相位推进指引**：成功终点从「地图已加载」改为进入 GAME_IN_PROGRESS（timeout 默认 45s→90s）；同一相位 15s 未推进即返回 stuck 报告：相位原文、内置 `PHASE_GUIDANCE` 推进指引（精确到 dota_run_lua 调用）、近期 VScript/错误行、skill 文档指路。典型场景：卡 CUSTOM_GAME_SETUP 时按指引一句 `GameRules:FinishCustomGameSetup()` 推进（已活体端到端验证）。

- **`dota2-game-phases` skill 文档**：各 game_state 的正常时长与推进方法、卡相位处置 SOP（先 console_output 查 addon 报错，再按表推进）。

### 修复

- **vconsole 晚开是空壳**：relay 不给晚接入的 GUI 重放初始化帧（AINF/CHAN/CVRB/CFGV/ADON），窗口拿不到通道表/cvar/addon 信息。现按到达顺序缓存并在 GUI 接入时重放，随开随用。

- **对端装死永不重连**：真实崩溃/挂起时 socket 不发 FIN，relay 永远以为连着，MCP 命令发进黑洞。新增活性探测：静默 15s 发 echo 探针，20s 无响应判死重连；探针行对 MCP/GUI 双向过滤。

- **守护进程空闲退出切断 vconsole 生命线**：无客户端 5 分钟退出后 29001 消失，vconsole 无处可连。Dota 进程在跑时不再空闲退出。

- **daemon 模式下契约/开窗全失效**：GUI 接入/断开从不广播 status，瘦客户端的 guiConnected 只在握手时同步一次，vconsole 开了 MCP 也不知道。现 GUI 状态变化即广播。

- **重连调度重复**：error/close/catch 三路各排 timer（日志每轮重试打两行），合并为单一定时器。

- **Dota 启动早期误杀正常引擎**：初版 AINF 超时（10s 无 AINF 判死）在开机阶段反复误杀——监听器先于 AINF 子系统就绪（实测 >20s）。移除 AINF 计时器，僵尸检测统一走探针（~35s，无误报）。

- **地图加载期误报 stuck**：加载期间 game_state 恒为 INIT，被 15s 阈值误判卡住。加载期跳过判定；加载真卡死由 timeout 兜底（报告含 ResourceSystem 错误）。

### 改进

- **开发-验证工作流落入文档**（AGENTS.md）：9 个冒烟脚本清单（离线/活体分类）+ 离线先行 / 活体三层验证（29002 协议、MCP stdio、系统状态）/ 连接生命周期场景矩阵方法论。新增离线 `test-relay.mjs`、`test-mcp-offline.mjs` 与活体 `test-mcp-live` / `test-launch-phases` / `test-crash-recovery` / `test-multi-session` 系列脚本。

- **可移植性规则**（Conventions）：文档/脚本禁盘符绝对路径（`{dota2Path}` 占位 / `detectDotaPath()` 检测）、禁具体项目名（daemon hello-ok 推断 + `DOTA2_TEST_*` 覆盖）、启动参数默认最小集、测试项目不确定主动问开发者。

## 1.3.2 (2026-07-20)

### 改进

- **VCon 连接模型：relay 常驻持有 Dota 2 连接**。启动即主动连接 `:29000`，断线每 2s 自动重连；不再等 vconsole2 GUI 连上才建立连接，GUI 断开也不再释放。GUI 降级为可选观察者，纯 AI 工作流开箱即用——此前 MCP 启动后必须有 GUI 连上 `:29001` 工具才可用。

- `waitForRelay` 从 10s 放宽到 30s：守护进程冷启动（node 冷启动 + Dota 2 路径检测读注册表，叠加 Windows Defender 扫描）可能超过 10s，此前会误入本地降级。

### 修复

- **瘦客户端重连链首次失败即断裂**：`_scheduleReconnect` 失败回调为空、close 仅在 `wasConnected` 时排程，"断线无限重连"实际在一次失败后就永久停止（老测试断言空转所以未暴露）。修复后真正无限退避重连（封顶 5s），断线期间命令缓冲重连补发。

- **会话内自动重拉守护进程**：守护进程进程被杀（非空闲退出）时，瘦客户端连续约 5 次重连失败后自动重跑 `createRelay()` 拉起新守护进程并整体替换接入，工具无感恢复。此前只能干连 `:29002` 直到新会话启动。

- **本地降级模式 5 分钟后进程自杀**：`start()` 无条件武装空闲退出计时器，本地内嵌 relay 永远无客户端，5 分钟 `process.exit(0)` 静默杀掉 MCP 会话。空闲退出改为仅守护进程模式启用。

- **重拉瞬态失败导致会话永久失联**：`createRelay` 抢锁分支 `client.connect()` 未捕获，异常逃逸后 relay 引用停留在已销毁客户端，工具永久报未连接。现捕获并走本地降级，respawn 失败 5s 自动重试。

- **connect 超时泄漏 socket**：8s 超时只 reject 不销毁，对 hang 住的守护进程持续泄漏 FD 和监听器；超时现销毁 socket 并计入重连/重拉统计。

- **守护进程超时未杀变僵尸**：`waitForRelay` 超时后慢启动的 daemon 仍会上线绑端口，与降级的本地 relay 双绑并存；超时现先杀再降级。

- **fallback 双 start 自锁**：本地 relay 已被 `createRelay` 启动后又被 `index.ts` 启动第二次，自撞 EADDRINUSE 并误报"多实例冲突"。

- `dota_status`/工具未连接提示、README、AGENTS.md 同步新连接模型（vconsole2 GUI 不再列为使用前提）。

## 1.3.1 (2026-07-18)

### 新增

- **`dota2_skill` 内置技能工具**（Roblox skill 模式）：skill 内容随 MCP 分发，agent 调用 `dota2_skill` 即可拉取，无需单独安装 skill 文件。首个技能 `dota2-runtime-dev` 讲清"Dota 2 自定义游戏是长驻进程 + 热重载"的核心认知——改代码经 `reload_script`（服务端）/ Panorama 热重载生效，而非重启地图；并覆盖生成代码边界（改 `.ts/.tsx` 别碰生成的 `.lua/.js`）与 KV 只读约定。skill 以标准 `skills/<name>/SKILL.md` 存放，新增技能只需丢入文件夹。

## 1.3.0 (2026-07-17)

### 新增

- **`dota_status` 任务入口工具**：用户说"测试 / 验证 / 调试 Dota 2 项目"时 agent 的第一个抓手。报告连接 + addon + 地图状态，并根据状态指明下一步该调的工具（launch / console_output 查错 / dota_run_lua 验证），把工作流直接交给 agent。

### 改进

- **全部工具描述改为任务导向**：以"什么时候用"开头、用任务语言（"用户报告游戏内 bug 时用""用户想测试 addon 时启动地图"），修复了之前实现视角描述（"Send console command via VCon TCP"）导致 agent 匹配不到用户意图、转而去用别的工具的问题。

### 修复

- **addon 首次检测**：瘦客户端连上已运行的 daemon 时拿不到历史 addon（`adon` 事件早已发过），导致 `dota_status` 首次返回 `addon: "(detecting...)"`、maps 为空。启动时改从 hello-ok 握手读取 addon/maps；ADON 帧异步延迟时 `dota_status` 最多等待 3s。

## 1.2.1 (2026-07-17)

### 修复

- **守护进程 spawn 接线**：`createRelay` 现在真正通过 `acquireLock → spawnRelayDaemon → waitForRelay` 拉起 detached 守护进程。此前这些 API 是死代码，每个实例仍本地启动 relay，"守护进程独立于 MCP 会话存活"未真正实现。

- **安全：控制端口握手强制**。设了 token 后，未完成 HELLO 的连接无法发送任何命令，修复本机进程跳过握手直接 `CMD:` 注入（RunScriptCode 等于 RCE）的绕过。

- **connect 僵尸 Promise**：`hello-ok` 永不到达（如 daemon 握手前崩溃）时 8s 超时 reject，修复 `createRelay` 永久 await 导致 MCP 启动卡死。

- **daemon 重启崩所有 MCP 进程**：连接丢失不再抛 unhandled `error` 事件，静默走自动重连（指数退避封顶 5s），断线期间命令缓冲重连后补发。

- **VCon 帧重组（GUI→Dota）**：按 12 字节帧头 length 重组，修复大命令或网络抖动时半帧转发导致的引擎协议错乱。

- **npm 包缺失 daemon 文件**：`files` 字段从仅 `dist/index.js` 改为 `dist/*.js`，否则 npx 安装后 `require.resolve('./relay-main.js')` 抛错（发布阻断）。

- **Dota 2 路径检测**：`find-steam-app` 无法解析新版 `libraryfolders.vdf` 导致 `detectDotaPath()` 恒 null、地图扫描静默失效。改为 注册表 SteamPath → STEAM_PATH 环境变量 → 平台默认位置，每个来源展开 VDF 枚举所有库，支持任意盘/目录名。

- 检测不到 Dota 2 路径时 `dota_compile_asset` 给出可操作错误，而非静默拼出相对路径失败。

- token 生成改用 `crypto.randomBytes` + `wx` 原子创建。

- `livePid()` stale 清理比对内容，避免误删新 daemon 的 PID。

- 空闲退出时清理 `relay.pid`。

## 1.2.0 (2026-07-17)

### 新增

- **多实例共存：relay 守护进程 + 瘦客户端模式。** 多个 AI agent / 会话可同时通过 MCP 接入，共享同一个常驻 relay（独占 Dota 2 `:29000`），不再因 `:29001/:29002` 端口冲突导致后启动实例全部不可用。

- relay 守护进程独立存活（detached spawn），无客户端连接 5 分钟后自动退出。

- 瘦客户端通过 `:29002` 接入：`HELLO` 握手 + token 校验（`<tmpdir>/dota2-mcp/relay.token`，0600）、`STREAM` 实时 PRNT 推送、`SHUTDOWN` 空客户端自杀。

- 守护进程协调：文件锁 + PID + stale 检测，防止并发 spawn 竞态。

- 端口被占用时工具报错明确指向"另一个实例冲突"，而非误导性的"未连接 Dota 2"。

- 新增 `scripts/test-daemon.mjs`：离线守护进程链路测试（无需 Dota 2）。

### 修复

- `zod` 补入 `dependencies`（此前依赖 `@modelcontextprotocol/sdk` 的间接提升）。

- relay 的 Dota 2 路径硬编码改为跟随 `detectDotaPath()` 自动检测。

## 1.1.1 (未发布)

### 改进

- 使用 `find-steam-app` 库替代手写路径解析，自动跨平台查找 Dota 2 安装目录。

- README 补充占位路径说明。

## 1.1.0 (2026-06-25)

### 新增

- 跨平台支持：Windows、Linux、macOS。

- 按平台自动检测 Steam / Dota 2 安装路径。

- `npm run package` 现在使用 Node SEA 生成当前平台的独立可执行文件。

- 新增 GitHub Actions Release workflow，发布 Release 时自动构建三平台二进制并上传。

- 添加 MIT 开源协议。

## 1.0.0 (2026-06-25)

首个可用版本。

### 新增

- 基于 stdio 的 MCP 服务器，注册 20 个工具。

- VConsole2 TCP relay：在 Dota 2 `:29000` 与 vconsole2 GUI `:29001` 之间透明转发，MCP 通过 `:29002` 注入命令。

- 实时控制台 I/O：`console_send`、`console_output`、`console_channels`、`console_find`、`console_help`。

- 游戏控制：`project_info`、`dota_launch_game`、`dota_disconnect`、`dota_restart`。

- 运行时 API 查询：`dota_api_lua`、`dota_api_panorama_js`、`dota_api_css`、`dota_api_events`、`dota_api_help`。

- 调试检查：`dota_dump_entities`、`dota_dump_modifiers`、`dota_entity_inspect`、`dota_run_lua`。

- 资源工具：`dota_compile_asset`。

- vconsole2 GUI 输出屏蔽：默认把 MCP 命令输出用 `ai_disabled; ...; ai_disabled` 包裹，relay 自动隐藏标记间输出；MCP 仍可读完整输出。

- 全量冒烟测试脚本 `scripts/test-mcp-tools.mjs`。

- 支持打包为独立 Windows 可执行文件 `dist/dota2-mcp.exe`（esbuild + Node SEA）。

### 修复

- `console_find`、`console_help`、多个 API dump 工具因控制台输出捕获时机问题返回空结果的缺陷。

### 项目

- 补充 `README.md` 与 `CHANGELOG.md`。

- `package.json` 升级到 `1.0.0`，增加 `files` / `keywords` 等发布字段。

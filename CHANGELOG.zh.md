# Changelog

[English](CHANGELOG.md) | 中文

## 2.0.0 (2026-10-26)

### 新增

- **`dota_screenshot`**：在后台截取 Dota 2 游戏窗口画面并返回给 agent，不需要控制台或 vconsole。缓存帧带 `stale` 和 `captured_at`；最小化窗口只在截图时恢复，随后还原。仅 Windows。
- **`dota_advance_to_game`**：把已加载的游戏从任一开局前相位推进到 GAME_IN_PROGRESS，每个玩家都有英雄（随机，或指定 `hero`）。标准流程：`dota_launch_game` 或 `dota_restart`，然后 `dota_advance_to_game`；需要 `sv_cheats=1`。
- **按需读取 skill**：`dota2_skill` 现在返回单个章节、目录或一个 JSON 片段（`data_path`），VFX 与模型工作不再需要整份 skill 正文。
- **`dota2-vfx` 配方**：范围预警 + 命中、投射物 + 轨迹 + 命中、持续增益/减益光环，覆盖结构、时序、控制点与 modifier 接线。
- **`vfx_preview` 报告粒子能否被绘制**：未写进 `Precache` 的 addon 路径返回 `precache: MISSING` 和需要补的那一行，而不是一份看起来成功、实际什么都不画的预览。
- **`dota_record`**：把游戏窗口录制为 MP4（被遮挡或失焦也能录），返回路径、时长、帧率与编码尺寸。时长 1–30 秒，默认 12 fps（上限 30），需要 Windows 与 ffmpeg；最小化窗口明确失败。
- **`dota_perf`**：采集帧时间并返回 p50/p95/p99、样本数与时长；`baseline` 可对比两次采集。需要管理员终端；失焦游戏的空采样会自动用 `r_always_render_all_windows` 重试一次并恢复。
- **`dota_test_run`**：在真实游戏里执行 `scripts/vscripts/tests/<name>.lua` 的断言测试，每条测试独立执行，按单条与整体限时；返回 `{name,status,detail}` 行。
- **`panorama_exec_js`**：不改 addon 就能检视和操作客户端 UI——面板查找、几何、游戏状态与后台事件。覆盖 HUD；地图重载会重建桥，多个会话共享同一座桥。
- **`dota_input`**：向游戏窗口发送真实的 OS 鼠标与键盘输入（客户区像素），越界坐标在发送前拒绝，可选还原焦点与光标；`window_info` 只读窗口不发输入。仅 Windows。

### 变更

所有工具现在返回同一种形状：成功为 `{"ok":true, ...}`，载荷为 `lines`、`text` 或 `data`；失败为 `{"ok":false, "code": "...", "message": "..."}` 且 `isError`。38 个工具全部带四类 MCP annotations，每条描述都写明何时使用、做什么、返回什么、上限与相关工具。旧参数名在本版本内继续作为别名可用。

| 范围 | 2.0 之前 | 2.0 |
|---|---|---|
| 所有返回值 | 裸文本，少数工具是原始 JSON | `{ok:true, lines\|text\|data}` / `{ok:false, code, message}` |
| 工具元数据 | 没有 annotations | 全部工具四类 hint（`readOnly`/`destructive`/`idempotent`/`openWorld`） |
| `console_output` | 最后 N 行，每次读取都重复 | 游标增量；`tail` / `since_seq` / `from_start`，回报 `next_seq` 与 `dropped`；过滤器不吞掉未匹配行；`lines` 保留为 `tail` 的别名；首次调用取最近 50 行 |
| `console_send` | 只回 `Sent N command(s)` | 返回该命令自己的输出并推进游标；之后的输出仍可用 `console_output` 读到 |
| `dota_status` | 带 `running` / `allMaps` 的文本摘要 | `data` 能力矩阵（`daemon`、`vconsole`、`dota`、`phase`、`cheats`、`addon`、`map`、`available_actions`）；移除 `running` / `allMaps` |
| `dota_restart` | 文本 | 20 秒无变化现在是 `timeout` 失败 |
| `file_read` | 原始文件内容 | `data:{path,bytes,text}` |
| `dota2_skill` | `data_path` 返回原始 JSON | JSON 放在 `text` 字段 |

- 瘦客户端断开期间发送的命令会被丢弃，不再在重连后补发。

### 修复

- **Lua 输出漏进 vconsole**：`dota_run_lua` 与 `vfx_preview` 的输出和标记不再出现在 vconsole 窗口，Lua 运行时报错也不再让窗口静默。
- **过长的 Lua 静默无效**：`dota_run_lua` 现在对超过引擎语句上限的代码明确报错。
- **`dota_launch_game` 把正常的地图加载误报为卡在 INIT**；启动后游戏仍停在主菜单时也会明确报告。
- **`dota_restart` 在重启生效前就返回**：现在等到重载真正开始才返回。
- **`sv_cheats` 关闭时 Lua 类工具不报错**：`dota_run_lua`、`dota_advance_to_game` 和 VFX 工具现在立即失败，错误里点名 `sv_cheats`。
- **API 查询返回整份引擎转储**：API、实体与 modifier 工具只返回匹配条目；`dota_dump_modifiers` 默认列出服务端生效的 modifier。
- **晚接入的瘦客户端用 `console_channels` 查不到通道**：握手现在带上已经从 Dota 注册的通道表。
- **Lua 与 VFX 结果误导**：标量表达式直接打印结果，`vfx_preview_stop` 不再把 void 返回值写成 `ok=nil`。
- **卡死截图失败的原因含糊**：`dota_screenshot` 返回带 `stale: true` 与 `captured_at` 的上一帧，或说明从未缓存到帧，不会改为截取屏幕或返回没有标记的旧图。
- **截图超时预算含糊**：准备完成后，每次调用在捕获、停止和补最小化之间共享一个 5 秒 deadline；清理无法完成时结果会明确说明。
- **截图新鲜度被高估**：后台画面保持 `stale`，直到捕获会话真正交付新帧。
- **VFX 起步模板无法渲染**：现在包含经过验证的 sprite 路径，工作流要求除非零粒子 ID 外还比较创建前后截图。
- **自建粒子永远不显示**：未声明的粒子现在报 `precache: MISSING`，skill 记录 precache 步骤与 resourcecompiler 会丢弃的字段。
- **资产引用在当前的资产上判断错误**：固定版本的资产 CLI 能读取当前 KV 类型，`asset_check_refs` 会解析共享 addon 与核心 VPK 资产而不是误报 broken，`asset_inspect` 同时统计持续与瞬时 emitter。
- **`file_edit` 写坏含 `$` 的文件**：`new_string` 里的 `$'`、`$&`、`$1` 按字面写入。
- **借 `addon` 绕过 FileOps 路径边界**：`.`/`..` 或含路径分隔符、`:` 的 addon 名会被拒绝。
- **非 ASCII 控制台文本**：VConsole2 输出与命令改为 UTF-8，中文 `print` 输出和非 ASCII Lua 不再乱码。
- **过期游戏状态**：查询没有回应时，`dota_status` 与 `dota_launch_game` 不再回落到日志里旧的 `status_json`。
- **工具结果混入其他输出**：控制台类工具只保留每次调用回显标记之间的行；每个标记对只关闭自己的窗口，并发会话不会互相截断输出。
- **本地降级 relay 的 `:29002` 无认证**：现在执行与守护进程相同的 token 握手。
- **资产工具失败看起来像成功**：资产 CLI 失败或根资产无法反编译时，`asset_inspect` 与 `asset_check_refs` 返回错误。
- **`dota_launch_game` 在已加载其他地图时也会启动请求的地图。**
- **vconsole 重连**：被取代的 GUI socket 不再断掉在线连接；切换 MCP 屏蔽不再让 GUI 静默。
- **停止服务器可能让 Dota 崩溃**：发送过程中断开 Dota 连接可能触发引擎致命错误；现在的关闭流程会等待输出安静、排空后干净退出。
- **Linux 与 macOS Steam 检测**：默认 Steam 根目录从用户主目录解析。
- **独立可执行程序启动即失败**：打包产物现在无论有无守护进程都能启动，回退到本地 relay，并在可执行文件旁解析 skills；Windows 产物保留 `.exe` 扩展名。
- **子进程继承凭据**：截图、录制与资产子进程现在会移除常见的凭据环境变量。

## 1.6.0 (2026-08-21)

### 新增

- **文件工具（离线）**：`file_read`、`file_write`、`file_edit` 与 `file_delete` 不需要游戏即可读写 addon 内的文本文件；路径限制在 addon 内。
- **`vrf_ensure`**：首次使用时下载、校验并缓存固定版本的资产 CLI，只在缺失时联网。
- **`asset_inspect`**：为粒子、模型、材质、贴图与未知类型返回稳定的结构化摘要；原始反编译文本需显式开启并截断。
- **`asset_check_refs`**：遍历资产的引用链，报告 ok、uncompiled、engine 与 broken，并防环。
- **`vfx_preview` / `vfx_preview_stop`**：在运行中的游戏里创建和停止粒子预览并返回 id；以控制台加载错误为准。需要游戏、vconsole 与 `sv_cheats=1`。
- **内置 `dota2-vfx` 与 `dota2-model` skill**：格式参考、管线模型、工作流、工具映射、常见错误与起步模板。
- **`dota2_skill` 读取 skill 数据**：`section` 与 `outline` 读取部分正文，`data` / `data_path` 返回随包分发的 JSON 或 Markdown 数据文件。

### 变更

- **README 安装说明**：补充 Codex 桌面端配置，并区分 AI 辅助与手动安装路径。
- **测试地图前置条件成文**：basic 模板的 `addoninfo.txt` 必须声明 `maps` 与 `IsPlayable`，地图必须先编译才能启动。

### 修复

- **WSL 兼容**：文件与资产工具在 WSL 下可用——转换 Windows 工具路径、资产 CLI 改为文件输出，并能检测正在运行的 Dota 进程。

## 1.5.1 (2026-07-22)

### 变更

- **安装与客户端配置文档**：npx 成为唯一推荐的安装方式；各客户端（Claude Code/Desktop、Cursor、VS Code、Cline、Codex）的配置包含文件位置与粘贴即用 JSON，并补充启动后验证与排查表。

## 1.5.0 (2026-07-22)

### 新增

- **自动打开 vconsole**：Dota 就绪且没有 vconsole 窗口时自动打开（`DOTA2_VCON_AUTO_OPEN_VCONSOLE=0` 关闭）。手动关闭的窗口不会立刻重开，要等下次 Dota 启动。

### 变更

- **Breaking：vconsole 窗口现在决定连接。** 没有窗口时服务器不连接 Dota，控制台类工具会说明 vconsole 未打开。关闭窗口会立即释放 Dota，AssetBrowser 的 vconsole 按钮恢复可用。人始终能旁观 agent 的控制台活动。
- **精确的连接错误**：工具报错现在区分「Dota 没在跑」与「只是没开 vconsole」。

### 修复

- **关闭服务器会泄漏控制端口。**

## 1.4.0 (2026-07-22)

### 新增

- **`dota_open_vconsole`**：拉起 vconsole 并最多等待 30 秒接入；已有未接入的实例会给提示。
- **`dota_launch_game` 相位指引**：成功终点是 GAME_IN_PROGRESS（超时 90 秒）；同一相位卡住 15 秒会返回相位、推进步骤、近期错误与 skill 指引。
- **`dota2-game-phases` skill**：各相位的正常时长与推进方法，以及卡相位处置 SOP。

### 变更

- **Breaking：控制台类工具要求 vconsole 已打开。** 未打开时报告如何打开。服务器持有 Dota 连接期间 AssetBrowser 的 vconsole 按钮被禁用，请直接运行 `vconsole2.exe`。
- **Breaking：`project_info` 并入 `dota_status`。** `dota_status` 是入口且永不抛异常，返回状态与下一步指引。
- **`dota_status` 输出结构变化**（vconsole、maps、allMaps、running），控制台工具描述写明 vconsole 前提。

### 修复

- **晚打开的 vconsole 是空壳**：服务器现在会重放启动数据，窗口一打开即可用。
- **死连接永远检测不到**：静默 15 秒后发 echo 探针，20 秒无响应判死并重连。
- **Dota 运行期间服务器会空闲退出**：游戏运行时保持存活。
- **daemon 模式下 MCP 看不到 GUI 状态变化**：状态变化现在立即广播。
- **重复的重连定时器**：重连只用一个定时器。
- **Dota 启动早期会误杀正常引擎**：僵尸检测现在只走活性探针（约 35 秒，不误报）。
- **地图加载被误报为卡住**：加载期跳过卡住判定，真正超时仍会报告 ResourceSystem 错误。

## 1.3.2 (2026-07-20)

### 变更

- **relay 常驻持有 Dota 连接**，断线重连；vconsole GUI 降为可选观察者，纯 AI 工作流开箱即用。
- **冷启动超时放宽到 30 秒**，避免慢机器误入本地降级。

### 修复

- **重连在第一次失败后就停止**：现在无限退避（封顶 5 秒），并在重连后补发断线期间缓冲的命令。
- **守护进程被杀后会话一直失联**：会话现在会重新拉起并整体替换连接。
- **本地降级模式 5 分钟后杀掉 MCP 进程**：空闲退出现在只在守护进程模式生效。
- **一次重拉失败让工具永久失联**：现在会本地降级并重试。
- **连接超时泄漏 socket**：socket 会被销毁，失败计入重连统计。
- **慢启动的守护进程可能双绑端口**：超时的守护进程会先被杀再降级。
- **降级 relay 可能重复启动并误报冲突。**

## 1.3.1 (2026-07-18)

### 新增

- **`dota2_skill` 内置技能**：skill 随服务器分发；首个 `dota2-runtime-dev` 覆盖长驻进程与热重载模型、生成代码边界与 KV 约定。

## 1.3.0 (2026-07-17)

### 新增

- **`dota_status` 入口工具**：报告连接、addon 与地图状态，并指向下一个该调用的工具。

### 变更

- **全部工具描述改为任务导向**，agent 能把用户意图匹配到工具。

### 修复

- **接入时检测不到首个 addon**：addon 与地图状态现在来自握手，并为晚到的数据短暂等待。

## 1.2.1 (2026-07-17)

### 修复

- **守护进程从未真正启动**：服务器现在启动一个独立存活于 MCP 会话之外的守护进程。
- **安全：控制端口在认证前接受命令。** 现在强制 token 握手。
- **守护进程不应答时启动可能永远挂起。**
- **守护进程重启会崩掉所有 MCP 进程**；会话现在会重连并补发缓冲命令。
- **大命令可能破坏控制台流**；现在会先重组帧再转发。
- **npm 包缺少守护进程文件**，npx 安装后无法启动。
- **当前 Steam 库文件导致 Dota 安装检测失败**；现在读取注册表、`STEAM_PATH` 与默认位置。
- **没有 Dota 安装时 `dota_compile_asset` 静默失败**；现在返回可操作的错误。

## 1.2.0 (2026-07-17)

### 新增

- **多个 MCP 会话共享一个 relay**，后启动的会话不再因端口冲突不可用。
- **relay 作为独立守护进程运行**，无客户端 5 分钟后退出。
- **端口冲突会报告为另一个实例**，而不是「未连接 Dota 2」。
- **安全的本地访问**：会话用 token 认证，没有 token 无法注入命令。

### 修复

- **Dota 路径硬编码**；现在跟随自动检测。

## 1.1.2 (2026-06-25)

### 新增

- **基于 Steam 的 Dota 2 检测**：通过 Steam appid 570 找到安装路径，不需要设置 `DOTA2_PATH`。
- **自动检测 addon**：addon 来自已连接的游戏或 content 扫描，不需要设置 `DOTA2_ADDON`。
- **可配置控制台端口**：`DOTA2_VCON_DOTA_PORT`、`DOTA2_VCON_GUI_PORT` 与 `DOTA2_VCON_CTRL_PORT` 可覆盖默认值。

### 变更

- **Breaking：移除 `DOTA2_PATH` 与 `DOTA2_ADDON`**；检测全自动。
- **连接要求**：Dota 未运行时，控制台类工具会说明必须先启动并连接。
- **README 安装说明**：npm 安装步骤，以及 Claude Desktop、VS Code、Cline、Codex 的客户端配置和 Steam 相对路径示例。

### 修复

- **npm 安装与全局启动**：修正 `bin` 字段与发布文件清单。
- **控制台稳定性**：未处理错误不再破坏 JSON-RPC 流，非法过滤模式返回 MCP 错误。
- **控制台与游戏工具时序**：修复输出重复/丢失，工具不再在游戏进程结束前提前返回结果。

## 1.1.0 (2026-06-25)

### 新增

- 支持 Windows、Linux 与 macOS。
- 自动检测 Steam 与 Dota 2 安装位置。
- 为当前平台生成独立可执行文件。
- GitHub Releases 附带三个平台的预构建二进制。
- MIT 协议。

## 1.0.0 (2026-06-25)

首个可用版本。

### 新增

- 基于 stdio 的 MCP 服务器，注册 20 个工具。
- 控制台 relay：独占 Dota 连接，vconsole GUI 仍可用，MCP 命令单独注入。
- 控制台 I/O：发送、读取、列出通道、搜索命令与帮助。
- 游戏控制：`project_info`、启动、断开与重启。
- 运行时 API 查询：Lua、Panorama JS、CSS、事件与帮助。
- 调试检查：实体、modifier、实体脚本与 Lua。
- 资源编译。
- 默认在 vconsole GUI 中隐藏 MCP 输出。
- 独立 Windows 可执行文件。

### 修复

- `console_find`、`console_help` 与多个 API dump 因输出捕获时机返回空结果。

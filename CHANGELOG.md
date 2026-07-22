# Changelog

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

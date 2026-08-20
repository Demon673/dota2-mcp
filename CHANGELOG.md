# Changelog

## 1.6.0 (2026-08-20)

### 新增（特效与模型处理能力，9 个新工具，总数 22 → 31）

- **FileOps 四件（离线）**：`file_read` / `file_write` / `file_edit`（old_string→new_string 恰好一次匹配）/ `file_delete`（返回内容快照）——读写 addon 内文本源文件；路径限制 `content|game/dota_addons/{addon}/`，规范化前缀检查拒绝 `../` 逃逸与其他 addon。

- **FileOps (four tools, offline)**: `file_read` / `file_write` / `file_edit` (old_string→new_string exact-one-match) / `file_delete` (returns a content snapshot) — read/write text source files inside the addon; paths are restricted to `content|game/dota_addons/{addon}/`, and a normalized-prefix check rejects `../` escapes and other addons.

- **`vrf_ensure`（离线）**：VRF CLI 半集成——检测 / 下载 pin 版本（默认 20.0，自包含无 .NET 依赖）/ sha256 校验（篡改拒绝且不缓存）/ 缓存 `os.tmpdir()/dota2-mcp/vrf/`；按 release assets[] 动态匹配 `cli-{os}-{arch}.zip`，缺了才联网。

- **`vrf_ensure` (offline)**: half-integrated VRF CLI — detect / download the pinned version (default 20.0, self-contained with no .NET dependency) / sha256 verify (tampering rejected and not cached) / cache `os.tmpdir()/dota2-mcp/vrf/`; matches `cli-{os}-{arch}.zip` dynamically from release assets[] and only goes online when missing.

- **`asset_inspect`（离线）**：VRF 反编译 + 五类型结构化摘要（vpcf/vmdl/vmat/vtex/unknown），键排序稳定可 diff；`include_raw` 显式截断 4000 字符。

- **`asset_inspect` (offline)**: VRF decompile + five-type structured summary (vpcf/vmdl/vmat/vtex/unknown) with stable key ordering for diffing; `include_raw` explicitly truncated at 4000 characters.

- **`asset_check_refs`（离线）**：单资产递归引用完整性——ok / uncompiled（源在产物缺）/ engine_refs（两级解析落 game/dota）/ broken 四桶；`max_depth=3` + visited 防环。

- **`asset_check_refs` (offline)**: single-asset recursive reference integrity — ok / uncompiled (source present, artifact missing) / engine_refs (two-level resolution landing in game/dota) / broken four buckets; `max_depth=3` + visited set to prevent cycles.

- **`vfx_preview` / `vfx_preview_stop`（需游戏 + vconsole）**：运行时粒子实例预览——ParticleManager:CreateParticle（PATTACH_* 全枚举、可选世界坐标）返回 pid；以 console 加载错误为准（id 不能证明加载成功）；继承 `dota_run_lua` 门控通道（非新增限制）。

- **`vfx_preview` / `vfx_preview_stop` (needs game + vconsole)**: runtime particle instance preview — ParticleManager:CreateParticle (full PATTACH_* enumeration, optional world coordinates) returns a pid; console load errors are the source of truth (an id doesn't prove a successful load); inherits the `dota_run_lua` gating channel (not a new restriction).

- **内置 skill `dota2-vfx` / `dota2-model`**：vpcf/vmdl/vmat/vtex KV3 写作速查（真实模板验证）、管线模型、SOP、工具映射、常见错误表、最小模板；完整字段参考章节 TODO(rare) 分批补全。

- **Built-in skills `dota2-vfx` / `dota2-model`**: vpcf/vmdl/vmat/vtex KV3 writing quick-reference (verified against real templates), pipeline model, SOP, tool mapping, common-error table, minimal templates; the full field-reference section is a TODO(rare) to be filled in incrementally.

- **`dota2_skill` 分节参数**：`section`（返回单个 `##` 章节）/ `outline`（标题目录），应对字面全量 skill 的大正文。

- **`dota2_skill` section arguments**: `section` (returns a single `##` section) / `outline` (heading table of contents), to handle the large body of a verbatim full skill.

### 修复

- **WSL 路径检测**：`detectDotaPath()` 加 `toHostPath()`——非 win32 平台 Windows 盘符路径映射 `/mnt/<drive>/`；注册表经 WSL interop 查询、默认位置全平台探测。修复 WSL 下所有文件系统类工具不可用的问题。

- **WSL path detection**: `detectDotaPath()` gains `toHostPath()` — on non-win32 platforms Windows drive-letter paths map to `/mnt/<drive>/`; the registry is queried via WSL interop and default locations are probed on all platforms. Fixes all filesystem-class tools being unusable under WSL.

### 依赖

- 新增 `adm-zip`（纯 JS；VRF 发布包解压，保持无外部二进制规则）。

- Added `adm-zip` (pure JS; unzips VRF release packages, keeping the no-external-binary rule).

### 测试

- 新离线脚本：`test-fileops` / `test-vrf-ensure` / `test-asset-inspect` / `test-asset-check-refs`；新活体脚本：`test-vfx-live`（launch → spawn → stop）。

- New offline scripts: `test-fileops` / `test-vrf-ensure` / `test-asset-inspect` / `test-asset-check-refs`; new live script: `test-vfx-live` (launch → spawn → stop).

- 活体测试暴露并记录测试 addon 两前置：basic 模板 `addoninfo.txt` 为空 KV3 需声明 maps/IsPlayable；地图先编译（resourcecompiler → `game/maps/*.vpk`）才能 launch。

- Live tests surfaced and recorded two prerequisites for the test addon: the basic template's `addoninfo.txt` is an empty KV3 that must declare maps/IsPlayable; the map must be compiled first (resourcecompiler → `game/maps/*.vpk`) before it can launch.

## 1.5.1 (2026-07-22)

### 文档

- **README 安装路径收敛为 npx 唯一推荐**（保证使用者始终自动最新），删除全局安装与独立 exe 安装指引（exe 仅保留一行特殊场景说明）；各客户端配置从一行表格扩为完整指引（Claude Code/Desktop、Cursor、VS Code、Cline、Codex TOML，含配置文件位置与粘贴即用 JSON）；新增启动后验证步骤与连接问题排查表（`--prefer-offline`、cmd 包装、未连接/vconsole 报错指向）；前置条件与 FAQ 按门控模型同步。

- **README install path narrowed to npx as the sole recommendation** (keeping users always auto-updated), removing the global-install and standalone-exe install instructions (exe keeps a single line for special cases); per-client configuration expanded from a one-line table into full instructions (Claude Code/Desktop, Cursor, VS Code, Cline, Codex TOML, with config file locations and paste-ready JSON); added post-startup verification steps and a connection-troubleshooting table (`--prefer-offline`, cmd wrapping, pointing "not connected"/"vconsole" errors); prerequisites and FAQ synced with the gating model.

## 1.5.0 (2026-07-22)

### 行为变更（Breaking）

- **严格 vconsole 门控连接模型：没窗口就不连 Dota**。1.4.0 的契约是「政策假象」——工具物理上能用（29000 通着）却被规则拦下，使用者分不清是设计还是 BUG。现改为状态物理为真：无 GUI 时 relay 只以 1s 间隔探测 `:29000` 就绪（TCP 连一下即断，不持有）；vconsole2 连上 `:29001` 后 relay 才连 `:29000`；GUI 断开立即断开 29000。从此「没窗口 = 没连接 = 没工具」，没有例外。**接受代价：agent 不能脱离 vconsole 工作**（产品哲学：人必须能旁观 agent 的控制台活动）。副产品：窗口一关 29000 即释放，AssetBrowser 的 vconsole 按钮恢复可用——「自己点不开」在根上消失。

- **Strict vconsole-gated connection model: no window, no Dota connection**. 1.4.0's contract was a "policy fiction" — tools were physically usable (29000 was up) but blocked by rules, so users couldn't tell design from bug. Now the state is physically true: with no GUI the relay only probes `:29000` readiness every 1s (connect once and drop, without holding it); only after vconsole2 connects to `:29001` does the relay connect to `:29000`; when the GUI disconnects it immediately drops 29000. From now on "no window = no connection = no tools", with no exceptions. **Accepted cost: the agent can't work without vconsole** (product philosophy: a human must be able to watch the agent's console activity). By-product: closing the window releases 29000 immediately and the AssetBrowser vconsole button works again — "I can't open it myself" disappears at the root.

- 状态广播/hello-ok 增加 `ready` 字段，工具报错精确区分「Dota 没在跑」与「只是没开 vconsole」。

- Status broadcast/hello-ok gains a `ready` field, so tool errors precisely distinguish "Dota isn't running" from "vconsole just isn't open".

### 新增

- **探测到 Dota 就绪自动打开 vconsole**：就绪上升沿（Dota 由不在变为在）且无 vconsole2.exe 进程时自动拉起（`DOTA2_VCON_AUTO_OPEN_VCONSOLE=0` 关闭）。触发点只有就绪沿，天然无拉起循环；手动关闭后不会被立刻重开，下次 Dota 重启才会再次尝试。

- **Auto-open vconsole when Dota readiness is detected**: on the readiness rising edge (Dota transitions from absent to present) with no vconsole2.exe process, it auto-launches (disabled via `DOTA2_VCON_AUTO_OPEN_VCONSOLE=0`). The only trigger is the readiness edge, so there's naturally no launch loop; after a manual close it isn't reopened immediately — it only retries on the next Dota restart.

### 修复

- `close()` 未关闭控制端口 server 的端口泄漏。

- `close()` didn't close the control-port server, leaking the port.

## 1.4.0 (2026-07-22)

### 行为变更（Breaking）

- **vconsole 显式契约**：控制台类工具（17 个）现在要求 vconsole2 已打开并连接 `127.0.0.1:29001`，否则报明确错误并给出打开路径（调用 `dota_open_vconsole`，或手动运行 exe）。设计意图：保证使用者始终能旁观 agent 的控制台活动，失败显式可见而非隐式兜底。注意：AssetBrowser 的 vconsole 按钮在 relay 持有 29000 时被引擎禁用（实测：引擎把 relay 当作已连接的 vconsole），打开 vconsole 请直接运行 `game/bin/win64/vconsole2.exe`。

- **Explicit vconsole contract**: console-class tools (17 of them) now require vconsole2 to be open and connected to `127.0.0.1:29001`, otherwise they report a clear error and the way to open it (call `dota_open_vconsole`, or run the exe manually). Intent: always let the user watch the agent's console activity, with failure explicitly visible rather than a hidden fallback. Note: the AssetBrowser vconsole button is disabled by the engine while the relay holds 29000 (measured: the engine treats the relay as the connected vconsole), so to open vconsole run `game/bin/win64/vconsole2.exe` directly.

- **`project_info` 删除，并入 `dota_status`**：`dota_status` 吸收其全部字段（allMaps/clients/cpu_usage 等），作为入口/导航工具永不抛异常——Dota 未连接或 vconsole 未打开时返回状态与下一步指引。工具总数 22 不变。

- **`project_info` removed, merged into `dota_status`**: `dota_status` absorbs all its fields (allMaps/clients/cpu_usage, etc.) and, as the entry/navigation tool, never throws — when Dota isn't connected or vconsole isn't open it returns status plus next-step guidance. Tool count stays 22.

- `dota_status` 输出结构随之变化（新增 `vconsole`/`maps`/`allMaps`/`running{}` 字段）；各控制台工具描述统一追加「需要 vconsole 已打开」前提。

- `dota_status` output structure changes accordingly (new `vconsole`/`maps`/`allMaps`/`running{}` fields); every console tool description appends the "requires vconsole open" prerequisite.

### 新增

- **`dota_open_vconsole`**：显式拉起 vconsole2.exe 并等待其接入 relay（30s）。检测到已有未接入的陈旧实例时给显式提示（vconsole2 单实例，重复 spawn 只聚焦旧窗口）。

- **`dota_open_vconsole`**: explicitly launches vconsole2.exe and waits for it to attach to the relay (30s). When an existing unattached stale instance is detected, it gives an explicit hint (vconsole2 is single-instance; a repeated spawn only focuses the old window).

- **`dota_launch_game` 相位推进指引**：成功终点从「地图已加载」改为进入 GAME_IN_PROGRESS（timeout 默认 45s→90s）；同一相位 15s 未推进即返回 stuck 报告：相位原文、内置 `PHASE_GUIDANCE` 推进指引（精确到 dota_run_lua 调用）、近期 VScript/错误行、skill 文档指路。典型场景：卡 CUSTOM_GAME_SETUP 时按指引一句 `GameRules:FinishCustomGameSetup()` 推进（已活体端到端验证）。

- **`dota_launch_game` phase-advancement guidance**: the success endpoint changes from "map loaded" to entering GAME_IN_PROGRESS (timeout default 45s→90s); if a phase hasn't advanced in 15s it returns a stuck report: the phase verbatim, built-in `PHASE_GUIDANCE` advancement instructions (down to the dota_run_lua call), recent VScript/error lines, and a pointer to the skill doc. Typical scenario: stuck at CUSTOM_GAME_SETUP, advance with a single `GameRules:FinishCustomGameSetup()` per the guidance (verified end-to-end live).

- **`dota2-game-phases` skill 文档**：各 game_state 的正常时长与推进方法、卡相位处置 SOP（先 console_output 查 addon 报错，再按表推进）。

- **`dota2-game-phases` skill doc**: normal duration and advancement method for each game_state, plus a stuck-phase SOP (first check addon errors via console_output, then advance per the table).

### 修复

- **vconsole 晚开是空壳**：relay 不给晚接入的 GUI 重放初始化帧（AINF/CHAN/CVRB/CFGV/ADON），窗口拿不到通道表/cvar/addon 信息。现按到达顺序缓存并在 GUI 接入时重放，随开随用。

- **Late-opened vconsole is an empty shell**: the relay didn't replay init frames (AINF/CHAN/CVRB/CFGV/ADON) to a late-attaching GUI, so the window got no channel table/cvar/addon info. Now it caches them in arrival order and replays on GUI attach, so the window works as soon as it opens.

- **对端装死永不重连**：真实崩溃/挂起时 socket 不发 FIN，relay 永远以为连着，MCP 命令发进黑洞。新增活性探测：静默 15s 发 echo 探针，20s 无响应判死重连；探针行对 MCP/GUI 双向过滤。

- **A dead peer never reconnects**: on a real crash/hang the socket sends no FIN, so the relay forever thinks it's connected and MCP commands go into a black hole. Added a liveness probe: silently send an echo probe after 15s, declare dead and reconnect after 20s with no response; probe lines are filtered from both MCP and GUI.

- **守护进程空闲退出切断 vconsole 生命线**：无客户端 5 分钟退出后 29001 消失，vconsole 无处可连。Dota 进程在跑时不再空闲退出。

- **Daemon idle exit cuts vconsole's lifeline**: after a 5-minute exit with no clients, 29001 disappears and vconsole has nowhere to connect. It no longer idles out while the Dota process is running.

- **daemon 模式下契约/开窗全失效**：GUI 接入/断开从不广播 status，瘦客户端的 guiConnected 只在握手时同步一次，vconsole 开了 MCP 也不知道。现 GUI 状态变化即广播。

- **Contract/open-window fully broken in daemon mode**: GUI attach/detach never broadcast status, the thin client's guiConnected synced only once at handshake, so MCP didn't know vconsole was open. Now GUI state changes broadcast immediately.

- **重连调度重复**：error/close/catch 三路各排 timer（日志每轮重试打两行），合并为单一定时器。

- **Duplicate reconnect scheduling**: the error/close/catch paths each scheduled a timer (logging two lines per retry round); merged into a single timer.

- **Dota 启动早期误杀正常引擎**：初版 AINF 超时（10s 无 AINF 判死）在开机阶段反复误杀——监听器先于 AINF 子系统就绪（实测 >20s）。移除 AINF 计时器，僵尸检测统一走探针（~35s，无误报）。

- **False-killing a healthy engine early in Dota startup**: the initial AINF timeout (dead after 10s without AINF) repeatedly killed it during boot — the listener comes up before the AINF subsystem (measured >20s). Removed the AINF timer; zombie detection goes through the probe uniformly (~35s, no false positives).

- **地图加载期误报 stuck**：加载期间 game_state 恒为 INIT，被 15s 阈值误判卡住。加载期跳过判定；加载真卡死由 timeout 兜底（报告含 ResourceSystem 错误）。

- **False stuck during map load**: during loading game_state stays INIT, so the 15s threshold misjudged it as stuck. Loading skips the check; a genuinely stuck load is caught by the timeout fallback (the report includes ResourceSystem errors).

### 改进

- **开发-验证工作流落入文档**（AGENTS.md）：9 个冒烟脚本清单（离线/活体分类）+ 离线先行 / 活体三层验证（29002 协议、MCP stdio、系统状态）/ 连接生命周期场景矩阵方法论。新增离线 `test-relay.mjs`、`test-mcp-offline.mjs` 与活体 `test-mcp-live` / `test-launch-phases` / `test-crash-recovery` / `test-multi-session` 系列脚本。

- **Development–verification workflow landed in the docs** (AGENTS.md): a 9-smoke-script inventory (offline/live classified) + offline-first / live three-layer verification (29002 protocol, MCP stdio, system status) / connection-lifecycle scenario-matrix methodology. Added offline `test-relay.mjs`, `test-mcp-offline.mjs` and the live `test-mcp-live` / `test-launch-phases` / `test-crash-recovery` / `test-multi-session` script series.

- **可移植性规则**（Conventions）：文档/脚本禁盘符绝对路径（`{dota2Path}` 占位 / `detectDotaPath()` 检测）、禁具体项目名（daemon hello-ok 推断 + `DOTA2_TEST_*` 覆盖）、启动参数默认最小集、测试项目不确定主动问开发者。

- **Portability rules** (Conventions): docs/scripts forbid drive-letter absolute paths (`{dota2Path}` placeholder / `detectDotaPath()` detection), forbid concrete project names (inferred from daemon hello-ok + `DOTA2_TEST_*` override), default to the minimal launch-arg set, and ask the developer when the test project is unclear.

## 1.3.2 (2026-07-20)

### 改进

- **VCon 连接模型：relay 常驻持有 Dota 2 连接**。启动即主动连接 `:29000`，断线每 2s 自动重连；不再等 vconsole2 GUI 连上才建立连接，GUI 断开也不再释放。GUI 降级为可选观察者，纯 AI 工作流开箱即用——此前 MCP 启动后必须有 GUI 连上 `:29001` 工具才可用。

- **VCon connection model: the relay holds the Dota 2 connection permanently**. It connects to `:29000` proactively on startup and auto-reconnects every 2s on disconnect; it no longer waits for the vconsole2 GUI to connect before establishing the connection, nor releases on GUI disconnect. The GUI is demoted to an optional observer, so pure-AI workflows work out of the box — previously tools were unusable until a GUI connected to `:29001` after MCP started.

- `waitForRelay` 从 10s 放宽到 30s：守护进程冷启动（node 冷启动 + Dota 2 路径检测读注册表，叠加 Windows Defender 扫描）可能超过 10s，此前会误入本地降级。

- `waitForRelay` relaxed from 10s to 30s: daemon cold start (node cold start + Dota 2 path detection reading the registry, plus Windows Defender scans) can exceed 10s, which previously caused a false local fallback.

### 修复

- **瘦客户端重连链首次失败即断裂**：`_scheduleReconnect` 失败回调为空、close 仅在 `wasConnected` 时排程，"断线无限重连"实际在一次失败后就永久停止（老测试断言空转所以未暴露）。修复后真正无限退避重连（封顶 5s），断线期间命令缓冲重连补发。

- **The thin-client reconnect chain broke on the first failure**: `_scheduleReconnect` had an empty failure callback and close only scheduled when `wasConnected`, so "infinite reconnect on disconnect" actually stopped permanently after one failure (old tests asserted spinning, so it stayed hidden). Fixed to a true infinite-backoff reconnect (capped at 5s), with commands buffered during the outage and resent on reconnect.

- **会话内自动重拉守护进程**：守护进程进程被杀（非空闲退出）时，瘦客户端连续约 5 次重连失败后自动重跑 `createRelay()` 拉起新守护进程并整体替换接入，工具无感恢复。此前只能干连 `:29002` 直到新会话启动。

- **In-session automatic daemon respawn**: when the daemon process is killed (not an idle exit), the thin client re-runs `createRelay()` after ~5 consecutive reconnect failures to launch a new daemon and swap in the connection wholesale, so tools recover transparently. Previously it could only keep dialing `:29002` until a new session started.

- **本地降级模式 5 分钟后进程自杀**：`start()` 无条件武装空闲退出计时器，本地内嵌 relay 永远无客户端，5 分钟 `process.exit(0)` 静默杀掉 MCP 会话。空闲退出改为仅守护进程模式启用。

- **Local fallback mode killed the process after 5 minutes**: `start()` unconditionally armed the idle-exit timer, and the locally embedded relay never has a client, so `process.exit(0)` at 5 minutes silently killed the MCP session. Idle exit now only enables in daemon mode.

- **重拉瞬态失败导致会话永久失联**：`createRelay` 抢锁分支 `client.connect()` 未捕获，异常逃逸后 relay 引用停留在已销毁客户端，工具永久报未连接。现捕获并走本地降级，respawn 失败 5s 自动重试。

- **A transient respawn failure left the session permanently disconnected**: the `createRelay` lock branch didn't catch `client.connect()`, so after the exception escaped the relay reference stayed on a destroyed client and tools reported "not connected" forever. Now it catches and falls back locally, and retries respawn automatically after 5s.

- **connect 超时泄漏 socket**：8s 超时只 reject 不销毁，对 hang 住的守护进程持续泄漏 FD 和监听器；超时现销毁 socket 并计入重连/重拉统计。

- **connect timeout leaked sockets**: the 8s timeout only rejected without destroying, so a hung daemon leaked FDs and listeners continuously; the timeout now destroys the socket and counts toward reconnect/respawn statistics.

- **守护进程超时未杀变僵尸**：`waitForRelay` 超时后慢启动的 daemon 仍会上线绑端口，与降级的本地 relay 双绑并存；超时现先杀再降级。

- **A daemon that timed out wasn't killed and became a zombie**: after `waitForRelay` timed out, a slow-starting daemon would still come online and bind its port, coexisting double-bound with the fallback local relay; the timeout now kills it before falling back.

- **fallback 双 start 自锁**：本地 relay 已被 `createRelay` 启动后又被 `index.ts` 启动第二次，自撞 EADDRINUSE 并误报"多实例冲突"。

- **Fallback double-start self-lock**: a local relay already started by `createRelay` was started a second time by `index.ts`, hitting EADDRINUSE itself and falsely reporting a "multi-instance conflict".

- `dota_status`/工具未连接提示、README、AGENTS.md 同步新连接模型（vconsole2 GUI 不再列为使用前提）。

- `dota_status`/tool "not connected" messages, README, and AGENTS.md synced to the new connection model (the vconsole2 GUI is no longer listed as a usage prerequisite).

## 1.3.1 (2026-07-18)

### 新增

- **`dota2_skill` 内置技能工具**（Roblox skill 模式）：skill 内容随 MCP 分发，agent 调用 `dota2_skill` 即可拉取，无需单独安装 skill 文件。首个技能 `dota2-runtime-dev` 讲清"Dota 2 自定义游戏是长驻进程 + 热重载"的核心认知——改代码经 `reload_script`（服务端）/ Panorama 热重载生效，而非重启地图；并覆盖生成代码边界（改 `.ts/.tsx` 别碰生成的 `.lua/.js`）与 KV 只读约定。skill 以标准 `skills/<name>/SKILL.md` 存放，新增技能只需丢入文件夹。

- **`dota2_skill` built-in skill tool** (Roblox skill pattern): skill content is distributed with MCP and the agent pulls it by calling `dota2_skill` — no separate skill-file installation. The first skill, `dota2-runtime-dev`, teaches the core mental model that "a Dota 2 custom game is a long-lived process + hot reload" — code changes take effect via `reload_script` (server) / Panorama hot reload rather than restarting the map; it also covers the generated-code boundary (edit `.ts/.tsx`, don't touch the generated `.lua/.js`) and the KV read-only convention. Skills live in the standard `skills/<name>/SKILL.md`; adding one just means dropping it into a folder.

## 1.3.0 (2026-07-17)

### 新增

- **`dota_status` 任务入口工具**：用户说"测试 / 验证 / 调试 Dota 2 项目"时 agent 的第一个抓手。报告连接 + addon + 地图状态，并根据状态指明下一步该调的工具（launch / console_output 查错 / dota_run_lua 验证），把工作流直接交给 agent。

- **`dota_status` task-entry tool**: the agent's first handhold when the user says "test / verify / debug a Dota 2 project". It reports connection + addon + map status and, based on that status, points to the next tool to call (launch / console_output to check errors / dota_run_lua to verify), handing the workflow to the agent directly.

### 改进

- **全部工具描述改为任务导向**：以"什么时候用"开头、用任务语言（"用户报告游戏内 bug 时用""用户想测试 addon 时启动地图"），修复了之前实现视角描述（"Send console command via VCon TCP"）导致 agent 匹配不到用户意图、转而去用别的工具的问题。

- **All tool descriptions rewritten task-oriented**: they start with "when to use" in task language ("use when the user reports an in-game bug", "launch the map when the user wants to test an addon"), fixing the previous implementation-view descriptions ("Send console command via VCon TCP") that made the agent fail to match user intent and reach for other tools.

### 修复

- **addon 首次检测**：瘦客户端连上已运行的 daemon 时拿不到历史 addon（`adon` 事件早已发过），导致 `dota_status` 首次返回 `addon: "(detecting...)"`、maps 为空。启动时改从 hello-ok 握手读取 addon/maps；ADON 帧异步延迟时 `dota_status` 最多等待 3s。

- **First addon detection**: a thin client attaching to an already-running daemon couldn't get the historical addon (the `adon` event had long been sent), so `dota_status` first returned `addon: "(detecting...)"` with empty maps. Startup now reads addon/maps from the hello-ok handshake; `dota_status` waits up to 3s when the ADON frame is asynchronously delayed.

## 1.2.1 (2026-07-17)

### 修复

- **守护进程 spawn 接线**：`createRelay` 现在真正通过 `acquireLock → spawnRelayDaemon → waitForRelay` 拉起 detached 守护进程。此前这些 API 是死代码，每个实例仍本地启动 relay，"守护进程独立于 MCP 会话存活"未真正实现。

- **Daemon spawn wiring**: `createRelay` now actually launches a detached daemon through `acquireLock → spawnRelayDaemon → waitForRelay`. Previously these APIs were dead code and each instance still started a local relay, so "the daemon survives independently of the MCP session" was never really implemented.

- **安全：控制端口握手强制**。设了 token 后，未完成 HELLO 的连接无法发送任何命令，修复本机进程跳过握手直接 `CMD:` 注入（RunScriptCode 等于 RCE）的绕过。

- **Security: control-port handshake enforced**. With a token set, a connection that hasn't completed HELLO can't send any command, fixing the bypass where a local process skipped the handshake and injected `CMD:` directly (RunScriptCode equals RCE).

- **connect 僵尸 Promise**：`hello-ok` 永不到达（如 daemon 握手前崩溃）时 8s 超时 reject，修复 `createRelay` 永久 await 导致 MCP 启动卡死。

- **Zombie connect Promise**: when `hello-ok` never arrives (e.g. the daemon crashes before the handshake), an 8s timeout rejects, fixing `createRelay` awaiting forever and hanging MCP startup.

- **daemon 重启崩所有 MCP 进程**：连接丢失不再抛 unhandled `error` 事件，静默走自动重连（指数退避封顶 5s），断线期间命令缓冲重连后补发。

- **Daemon restart crashed every MCP process**: connection loss no longer throws an unhandled `error` event; it silently auto-reconnects (exponential backoff capped at 5s), buffering commands during the outage and resending them after reconnect.

- **VCon 帧重组（GUI→Dota）**：按 12 字节帧头 length 重组，修复大命令或网络抖动时半帧转发导致的引擎协议错乱。

- **VCon frame reassembly (GUI→Dota)**: reassemble by the 12-byte frame header's length, fixing engine protocol corruption from forwarding half-frames on large commands or network jitter.

- **npm 包缺失 daemon 文件**：`files` 字段从仅 `dist/index.js` 改为 `dist/*.js`，否则 npx 安装后 `require.resolve('./relay-main.js')` 抛错（发布阻断）。

- **npm package missing daemon files**: the `files` field changed from only `dist/index.js` to `dist/*.js`, otherwise `require.resolve('./relay-main.js')` throws after an npx install (a release blocker).

- **Dota 2 路径检测**：`find-steam-app` 无法解析新版 `libraryfolders.vdf` 导致 `detectDotaPath()` 恒 null、地图扫描静默失效。改为 注册表 SteamPath → STEAM_PATH 环境变量 → 平台默认位置，每个来源展开 VDF 枚举所有库，支持任意盘/目录名。

- **Dota 2 path detection**: `find-steam-app` couldn't parse the new `libraryfolders.vdf`, making `detectDotaPath()` always null and map scanning silently fail. Changed to: registry SteamPath → STEAM_PATH env var → platform default locations, expanding the VDF for each source to enumerate all libraries and support any drive/directory name.

- 检测不到 Dota 2 路径时 `dota_compile_asset` 给出可操作错误，而非静默拼出相对路径失败。

- When the Dota 2 path can't be detected, `dota_compile_asset` reports an actionable error instead of silently assembling a relative path and failing.

- token 生成改用 `crypto.randomBytes` + `wx` 原子创建。

- Token generation switched to `crypto.randomBytes` + atomic `wx` creation.

- `livePid()` stale 清理比对内容，避免误删新 daemon 的 PID。

- `livePid()` stale cleanup compares content, avoiding deleting a new daemon's PID by mistake.

- 空闲退出时清理 `relay.pid`。

- Clean up `relay.pid` on idle exit.

## 1.2.0 (2026-07-17)

### 新增

- **多实例共存：relay 守护进程 + 瘦客户端模式。** 多个 AI agent / 会话可同时通过 MCP 接入，共享同一个常驻 relay（独占 Dota 2 `:29000`），不再因 `:29001/:29002` 端口冲突导致后启动实例全部不可用。

- **Multi-instance coexistence: relay daemon + thin-client mode.** Multiple AI agents / sessions can attach via MCP at the same time, sharing one resident relay (holding Dota 2 `:29000` exclusively), so later-starting instances are no longer all unusable due to `:29001/:29002` port conflicts.

- relay 守护进程独立存活（detached spawn），无客户端连接 5 分钟后自动退出。

- The relay daemon survives independently (detached spawn) and auto-exits after 5 minutes with no client connected.

- 瘦客户端通过 `:29002` 接入：`HELLO` 握手 + token 校验（`<tmpdir>/dota2-mcp/relay.token`，0600）、`STREAM` 实时 PRNT 推送、`SHUTDOWN` 空客户端自杀。

- Thin clients attach via `:29002`: `HELLO` handshake + token check (`<tmpdir>/dota2-mcp/relay.token`, 0600), `STREAM` real-time PRNT push, `SHUTDOWN` empty-client self-exit.

- 守护进程协调：文件锁 + PID + stale 检测，防止并发 spawn 竞态。

- Daemon coordination: file lock + PID + stale detection to prevent concurrent-spawn races.

- 端口被占用时工具报错明确指向"另一个实例冲突"，而非误导性的"未连接 Dota 2"。

- When a port is occupied, tool errors clearly point to "another instance conflict" rather than the misleading "not connected to Dota 2".

- 新增 `scripts/test-daemon.mjs`：离线守护进程链路测试（无需 Dota 2）。

- Added `scripts/test-daemon.mjs`: offline daemon-chain test (no Dota 2 needed).

### 修复

- `zod` 补入 `dependencies`（此前依赖 `@modelcontextprotocol/sdk` 的间接提升）。

- `zod` added to `dependencies` (previously it relied on an indirect hoist from `@modelcontextprotocol/sdk`).

- relay 的 Dota 2 路径硬编码改为跟随 `detectDotaPath()` 自动检测。

- The relay's hardcoded Dota 2 path changed to follow `detectDotaPath()` auto-detection.

## 1.1.1 (未发布)

### 改进

- 使用 `find-steam-app` 库替代手写路径解析，自动跨平台查找 Dota 2 安装目录。

- Use the `find-steam-app` library instead of hand-written path parsing to locate the Dota 2 install directory cross-platform.

- README 补充占位路径说明。

- README adds a placeholder-path note.

## 1.1.0 (2026-06-25)

### 新增

- 跨平台支持：Windows、Linux、macOS。

- Cross-platform support: Windows, Linux, macOS.

- 按平台自动检测 Steam / Dota 2 安装路径。

- Auto-detect the Steam / Dota 2 install path per platform.

- `npm run package` 现在使用 Node SEA 生成当前平台的独立可执行文件。

- `npm run package` now uses Node SEA to produce a standalone executable for the current platform.

- 新增 GitHub Actions Release workflow，发布 Release 时自动构建三平台二进制并上传。

- Added a GitHub Actions Release workflow that auto-builds and uploads three-platform binaries on Release.

- 添加 MIT 开源协议。

- Added the MIT license.

## 1.0.0 (2026-06-25)

首个可用版本。

First usable version.

### 新增

- 基于 stdio 的 MCP 服务器，注册 20 个工具。

- stdio-based MCP server registering 20 tools.

- VConsole2 TCP relay：在 Dota 2 `:29000` 与 vconsole2 GUI `:29001` 之间透明转发，MCP 通过 `:29002` 注入命令。

- VConsole2 TCP relay: transparently forwards between Dota 2 `:29000` and the vconsole2 GUI `:29001`; MCP injects commands through `:29002`.

- 实时控制台 I/O：`console_send`、`console_output`、`console_channels`、`console_find`、`console_help`。

- Real-time console I/O: `console_send`, `console_output`, `console_channels`, `console_find`, `console_help`.

- 游戏控制：`project_info`、`dota_launch_game`、`dota_disconnect`、`dota_restart`。

- Game control: `project_info`, `dota_launch_game`, `dota_disconnect`, `dota_restart`.

- 运行时 API 查询：`dota_api_lua`、`dota_api_panorama_js`、`dota_api_css`、`dota_api_events`、`dota_api_help`。

- Runtime API lookup: `dota_api_lua`, `dota_api_panorama_js`, `dota_api_css`, `dota_api_events`, `dota_api_help`.

- 调试检查：`dota_dump_entities`、`dota_dump_modifiers`、`dota_entity_inspect`、`dota_run_lua`。

- Debug inspection: `dota_dump_entities`, `dota_dump_modifiers`, `dota_entity_inspect`, `dota_run_lua`.

- 资源工具：`dota_compile_asset`。

- Resource tool: `dota_compile_asset`.

- vconsole2 GUI 输出屏蔽：默认把 MCP 命令输出用 `ai_disabled; ...; ai_disabled` 包裹，relay 自动隐藏标记间输出；MCP 仍可读完整输出。

- vconsole2 GUI output masking: by default MCP command output is wrapped in `ai_disabled; ...; ai_disabled`, and the relay auto-hides the output between the markers; MCP can still read the full output.

- 全量冒烟测试脚本 `scripts/test-mcp-tools.mjs`。

- Full smoke-test script `scripts/test-mcp-tools.mjs`.

- 支持打包为独立 Windows 可执行文件 `dist/dota2-mcp.exe`（esbuild + Node SEA）。

- Support packaging a standalone Windows executable `dist/dota2-mcp.exe` (esbuild + Node SEA).

### 修复

- `console_find`、`console_help`、多个 API dump 工具因控制台输出捕获时机问题返回空结果的缺陷。

- Fixed `console_find`, `console_help`, and several API dump tools returning empty results due to console-output capture timing.

### 项目

- 补充 `README.md` 与 `CHANGELOG.md`。

- Added `README.md` and `CHANGELOG.md`.

- `package.json` 升级到 `1.0.0`，增加 `files` / `keywords` 等发布字段。

- `package.json` bumped to `1.0.0`, adding `files` / `keywords` and other release fields.

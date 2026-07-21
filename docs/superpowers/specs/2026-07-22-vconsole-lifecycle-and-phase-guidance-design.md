# 设计：relay 连接生命周期 + vconsole 显式契约 + 游戏相位推进指引

日期：2026-07-22
状态：已定稿（经实机调试验证根因）

## 背景与根因（全部经实机验证）

本次调试在用户机器上完整复现并钉死了以下事实：

1. **引擎门控（引擎行为，不可修）**：Dota 2 在 29000 上只允许 1 个 VCon 客户端。relay 持有 29000 时，引擎认为「vconsole 已连接」，AssetBrowser 的 vconsole 按钮/快捷键**完全不动作**（不拉起进程）。已验证：relay 持有 29000 时点按钮，relay 日志中零 vconsole 连接尝试、系统中无 vconsole2.exe 进程；relay 退出后按钮立即可用。
2. **vconsole2.exe 是独立进程**，不随 dota2.exe 死亡；用户的 vconsole2 已保存连接配置 `127.0.0.1:29001`（连 relay 的 GUI 口），无论按钮拉起还是手动启动都用该配置。
3. **晚到的 GUI 拿不到初始化帧**：Dota 在连接建立时推送 AINF→CHAN→CVRB→CFGV→ADON 初始化序列，relay 只转发「之后新到达」的帧。relay 已持有 29000 后才接入的 vconsole 什么都收不到 → 窗口是空壳。
4. **空闲退出切断生命线**：无瘦客户端且无 GUI 满 5 分钟 daemon 退出 → 29001/29002 消失，vconsole 连 TCP 都没地方连。
5. **无活性检测**：对端装死（真实崩溃写 dump 挂起、半开连接）时 socket 不发 FIN/RST，relay 永远以为连着，不重连、不广播。
6. **dota_status 与 project_info 职责重复**：都查 status_json、都报 addon/maps/状态。
7. **dota_launch_game 以「地图已加载」为终点**：加载后卡在 CUSTOM_GAME_SETUP 等相位时 agent 不知情，也不知道怎么推进。

### 原始故障链还原

用户日常流程「关 vconsole → 重启 Dota → vconsole 打不开」：relay 2 秒内抢占 29000 → 引擎门控使按钮失效（根因 1）；手动强启的 vconsole2.exe 连上 29001 后拿不到初始化帧（根因 3）；若无 MCP 会话附着，daemon 空闲退出使 29001 彻底消失（根因 4）。

## 设计原则

- **显式 > 兜底**：不做任何「自动帮用户开窗口」的隐式行为。规则简单、报错指名原因、补救路径写在报错里。不让使用者觉得「有 BUG、搞不懂」。
- **契约即产品**：控制台类 MCP 工具要求 vconsole 已打开。这不是技术必需（29000 本身不需要 GUI），而是人为契约——保证人类始终能旁观 agent 的控制台活动（「MCP 重度依赖 vconsole」的真正含义）。
- **状态单点**：一切状态与周期任务都在 daemon 内；N 个 agent 瘦客户端无状态，多 agent 场景天然一致。

## 设计

### A. 连接模型：29000 常持，不主动断

- relay 启动即连 29000 并常持；断线/失败每 2s 重连（现状保留）。无租约、无引用计数、无按需连接（E 节的活性探测只是死亡检测，不改变常持模型）。
- 29001（GUI）/29002（控制）常开。
- 重连调度去重：error/close 双处理器现在各排一个 timer（日志每轮重试打两行），合并为单一 `scheduleReconnect()`。

### B. vconsole 显式契约（核心变更）

**控制台类工具（18 个）入口两段检查**（统一 helper `requireConsole()` 替换现有 `relay.dotaConnected` 检查；其中 `dota_status` 不抛异常、改为返回指引文本，其余 17 个显式报错）：

1. Dota 未连接 → 报错：Dota 未运行或已崩溃；relay 会自动重连；若刚重启 Dota 还持续看到此消息，可能是旧 dota2.exe 未退干净（29000 被占），需彻底结束后重启。
2. Dota 已连接但 **29001 无 GUI 接入** → 报错：`vconsole 未打开。请运行 vconsole2.exe 并连接 127.0.0.1:29001（AssetBrowser 的 vconsole 按钮在 relay 持有 29000 时被引擎禁用，请直接运行 exe），或调用 dota_open_vconsole`。

**不受契约限制的 4 个工具**：

| 工具 | 原因 |
|------|------|
| `dota_compile_asset` | 纯本地子进程（resourcecompiler/Source2Viewer-CLI），不碰 Dota |
| `dota2_skill` | 读本地 skill 文档 |
| `console_gui_filter` | 只改 relay 转发过滤规则 |
| `dota_open_vconsole` | 契约的解药（见 C） |

**`dota_status` 永不抛异常**：作为入口/导航工具，无 Dota 或无 vconsole 时返回当前状态 + 下一步指引文本（与现有 Dota 未连接时的行为风格一致）。

### C. 新工具 `dota_open_vconsole`

- spawn `{dotaPath}/game/bin/win64/vconsole2.exe`（复用 index.ts 现有 `getDotaBinDir`/`getDotaExeName`/`runDotaTool` 模式，waitForExit=false）。
- 等待 ≤10s 直到 `guiConnected` 变 true，显式返回成功/失败（失败时提示检查 vconsole2 连接配置是否为 127.0.0.1:29001）。
- 实现时顺带确认 vconsole2.exe 是否支持命令行指定连接地址；支持则带上 29001，不支持则依赖用户已保存的配置（文档写明）。
- 无 vconsole2.exe 进程时由 agent 在用户要求下调用（显式事件，非隐式魔法）。**不做看门狗/自动拉起**（已否决：与人工意志冲突、灵异体验）。

### D. 初始化帧重放（修「窗口是空壳」）

- relay 在每次 Dota 连接上按到达顺序缓存 AINF/CHAN/CVRB/CFGV/ADON 原始帧（新连接时清空重建）。
- GUI 连上 29001：先把缓存帧原样写入，再接管实时转发。Dota 重连时新初始化序列自然流经（已附着 GUI 自动复活，现状已验证）。
- 当前 relay 只支持单 GUI socket（新连接覆盖旧连接），维持不变；重放对每个新接入的 GUI 执行。

### E. 引擎活性探测（修「对端装死」）

VConRelay 内实现（daemon 与内嵌模式同生效）：

- 以最后一个 rawFrame 时间戳为 `lastDataAt`（无需改 VConClient）。
- 周期检查（默认每 10s）：`_dotaConnected` 且静默 >15s → 经 `dotaClient.sendCommand("echo __mcp_ping__")` 发探针（不走 MCP 的 ai_disabled 包装）；探针发出后 20s 内仍无任何数据 → `close()` 掐断走现有重连。
- 僵尸识别：新连接 `connected` 后 10s 内收不到 AINF → 掐断重连（僵尸进程只 accept 不说话；正常 Dota 一连上就发 AINF）。
- 探针回显行 `__mcp_ping__` 在 prnt 处理器与 rawPrntEditor 中精确匹配丢弃：不进 MCP 缓冲、不广播瘦客户端、不转发 GUI。
- 判死走现有 close 路径：广播 `{type:"status", dota:false}` 给所有瘦客户端 → 所有 agent 同步快速失败。
- 超时参数做成 VConRelay 构造函数可选注入（`{probeIntervalMs, silenceMs, pongTimeoutMs, ainfTimeoutMs}`），供离线测试用小值。

### F. 空闲退出守卫

- `_resetIdleTimer` 退出条件加「且无 dota2.exe 进程」：`clients.size === 0 && !this._guiConnected && !isDotaProcessRunning()`。
- `isDotaProcessRunning()` 加在 `console-bridge.ts`（win32: `tasklist /FI "IMAGENAME eq dota2.exe"`；其他平台 `pgrep -x dota2`；检查失败时保守返回 true 即不退）。
- Dota 在跑 = 用户在开发 = daemon 常驻保 29001/29002；Dota 关了才走 5 分钟空闲退出。

### G. 工具合并：删 project_info，并入 dota_status

- `dota_status` 吸收 project_info 全部字段（allMaps、hibernating、cpu_usage、udp_port、network_lag_avg、build_version、process_uptime、clients_bot、clients_proxies、first_player、connection{dota,gui}）+ 保留 nextStep 导航 + 永不抛异常。描述合并两者关键词（入口/导航 + 查 addon/maps/实时状态）。
- 删除 `project_info` 注册。引用处更新：`dota_launch_game` 描述「Call project_info first」→「Call dota_status first」；AGENTS.md 工具表（总数 22 不变：-1 +1 dota_open_vconsole）；README 若列工具则同步。
- 已附着 vconsole 时 dota_status 的 JSON 增加 `vconsole: true` 字段。

### H. MCP 层快速失败

- `dota_launch_game` 轮询循环每轮检查 `relay.dotaConnected`：断线立即返回明确错误（不再干等满超时）。
- `notConnectedText()` 按 B-1 文案重写。

### I. 问题 2：游戏相位检测与推进指引

**`dota_launch_game` 改造**：

- 发启动命令后每 2s 轮询 status_json，终点从「map loaded」改为 `game_state` 含 `GAME_IN_PROGRESS`。timeout 默认 45s→90s（参数仍可调）。
- 跟踪 `lastState + lastChangeAt`：同一 game_state 持续 15s 未变（且未达终点）→ 判定卡住，**立即返回 stuck 报告**（正常文本，不抛异常）：
  - 当前 state 原文 + 已卡时长；
  - 该相位的推进指引（内置 `PHASE_GUIDANCE` 常量表，见下）；
  - 最近 ~8 条 VScript 通道或 verbosity≥3 的输出行（卡 setup 最常见原因是 addon Lua 报错）;
  - 指向 `dota2_skill` 的 `dota2-game-phases` 文档。
- 轮询中 `dotaConnected` 变 false → 立即返回崩溃/断线提示（接 H）。
- 超时未达 GAME_IN_PROGRESS → 返回最后状态 + 同样的 stuck 报告。

**`PHASE_GUIDANCE`（实现时必须先用 `console_find`/`script_help2` 对活体验证命令名再写死）**：

| game_state | 指引 |
|---|---|
| `INIT` / `WAIT_FOR_MAP_TO_LOAD` | 正常应秒过；卡 → console_output 看 ResourceSystem（地图未编译/资源缺失） |
| `WAIT_FOR_PLAYERS_TO_LOAD` | 一般自动过；卡 → console_output 看哪个 client 未加载完 |
| `CUSTOM_GAME_SETUP` | `dota_run_lua` 执行 `GameRules:FinishCustomGameSetup()`；反复卡 → addon setup 逻辑报错 → console_output (level 3, channel VScript) |
| `HERO_SELECTION` | addon 控制；可 Lua 指定英雄 / addon 内设选择时间为 0（以验证为准） |
| `STRATEGY_TIME` / `TEAM_SHOWCASE` / `PRE_GAME` | 定时自动过；可用 GameRules 对应 setter 调短（以验证为准） |
| `POST_GAME` | `dota_restart` 重开 |

**新增 `skills/dota2-game-phases/SKILL.md`**：完整相位表、每相位正常时长、卡住处置 SOP（先 console_output 查错 → 再按指引推进 → 推不动就是 addon bug）。frontmatter description 写明「launch 后卡住时读我」。`dota_status` 的 nextStep 在相位非 playing 时指路该文档。

### J. 多 agent 一致性

- 契约检查、重放缓存、活性探测、空闲守卫全部在 daemon/relay 单点：N 个瘦客户端看到同一份 `guiConnected`/`dotaConnected`（经 hello-ok + status 广播，现有链路）。
- 任一 agent（或用户手动）打开 vconsole → `guiConnected` 广播 → 所有 agent 同时解除契约限制。

### K. 工具说明与全仓内容同步（验收项）

实现完毕后统一跟进，不允许留下与新行为矛盾的表述：

- **工具描述**（index.ts 每个 `server.tool()` 的 description）：
  - 17 个契约门控工具的描述统一加「需要 vconsole 已打开（29001 接入）」前提说明，agent 在调用前即可知；
  - `dota_status`：合并后的描述覆盖原 project_info 关键词（addon/maps/实时状态查询）+ 入口导航 + 永不抛异常；
  - `dota_launch_game`：描述改为「等待进入 GAME_IN_PROGRESS；卡住时返回相位与推进指引」；
  - `dota_open_vconsole`：新工具描述写明「AssetBrowser 按钮在 relay 持有 29000 时被引擎禁用，用本工具直接拉起」；
  - 删除 `project_info`。
- **AGENTS.md**：工具表（-project_info +dota_open_vconsole）；「关键发现」的「只允许 1 个 VCon 客户端」条目改写为实测事实（引擎门控=按钮失效）；「已知问题 / 注意事项」前两 bullet 按实测重写（按钮无效及替代路径、vconsole 契约）；架构/数据流一节补一句契约。
- **README.md**：只同步用户可见信息（vconsole 用法：直接运行 vconsole2.exe 连 29001；控制台工具需要 vconsole 打开；工具清单若有）。
- **skills/dota2-runtime-dev/SKILL.md**：工具清单段更新（dota_status 合并、契约前提、dota_open_vconsole）。
- **代码注释**：`src/index.ts` 头部注释（tool layers 列表已过时）；`src/tools/vcon-relay.ts` 头部注释（补初始化帧重放与活性探测）；全仓 grep 清扫 `project_info` 及旧表述，零残留。

## 文件改动清单

| 文件 | 改动 |
|------|------|
| `src/tools/vcon-relay.ts` | 初始化帧缓存重放、活性探测+僵尸识别、探针行过滤、空闲退出守卫（接 isDotaProcessRunning）、重连去重、构造可选超时注入 |
| `src/tools/console-bridge.ts` | 新增 `isDotaProcessRunning()` |
| `src/index.ts` | `requireConsole()` 两段检查替换全部 dotaConnected 检查；notConnectedText 重写；新增 `dota_open_vconsole`；删 `project_info` 并入 `dota_status`；`dota_launch_game` 相位轮询+stuck 报告+PHASE_GUIDANCE |
| `skills/dota2-game-phases/SKILL.md` | 新增 |
| `skills/dota2-runtime-dev/SKILL.md` | 写明 vconsole 契约（用控制台工具前先开 vconsole） |
| `AGENTS.md` | 工具表（-project_info +dota_open_vconsole）、「已知问题」两 bullet 按实测事实重写（引擎门控/按钮无效/29001 配置）、vconsole 契约一节 |
| `README.md` | 若列工具则同步（README 不写实现细节，只提契约与工具名） |
| `scripts/test-liveness.mjs` | 新增离线冒烟（见下） |

`src/relay-client.ts`、`src/relay-main.ts`、`src/daemon-utils.ts`：不改。

## 验证

**离线**（不需要 Dota）：

- `scripts/test-liveness.mjs`：假 TCP server 两种形态——(1) accept 后装死（不发任何字节）→ relay 应在 ainfTimeout 内判死并重连；(2) 发一帧假 AINF 后沉默 → relay 应在 silenceMs+pongTimeoutMs 内探针后判死。注入小超时，assert 判死事件发生。
- `npm run check`（类型+版本一致性）。

**活体**（Dota 运行，实现后人工跑一遍矩阵）：

1. relay 连着、无 vconsole → `console_send` 报「vconsole 未打开」；`dota_status` 返回指引不抛异常；`dota_compile_asset` 正常。
2. `dota_open_vconsole` → 窗口出现且**有内容**（重放生效）；随后 `console_send` 通过。
3. 关掉 vconsole → 工具再次报契约错误；手动跑 vconsole2.exe → 恢复。
4. 杀 dota2.exe（vconsole 不关）→ 工具报 Dota 未连接；重启 Dota → relay 自恢复、vconsole 自复活。
5. 多 agent：两个 MCP 会话，一个调 dota_open_vconsole → 另一个的工具同时解除限制。
6. `dota_launch_game` 在 setup 卡住场景 → 返回 stuck 报告含相位名、`FinishCustomGameSetup` 指引、近期错误行。
7. `console_find`/`script_help2` 验证 PHASE_GUIDANCE 中所有命令名存在后写死。
8. 文档同步验收：grep `project_info` 零残留；逐一过 K 节清单确认工具描述/AGENTS.md/README/skill/代码注释与新行为一致。

## 明确不做

- 不做 vconsole 看门狗/自动拉起/关闭计数（显式原则，已否决）。
- 不做 29000 租约/引用计数/按需连接（已否决：被动输出丢失、状态机复杂）。
- 不杀残留 dota2.exe（破坏性；改为报错文案指引用户）。
- 不修引擎门控（引擎行为，无法修；文档写明按钮无效及替代路径）。
- TCP keepalive（活性探测已覆盖）。

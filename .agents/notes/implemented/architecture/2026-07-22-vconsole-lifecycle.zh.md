# Agent Note: vconsole relay 连接生命周期（常持 + 活性探测 + 初始化帧重放 + 空闲守卫）

[English](2026-07-22-vconsole-lifecycle.md) | 中文

Status: implemented

## Problem

relay 是 Dota 2 `:29000`、vconsole2 GUI `:29001`、MCP 控制口 `:29002` 之间的透明代理。旧实现有四个真实缺陷（均在实机调试中复现）：

1. **对端装死无检测**：真实崩溃写 dump 挂起或半开连接时 socket 不发 FIN/RST，relay 永远以为连着，不重连、不广播状态。
2. **晚到的 GUI 拿不到初始化帧**：Dota 在连接建立时推送 `AINF→CHAN→CVRB→CFGV→ADON` 初始化序列，旧 relay 只转发「之后新到达」的帧，relay 已持有 29000 后才接入的 vconsole 收到空壳窗口。
3. **重连调度重复**：error/close 双处理器各排一个 timer，每轮重试打两行日志。
4. **空闲退出切断生命线**：无瘦客户端且无 GUI 满 5 分钟 daemon 退出，`29001/29002` 消失，vconsole 连 TCP 都没地方连 —— 哪怕 Dota 正在运行（用户正在开发）。

## Decision

relay 对 Dota 2 `:29000` **常持连接**，断线每 2s 重连；无租约、无引用计数、无按需连接。四项机制兜住生命周期（全部在 `src/tools/vcon-relay.ts`，daemon 与内嵌模式同生效）：

- **初始化帧重放**：每次 Dota 连接按到达顺序缓存 `AINF/CHAN/CVRB/CFGV/ADON` 原始帧（新连接时清空重建）；GUI 连上 `:29001` 时先把缓存帧原样写入，再接管实时转发。Dota 重连时新初始化序列自然流经，已附着的 GUI 自动复活。
- **活性探测**：以最后一个 `rawFrame` 时间戳为 `lastDataAt`。周期检查（默认 10s）：静默 >15s 经 `dotaClient.sendCommand("echo __mcp_ping__")` 发探针（不走 `ai_disabled` 包装）；探针发出后 20s 内仍无任何数据 → `close()` 掐断走现有重连。僵尸识别：`connected` 后 10s 内收不到 AINF → 掐断重连（僵尸只 accept 不说话，正常 Dota 一连上就发 AINF）。探针回显行 `__mcp_ping__` 在 prnt 处理器与 rawPrntEditor 中精确匹配丢弃：不进 MCP 缓冲、不广播瘦客户端、不转发 GUI。
- **重连去重**：单一 `_scheduleReconnect()` timer，error/close/catch 多路触发只排一次。
- **空闲退出守卫**：退出条件加「且无 dota2.exe 进程」——`clients.size === 0 && !guiConnected && !isDotaProcessRunning()`。`isDotaProcessRunning()` 在 `console-bridge.ts`（win32: `tasklist /FI "IMAGENAME eq dota2.exe"`；其他平台 `pgrep -x dota2`；检查失败保守返回 true 即不退）。Dota 在跑 = 用户在开发 = daemon 常驻保 `29001/29002`。

超时参数做成 `VConRelay` 构造函数可选注入（`{probeIntervalMs, silenceMs, pongTimeoutMs, ainfTimeoutMs}`），供离线测试用小值。

## Alternatives considered

- **TCP keepalive** — 输了：活性探测覆盖崩溃挂起/半开连接，无需内核调优，复用 relay 自己的重连语义，且可注入超时离线断言。
- **29000 租约 / 引用计数 / 按需连接** — 输了：按需连接会在断开期间丢失被动输出、状态机复杂；常持 + 死亡检测更简单，「没窗口 = 没连接 = 没工具」保持物理为真。
- **vconsole 看门狗 / 自动拉起 / 关闭计数** — 输了（见 feature note 的 [Alternatives](../feature/2026-07-22-vconsole-contract-and-phase-guidance.md#alternatives-considered)）：与人工意志冲突、造成灵异体验；显式原则优先。

## Consequences

- **买到**：relay 在有界时间内判定死/挂起的 Dota 并重连；晚接入的 GUI 收到完整初始化序列（随开随用）；开发期间 daemon 不退出，`29001/29002` 常驻。
- **付出**：活性探测给引擎增加一条低频 `echo __mcp_ping__` 命令（双向过滤，不可见）；僵尸阈值可能误判极慢的地图加载（AINF 超时取 10s + 探针行过滤缓解）。
- **快速失败**：判死走现有 close 路径，向所有瘦客户端广播 `{type:"status", dota:false}`，所有 agent 同步快速失败。

## Testing

`scripts/test-relay.mjs` 离线四场景覆盖（fake VCon server + 随机端口 + 注入小超时）：僵尸 accept 不发言判死重连、初始化帧重放、探针 pong 保活 + 探针行过滤、无 pong 判死。`scripts/test-daemon.mjs` 覆盖守护进程空闲退出（Dota 在跑不退）。活体矩阵见 `AGENTS.md` 的开发-验证工作流。活体抓到两个离线抓不到的错误：AINF 计时器在启动期对健康连接误杀，以及 GUI 连接状态不广播（悄悄让整个契约失效）。

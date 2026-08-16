# Agent Note: vconsole 显式契约 + 游戏相位推进指引

[English](2026-07-22-vconsole-contract-and-phase-guidance.md) | 中文

Status: implemented

## Problem

三个问题指向同一个根因：agent 无法区分「Dota 没在跑」与「只是没开 vconsole」，也不清楚启动的地图卡住的相位该怎么推进。

1. **契约缺失**：控制台工具只检查 `relay.dotaConnected`，vconsole 没开时报「未连接」—— 但 Dota 明明连着，把 agent 引去查错地方。
2. **工具职责重复**：`dota_status` 与 `project_info` 都查 `status_json`、都报 addon/maps/状态。
3. **launch 终点错误**：`dota_launch_game` 以「地图已加载」为终点，加载后卡住的相位 agent 既不知情、也不知道怎么推进。

## Decision

**vconsole 显式契约（核心）**：17 个控制台工具入口统一走 `requireConsole()` 两段检查 —— Dota 连接 → vconsole 已接入 `:29001`；`dota_status` 不抛异常、改为返回当前状态 + 下一步指引，其余 16 个显式报错并给出打开路径。四个工具豁免：`dota_compile_asset`（纯本地子进程）、`dota2_skill`（读本地文档）、`console_gui_filter`（只改转发过滤）、`dota_open_vconsole`（契约的解药）。

**`dota_open_vconsole`**：spawn `{dotaPath}/game/bin/win64/vconsole2.exe`，等待 ≤10s 直到 `guiConnected`，显式返回成功/失败。无看门狗、无自动拉起 —— 只在被要求时调用。

**`project_info` 删除，并入 `dota_status`**：`dota_status` 吸收全部字段（allMaps、hibernating、cpu_usage、build_version、process_uptime、clients_* 等）+ 保留 nextStep 导航 + 永不抛异常。

**`dota_launch_game` 相位轮询**：发启动命令后每 2s 轮询 `status_json`，终点从「map loaded」改为 `game_state` 含 `GAME_IN_PROGRESS`（默认 timeout 90s）。跟踪 `lastState + lastChangeAt`：同一 `game_state` 持续 15s 未达终点 → 返回 stuck 报告（正常文本，不抛异常）：当前 state + 已卡时长 + 该相位推进指引（`PHASE_GUIDANCE` 表）+ 最近 ~8 条 VScript/verbosity≥3 输出行 + 指向 `dota2_skill` 的 `dota2-game-phases`。轮询中 `dotaConnected` 变 false → 立即返回崩溃/断线提示。

完整相位表与推进方法放在 `skills/dota2-game-phases/SKILL.md`（命令名经活体 `script_help2` 验证后才写死）。

## Alternatives considered

- **vconsole 看门狗 / 自动拉起 / 关闭计数** — 输了：与人工意志冲突（关掉窗口是明确意图，自动重开是灵异体验）；显式 > 兜底，规则简单、报错指名原因、补救路径写在报错里。
- **契约下沉到 daemon/relay 层** — 输了：契约是 MCP 层的产品决策（「保证人类能旁观 agent 的控制台活动」）；daemon 保持宽松，29002 直连协议仍可用作验证旁路。
- **保留 project_info 独立** — 输了：两份都查 status_json，职责重复；合并后入口单一（`dota_status` 即导航）。
- **自动杀残留 dota2.exe** — 输了：破坏性操作；改为报错文案指引用户彻底结束进程。

## Consequences

- **买到**：「没窗口 = 没连接 = 没工具」的状态物理为真，使用者不会误判为 BUG；agent 拿到可执行的下一步；多 agent 场景下任一 agent 开 vconsole → `guiConnected` 广播 → 所有 agent 同步解除限制（`test-multi-session.mjs` 覆盖）。
- **付出**：控制台工具多了一个硬前提（vconsole 窗口必须开着），要求人类保持窗口在场 —— 这是刻意的契约，不是技术必需（29000 本身不需要 GUI）。放弃了「无头用控制台」的隐式便利。

## Testing

`scripts/test-mcp-offline.mjs` 覆盖契约门控报错 + `dota_status` 不抛异常；`scripts/test-mcp-live.mjs` 覆盖门控 → `dota_open_vconsole` → 解门控全链路；`scripts/test-launch-phases.mjs` 覆盖卡相位 stuck 报告 + 按指引 `dota_run_lua` 推进到 GAME_IN_PROGRESS；`scripts/test-multi-session.mjs` 覆盖多会话共享 daemon。活体抓到两个离线抓不到的错误：dota_open_vconsole 等待过短，以及加载期 INIT 被误报为 stuck。

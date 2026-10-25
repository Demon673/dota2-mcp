# Agent Note: 推进到可玩对局的标准流程

[English](2026-10-17-advance-to-game.md) | 中文

Status: implemented

## Problem

测试 addon 需要一局处于 GAME_IN_PROGRESS 且有英雄的对局。`dota_launch_game` 或 `dota_restart` 之后，游戏会停在 CUSTOM_GAME_SETUP、HERO_SELECTION 和各计时相位，而唯一的指引是逐相位的说明文字：「用 dota_run_lua 分配英雄」「在 addon 代码里缩短」。agent 只能自己写 Lua，而最顺手的捷径是个陷阱：在 PRE_GAME 之前调用 `GameRules:ForceGameStart()`，会进入 GAME_IN_PROGRESS 却没有生成英雄。在一个 addon 上的活体运行还在同一路径上暴露了另外三个缺陷：

- 地图正常加载到第 17 秒时，`dota_launch_game` 就报「卡在 INIT」。
- `dota_restart` 在重启生效前就返回，下一次状态读取看到的仍是旧的 GAME_IN_PROGRESS。
- Lua 工具的输出漏进 vconsole 窗口。`ent_fire … RunScriptCode` 在下一帧才执行，那时 relay 的 `ai_disabled; <cmd>; ai_disabled` 屏蔽窗口已经关闭，所以 `dota_run_lua` 的每一行 `print`、以及收集用的结束标记，都到了 GUI。

## Decision

`dota_advance_to_game` 是唯一的标准流程。它每秒轮询一次 `status_json`，只按观测到的 `game_state` 行动，不依赖任何 addon 特有的东西：

| game_state | 动作 |
|---|---|
| INIT、WAIT_FOR_* | 等待 |
| CUSTOM_GAME_SETUP | 把策略/展示/赛前计时清零，`FinishCustomGameSetup()` |
| HERO_SELECTION | 计时清零；经玩家控制器，对每个没有英雄的玩家 `MakeRandomHeroSelection()`，给了 `hero` 时对每个玩家 `SetSelectedHero(hero)` |
| STRATEGY_TIME、TEAM_SHOWCASE | 计时清零 |
| PRE_GAME，3 秒后仍未推进 | `ForceGameStart()` |
| GAME_IN_PROGRESS | 报告所做步骤和每个玩家的英雄 |
| POST_GAME，或没有加载地图 | 报错，指向 `dota_restart` / `dota_launch_game` |

同一相位持续期间，一个动作至多每 5 秒重复一次。超时时返回共用的卡相位报告（`buildStuckReport`），附近期错误。相位指引和 `dota2-game-phases` skill 现在指向这个工具，不再描述 Lua 调用。

配套改动：

- `dota_launch_game` 不把 INIT 或 WAIT_FOR_* 当作卡住（`isLoadingPhase`）；永远加载不完的情况只由它的超时报告。
- `dota_restart` 使用 20 秒墙钟 deadline，直到状态显示正在加载或 `game_state` 变化；缓慢的 `status_json` 应答不会累加放大超时。
- MCP 屏蔽开启时，`collectLuaOutput` 在用户代码前后各打印一行 relay 自己的开关行（`ai_disabled =`），让推迟执行的 Lua 输出落进屏蔽窗口。用户代码在 `xpcall(…, function(e) print(debug.traceback(e)) end)` 下运行，运行时报错也会打印收尾开关行和结束标记；否则屏蔽会卡在开启态，让 GUI 静默。
- relay 永不把匹配 `MCP_MARKER_RE` 的行转发给 GUI。这个正则现在定义在 `vcon-relay.ts`，由 `index.ts` 导入。
- 引擎会静默丢弃超过约 510 字节的单条控制台语句（510 字节的 `echo` 能执行，530 字节不能；上限按 `;` 分隔的语句计，而非整行）。包装后的 `RunScriptCode` 语句超过 `LUA_STATEMENT_MAX_BYTES` 时，`collectLuaOutput` 报错并说明还剩多少字节可用，而不是返回空结果。
- `sv_cheats` 关闭时引擎忽略 `ent_fire`，只打印 `SV: Cheat command 'ent_fire' ignored.`。`collectLuaOutput` 把这一行转成点名 `sv_cheats` 的错误，`dota_run_lua` 和 `dota_advance_to_game` 立即停下，而不是回复「Sent」或一直重试到超时。
- 加载重资源时引擎可能数秒不应答 `status_json`。`dota_launch_game` 和 `dota_advance_to_game` 跳过没有应答的那次轮询，而不是把它读成 `(unknown)` 状态。
- 启动命令发出 15 秒后游戏仍在主菜单时，`dota_launch_game` 报错。
- GAME_IN_PROGRESS 中所有玩家的英雄都是 `nil` 时，`dota_advance_to_game` 说明 addon 可能自己创建英雄，并建议调用 `dota_screenshot`。

## Alternatives considered

- **给 `dota_launch_game` 加一个 `advance` 开关。** 否决：`dota_restart` 之后重测需要同样的流程但不需要启动，所以流程必须是独立工具。
- **把所有相位动作放进一次 Lua 调用。** 否决：相位变化是异步的；每秒按观测状态行动，正是流程不依赖具体 addon 相位顺序的原因。
- **第一步就 `ForceGameStart()`。** 否决：实测得到没有英雄的对局。
- **在 relay 里对每条 MCP 命令之后开一个时间窗口屏蔽 Lua 输出。** 否决：长到能盖住推迟执行的 Lua 的窗口，也会把游戏自身的输出藏同样久，而且只能猜窗口长度。
- **在 VM 里定义一个常驻 Lua 辅助函数来缩短包装。** 否决：它会在 addon 的 VM 里跨调用、跨重载留下 MCP 状态；每次调用的包装约占 170 字节，长度检查让这个预算一目了然。

## Consequences

收益：从启动或重启到一局有英雄的可玩对局只需两次工具调用（在一个 addon 上实测约 20 秒），步骤有报告，vconsole 里看不到 agent 的 Lua 输出和标记。代价：计时改动只影响当前这一局；随机选人会跳过 addon 已经分配了英雄的玩家。`dota_run_lua` 的代码限制在约 300 字节；有了 `xpcall` 包装，结尾的 `--` 注释现在会注释掉包装的尾部，这样的代码会编译失败，而不只是丢掉结束标记。

## Testing

- `scripts/test-collect-output.mjs`：假 Dota 对 `ai_disabled` 回显其值，并把 `RunScriptCode` 里的 print 推迟 50 ms 执行。它断言 `dota_run_lua` 仍能返回输出、输出和任何标记都不会到达假 vconsole、之后游戏自身的打印仍能到达。从构建产物里去掉开关行后，测试失败。它也让 `status_json` 保持无应答，验证 restart 在 20 秒 deadline 返回，而不是等待 40 × 5 秒。
- `scripts/test-mcp-offline.mjs` 计数 33 个工具。
- 活体（Dota 2 带 `-tools`，一个自身 setup 代码会报错的 addon）：`dota_disconnect` 后调用 `dota_advance_to_game` 返回「没有加载地图」错误；`dota_launch_game` → 带 `hero` 的 `dota_advance_to_game` 进入 GAME_IN_PROGRESS，英雄正是指定的那个；`dota_restart` → `dota_advance_to_game` 用时 18–20 秒，生成随机英雄。Lua `error()` 返回其 traceback，下一次调用正常。包装后 511 字节的语句被长度错误拒绝。
- 在第二个 addon 上活体运行（它在自己的登录界面之后才创建英雄）：从主菜单调用 `dota_launch_game`，约 50 秒加载完地图，并报告卡在 CUSTOM_GAME_SETUP；`dota_advance_to_game` 4 秒进入 GAME_IN_PROGRESS，返回 `hero=nil` 和英雄提示，`dota_screenshot` 显示的正是 addon 的登录界面。一次 75 秒的冷加载中，`status_json` 有 8 秒没有应答。`dota_restart` 在 CUSTOM_GAME_SETUP 和 GAME_IN_PROGRESS 下都正常。`sv_cheats 0` 时，`dota_run_lua` 0.5 秒返回 `sv_cheats` 错误。

未覆盖：没有离线测试驱动 `dota_advance_to_game` 走完各相位；该流程只在一个 addon、一名真人玩家、无 bot 的情况下活体跑过。

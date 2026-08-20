# Agent Note: vfx_preview 运行时粒子工具

[English](2026-08-20-vfx-preview.md) | 中文

Status: implemented

## Problem

写好 .vpcf 源并编译后，agent 无法在运行中的游戏里看到效果——特效工作流的验证一环（wayfinder #5）。

## Decision

两个门控工具复用 dota_run_lua 通道（ent_fire 0 RunScriptCode）。`vfx_preview` 执行 `ParticleManager:CreateParticle(path, PATTACH_<n>, nil)`，可选世界坐标经 `SetParticleControl(pid, 0, Vector(x,y,z))`，打印 `[MCP-VFX] pid=…`；`vfx_preview_stop` 执行 `ParticleManager:DestroyParticle(pid, false)`。两者继承 requireConsole（地图 #7 修正：与 dota_run_lua 同一执行通道，非新增限制）。spawn 结果必须以 console 加载错误为准（经 console_output 读 Particles/ResourceSystem 通道）——id 本身不能证明文件加载成功（研究 #5）。attach 0–15 映射 ParticleAttachment_t 名称。

## Alternatives considered

- **专用引擎命令。** 否决：研究 #5 未找到粒子控制台命令；Lua API 是已验证路径。
- **定时自动销毁。** 否决：保持工具无状态；显式 stop + 返回 id 更简单，预览持续到停止为止。

## Consequences

- `scripts/test-vfx-live.mjs` 钉住活体闭环：launch addon 地图 → 推进 CUSTOM_GAME_SETUP → spawn basic_explosion（pid>0、无加载错误）→ stop。
- 活体测试暴露两个测试 addon 前置条件（已记录）：basic 模板的空 KV3 `addoninfo.txt` 必须声明 `AddonInfo { maps … IsPlayable }`（已在 dota2mcptest 测试仓库修复）；地图必须先编译（resourcecompiler 产出 `game/maps/<map>.vpk`）才能被 `dota_launch_custom_game` 加载。
- 工具数 29 → 31。

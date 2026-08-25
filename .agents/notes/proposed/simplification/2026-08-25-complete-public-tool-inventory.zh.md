# Agent Note: 把 README 的工具清单补全到全部 31 个工具

[English](2026-08-25-complete-public-tool-inventory.md) | 中文

Status: proposed

## Problem

README.md 的“Available tools”（:241-290）列出了 31 个工具里的 21 个——缺 vrf_ensure、asset_inspect、asset_check_refs、vfx_preview、vfx_preview_stop、四个 file_* 工具，以及 dota2_skill（这些都是 src/index.ts 里的生产符号）。两份手工维护的清单镜像着真正的权威（src/index.ts 的注册表）：README（公开、只讲用途）和 AGENTS.md（:193-256，面向 agent 并带控制台命令）。公开的那份已经腐烂。

## Proposal

- 把 README 的表格补全到全部 31 个工具——公开契约必须展示每一项能力。
- 保留 AGENTS.md 的表格作为面向 agent 的参考（每个工具带控制台命令）：按层级分类法，两份表格服务不同的受众。在这里记录同步义务，让漂移不能无声复发。

## Alternatives considered

- **README 链接到 AGENTS.md 而不列出工具。** 否决：README 是公开契约，必须对 npm/GitHub 读者独立成篇。
- **从注册表生成两份表格。** 暂时否决：一个目录生成脚本的投资大于它所修复的漂移；如果出现第三份镜像再重新考虑。

## Acceptance criteria

- README 表格有 31 行，与 src/index.ts 的 server.tool 注册一致；AGENTS.md 保持不变，最多加一条链接说明。

## Risks

- 无可观测风险：只是给公开文档加十行。

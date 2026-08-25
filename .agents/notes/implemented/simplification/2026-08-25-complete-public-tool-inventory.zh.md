# Agent Note: 把 README 的工具清单补全到全部 31 个工具

[English](2026-08-25-complete-public-tool-inventory.md) | 中文

Status: implemented

## Problem

README.md 的“Available tools”列出了 31 个工具里的 21 个——缺 vrf_ensure、asset_inspect、asset_check_refs、vfx_preview、vfx_preview_stop、四个 file_* 工具，以及 dota2_skill（这些都是 src/index.ts 里的生产符号）。两份手工维护的清单镜像着真正的权威（src/index.ts 的注册表）：README（公开、只讲用途）和 AGENTS.md（面向 agent 并带控制台命令）。公开的那份已经腐烂。

## Decision

README.md 的 Available tools 表格现在列出了全部 31 个工具（两种语言的表格都补全了）。AGENTS.md 保留其面向 agent、每个工具带控制台命令的表格——按层级分类法，两份表格服务不同的受众，而本 note 就是记录下来的同步义务。

## Alternatives considered

- **README 链接到 AGENTS.md 而不列出工具。** 否决：README 是公开契约，必须对 npm/GitHub 读者独立成篇。
- **从注册表生成两份表格。** 暂时否决：一个目录生成脚本的投资大于它所修复的漂移；如果出现第三份镜像再重新考虑。

## Consequences

公开契约展示了每一项能力。两份表格仍然为不同的受众手工维护；同步义务记录在这里，让漂移无法无声复发。

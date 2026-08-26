# Agent Note: dota_map_error — tstl 源行静态映射工具

[English](2026-08-05-dota-map-error-tool.md) | 中文

Status: proposed

## Problem

TSTL addon 在游戏内报错时，控制台报的是生成的 `.lua` 文件与行号，而开发者改的是 `.ts`。Dota 2 的 VScript 禁用了 `debug.traceback`，tstl 的运行时 sourcemap 覆盖在 Dota 里失效——但映射数据是编译期静态生成、始终存在于产物里：`__TS__SourceMapTraceBack("<file>.lua", {["42"]=120, ...})`。因此「`.lua:行 → .ts:行`」的纯静态翻译不需要游戏配合，而本 MCP 恰好同时握着两端（29002 的实时控制台流与产物格式认知）。客户端 AI 自己做这条链，需要复制错误文本、猜产物目录、手算映射，每个环节都可能断。

背景（对旧三大件 TODO 的对抗性审查，随已退役的 roadmap spec 继承而来）：通用文件读写与各 AI 客户端的自带能力重复（已发布的 FileOps 保留，因为资产工作流需要限定在 addon 内的编辑）；BuildTools 缩水为热重载一个薄点——构建触发走客户端 bash、tsc/tstl 诊断已经能定位错误；VRF 解析是客户端绝对做不到的独特价值（1.6.0 已以 `asset_inspect` 等工具发布）。审查剩下来的缺口就是错误→源行映射。

## Proposal

新增一个离线 MCP 工具 `dota_map_error`，作为游戏错误流与源文件之间的翻译层：

- **输入**：产物 `.lua` 路径（相对 addon 或绝对路径）+ 行号。
- **输出**：`.ts` 文件 + 行号，可选附带源文件上下文（映射到的 `.ts` 行前后若干行）。
- **门控模型**：不依赖 vconsole/Dota 连接——纯磁盘读取。这是第一个产物类工具，与 vconsole 门控下的 17 个控制台工具本质不同。
- **addon 定位**：优先 daemon 握手信息中的 addon；不可用时允许显式传入或从路径推断。
- **边界**（明确区分三类情况）：产物不存在 → 报「未找到产物，请先构建」并给出 addon 产物路径；tstl 产物但无映射表（未开 sourceMapTraceback）→ 提示开启并给出 tstl 配置片段；非 tstl 项目（无 Generated with TypeScriptToLua 头、无 `__TS__SourceMapTraceBack` 调用）→ 明确报「此工具仅适用于 tstl 项目」。
- **形态**：被动查询工具（形态 A）。对 `console_output` 做后处理自动附加映射（形态 B）留待体验提出需要后再议。

## Alternatives considered

- **先做形态 B（自动注释 console_output）。** 否决：被动查询是最小正确切片；自动附加会改变 console 工具的输出契约，属于后续决策。
- **把映射留给客户端 AI 自己做。** 否决：链条多步且脆弱（复制文本、定位产物、手算映射）；本 MCP 已经握着控制台流与产物知识。

## Acceptance criteria

- 离线测试：fake 产物文件（含映射表 / 无映射表 / 非 tstl / 产物缺失）断言解析与各边界报错。
- 一次活体运行对真实 tstl addon 产物做映射，验证报出的 `.ts` 行正确。
- 工具描述写明与控制台命令的独立性及三类边界；同步进 AGENTS.md 与 README（配对）的工具表。

## Risks

- 映射表格式随 tstl 版本变化；解析器必须按 `__TS__SourceMapTraceBack` 实际产出的形状读取，遇到未知形状显式报错而非猜测。
- 非 tstl 的 Lua 项目会得到显式「不支持」报错——可接受，工具的适用范围已明示。

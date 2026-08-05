# dota2-mcp Roadmap 设计（2026-08-05）

## 背景与定位

- 内部开发规划：面向开发者本人 + AI agent 的施工图，放 `docs/ROADMAP.md`，AGENTS.md 的 TODO 段收敛为一行指针
- 组织方式：版本锚点（每个里程碑绑定版本号，符合 npx + Release 发布节奏）
- 终局：三大件方向经对抗性审查后收缩，2.0 为终局

## 对抗性审查结论（为什么是现在这个方向）

对原 TODO 三大件（FileOps / BuildTools / AssetInspector）逐项对抗审查，结论：

| 原方向 | 裁决 | 理由 |
|--------|------|------|
| FileOps 通用读写 | **砍** | 文件读写是各 AI 客户端自带核心能力，MCP 再造一套是重复 |
| FileOps 的 KV 工具 | 存疑 | KV 语法简单，AI 犯错率低；若做最多只读检视 |
| BuildTools | 缩水 | 构建触发客户端 bash 可做；错误定位被 tsc/tstl 诊断覆盖；只剩热重载联动一个薄点 |
| AssetInspector | 保留（2.0） | VRF 二进制解析是客户端绝对做不到的，独特价值扎实 |
| **错误→源行映射**（新方向） | **采纳（1.6）** | 见下 |

### 源行映射方向的证据链（源码级核查，2026-08-05）

1. tstl 官方文档：`sourceMapTraceback` 机制 = override `debug.traceback` + sourcemap 映射
2. **Dota2 VScript 环境禁用了 `debug.traceback`** → tstl 的运行时自动映射在 Dota2 不生效（用户确认事实）
3. 但 `LuaPrinter.js` 源码确认：映射表数据是**编译期静态生成**并注入产物：
   ```lua
   __TS__SourceMapTraceBack("<file>.lua", {["42"]=120, ...})
   ```
   消费端（debug.traceback 覆盖）在 Dota2 失效，**数据端（映射表）一直在产物里**
4. 因此「游戏内 LUA 错误（.lua:行）→ .ts 源行」的翻译可以**纯静态**完成，不需要游戏环境配合

## 版本总览

| 版本 | 内容 | 状态 |
|------|------|------|
| 1.6 | `dota_map_error` 工具 + 验证待办清账 | 本设计详述，可实施 |
| 1.7 | 留白：候选 = AssetInspector 可行性研究 / 1.6 实战后暴露的新痛点 | 诚实未定 |
| 2.0 | AssetInspector（VRF 解析）+ 文档收尾 = 终局 | 方向确认，细节待研 |

## 1.6 详细设计：dota_map_error

### 定位

「游戏事件流 ↔ 源文件」的翻译层。MCP 同时握着两端：实时控制台流（relay 独占 29000）与产物结构认知（.lua 是生成的、映射表在哪、tstl 格式）。客户端 AI 自己做这条链需要人复制错误文本 + 猜产物目录 + 手算映射，每个环节都可能断。

### 工具契约

- **名称**：`dota_map_error`
- **输入**：产物 `.lua` 路径（相对 addon 或绝对路径）+ 行号
- **输出**：`.ts 文件:行` + 源文件上下文（可选，错误行前后若干行）
- **门控模型**：**不依赖 vconsole/Dota 连接**——纯磁盘读取。与 17 个控制台工具（vconsole 契约门控）的本质区别，是「产物类工具」的第一个
- **addon 定位**：优先用 daemon 握手信息中的 addon；不可用时允许显式传入或从路径推断

### 边界（明确区分三类情况）

1. **产物不存在** → 报「未找到产物，请先构建」（给出 addon 产物路径）
2. **tstl 产物但无映射表**（未开 `sourceMapTraceback`）→ 提示开启并给出 tstl 配置片段
3. **非 tstl 项目**（产物无 tstl 特征：无 `--[[ Generated with TypeScriptToLua ]]` 头、无 `__TS__SourceMapTraceBack` 调用）→ 明确报「此工具仅适用于 tstl 项目」

### 测试

- 离线：fake .lua 产物文件（含/不含映射表、非 tstl 文件、产物缺失）断言解析与报错
- 活体：对真实 tstl 项目（如 tui12）的产物映射一次，验证输出正确

### 实现形态

被动查询工具（形态 A，用户已确认）。后续若体验需要，再叠加 console_output 后处理自动附加映射（形态 B），不在 1.6 范围。

## 文档落点

- `docs/ROADMAP.md`：版本总览 + 每版本目标/范围/验收/依赖/风险，顶部维护「当前进行中」状态行
- `AGENTS.md`：TODO 段收敛为一行指针「开发路线见 `docs/ROADMAP.md`」

## 验证待办归置

- `script_find` / `script_dump_all` 实际输出验证
- `dota_launch_game` 多 addon/map 组合测试

统一归入 1.6 清账（期间顺手验证不阻塞）。

## 未决项

- 1.7 内容留白（诚实标注，不硬凑）
- AssetInspector 的 VRF 解析细节（产物格式、CLI 检测与降级）留待 2.0 前研究
- 源行映射工具的命名与工具描述措辞在实施时定稿

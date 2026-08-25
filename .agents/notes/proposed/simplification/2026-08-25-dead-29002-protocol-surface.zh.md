# Agent Note: 删除已死的遗留 29002 协议面与输出缓冲镜像

[English](2026-08-25-dead-29002-protocol-surface.md) | 中文

Status: proposed

## Problem

守护进程的控制端口（29002）实现了四条没有任何生产客户端发送的遗留文本命令：`STATUS`（vcon-relay.ts:315-323）、`SHUTDOWN`（:326-330）、`FILTERS`（:351-353）、`TAIL`（:348-350）。瘦客户端只发送 HELLO/STREAM/CMD:/SETFILTERS:/SETMCPSUPPRESS（relay-client.ts），而 vconsole2 GUI 在 29001 上使用二进制帧通信——这四个分支仅有的发送者是两个脚本：test-daemon.mjs:152（TAIL:5 往返可观测项）和 verify-phase-apis.mjs:11（TAIL:500 转储）。这些分支拖着四个死缓冲：VConRelay.prntBuffer（:102，在 :578-580 写入，只被 getRecentOutput :217 读取）、VConRelay._prntLog（:103，在 :579 push、在 :580 shift，从未被读取）、RelayClient.prntBuffer（:33，在 :187-188 写入，只被它自己的 getRecentOutput :213 读取，而后者在任何地方都没有调用者，存在只为镜像 VConRelay 接口），以及 index.ts 的本地 prntBuffer（:154/:191/:194，与活的 prntLog 同步 push/shift 但从未被读取——console_output 读取的是 prntLog，:418-431）。

## Proposal

- 从 vcon-relay.ts 删除：STATUS/SHUTDOWN/FILTERS/TAIL 分支、getRecentOutput()、prntBuffer、_prntLog（字段、push、shift），以及这些分支上方过时的“旧协议直通”注释。
- 从 relay-client.ts 删除：getRecentOutput() 和 prntBuffer（字段、prnt-handler 的写入，以及列出接口子集的头部注释）。
- 删除 index.ts 的本地 prntBuffer（:154/:191/:194），保留 prntLog 的长度防护。
- 迁移两个脚本消费方：test-daemon.mjs 把它的 TAIL:5 往返替换为 CMD: echo + STREAM 行断言（该辅助函数已经同时支持两者）；verify-phase-apis.mjs 把转储从 TAIL:500 切换到 STREAM 收集（这已经是它的主要机制）。
- 更新 AGENTS.md：dev-workflow 中关于“relay 的 prntBuffer 只保存 500 行，所以完整转储会冲掉 TAIL 窗口”那一行改为仅 STREAM 的指引。

## Alternatives considered

- **保留 TAIL 作为诊断转储路径。** 否决：verify-phase-apis 已经通过 STREAM 收集；TAIL 的 500 行窗口严格劣于它所守护的流式转储，而且 console_output 读取的是瘦客户端自己的 prntLog，所以没有任何 MCP 工具依赖它。
- **只删除缓冲、保留分支。** 否决：这些分支存在只为服务那些缓冲；STATUS 与 hello-ok 重复（每个瘦客户端都已经收到 hello-ok），FILTERS 没有读者，SHUTDOWN 没有发送者。

## Acceptance criteria

- 在 src/ 中 grep STATUS/SHUTDOWN/TAIL:/FILTERS/getRecentOutput/prntBuffer/_prntLog 没有生产代码命中（脚本已迁移）。
- npm run check 以及 test-relay/test-daemon/test-mcp-offline 全部通过；test-daemon 替换后的可观测项仍然断言同一个往返事实。
- AGENTS.md 不再提及 TAIL 窗口。

## Risks

- 删除 STATUS/FILTERS 会缩小控制协议：一个使用这些未文档化遗留命令的未知外部工具会被破坏。已知会使用 29002 协议的只有 RelayClient 和这两个脚本；hello-ok 已经携带 STATUS 的负载，所以它的诊断价值得以保留。
- _prntLog 的删除是安全的，只要没有东西在守护进程侧重建控制台历史；历史存在于每个瘦客户端的 prntLog 里（通过 PRNT 帧广播），本次改动不触碰它。

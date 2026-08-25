# Agent Note: 删除已死的遗留 29002 协议面与输出缓冲镜像

[English](2026-08-25-dead-29002-protocol-surface.md) | 中文

Status: implemented

## Problem

守护进程的控制端口（29002）实现了四条没有任何生产客户端发送的遗留文本命令：`STATUS`、`SHUTDOWN`、`FILTERS`、`TAIL`（都在 vcon-relay.ts）。瘦客户端只发送 HELLO/STREAM/CMD:/SETFILTERS:/SETMCPSUPPRESS（relay-client.ts），而 vconsole2 GUI 在 29001 上使用二进制帧通信——这四个分支仅有的发送者是两个脚本（test-daemon.mjs 的 TAIL:5 往返、verify-phase-apis.mjs 的 TAIL:500 转储）。这些分支拖着四个死缓冲：VConRelay.prntBuffer（只被 getRecentOutput 读取）、VConRelay._prntLog（从未被读取）、RelayClient.prntBuffer（只被它自己的 getRecentOutput 读取，而后者没有任何调用者，存在只为镜像 VConRelay 接口），以及 index.ts 的本地 prntBuffer（与活的 prntLog 同步 push/shift 但从未被读取——console_output 读取的是 prntLog）。

## Decision

四条遗留命令已经删除：STATUS/SHUTDOWN/FILTERS/TAIL 分支不再存在于 vcon-relay.ts，剩下的控制协议是 HELLO/STREAM/CMD:/SETFILTERS:/SETMCPSUPPRESS。VConRelay.getRecentOutput() 及其 prntBuffer 已删除，_prntLog 已删除（push/shift 位置已移除），RelayClient 的 getRecentOutput()/prntBuffer 已删除（头部注释已更新），index.ts 不再保留本地文本 prntBuffer。消费方在同一改动中迁移：test-daemon.mjs 通过 relay 的 OK 确认断言 CMD 往返（离线时 relay 不会回显 CMD 输出，因为 Dota 没有连接——确认才是可观测的往返事实），verify-phase-apis.mjs 完全通过 STREAM 收集输出，AGENTS.md 把 STREAM 记录为唯一的输出通道（环境变量表、数据流图和开发工作流文字均已更新）。

## Alternatives considered

- **保留 TAIL 作为诊断转储路径。** 否决：verify-phase-apis 已经通过 STREAM 收集；TAIL 的 500 行窗口严格劣于它所守护的流式转储，而且 console_output 读取的是瘦客户端自己的 prntLog，所以没有任何 MCP 工具依赖它。
- **只删除缓冲、保留分支。** 否决：这些分支存在只为服务那些缓冲；STATUS 与 hello-ok 重复（每个瘦客户端都已经收到 hello-ok），FILTERS 没有读者，SHUTDOWN 没有发送者。

## Consequences

控制协议少了四条命令，镜像的 getRecentOutput 接口从 relay 两侧都消失了。STATUS 的负载在 hello-ok 中得以保留，每个瘦客户端在握手时都会收到它。test-daemon 的往返检查现在断言 OK 确认；verify-phase-apis 仍然通过 STREAM 转储完整输出；console_output 的行为不变（它读取瘦客户端的 prntLog）。任何使用这些被删除遗留命令的未知外部工具都会失去它们——仓库内不存在这样的消费方。

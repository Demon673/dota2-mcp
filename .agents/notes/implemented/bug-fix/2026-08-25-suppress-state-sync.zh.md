# Agent Note: 抑制状态单一真源（hello-ok + 广播）

[English](2026-08-25-suppress-state-sync.md) | 中文

Status: implemented

## Problem

RelayClient 在本地维护 `mcpSuppressEnabled`/`guiSuppressPatterns`，是守护进程抑制状态的影子副本。守护进程的 hello-ok 不带抑制字段，`setMcpSuppressEnabled`/`setGuiSuppressPatterns` 改的是守护进程，却不通知其他瘦客户端。守护进程重启（恢复默认）后，客户端本地旗标对的是一个已重置的守护进程，`console_gui_filter` 报的是过时的客户端视图；其他客户端的视图也在任一客户端改动设置的那一刻过时。

## Decision

守护进程是唯一真源：hello-ok 现在携带 `mcpSuppress` 与 `guiPatterns`，RelayClient 每次握手都采纳它们。`setMcpSuppressEnabled`/`setGuiSuppressPatterns` 向所有已订阅 STREAM 的瘦客户端广播 `{type:"suppress", mcpSuppress, guiPatterns}`，RelayClient 收到即更新本地值。`console_gui_filter` 因此始终读到守护进程的真值。客户端选定的设置在守护进程重启后回到默认——默认即安全的隐藏输出状态，与门控模型一致。

## Alternatives considered

- **重连时重放 SETFILTERS/SETMCPSUPPRESS。** 否决：每个客户端重放自己的本地状态，会让一个重连的客户端覆盖另一个客户端的现行设置；从守护进程采纳则只有一个所有者。
- **保留客户端影子但不做同步。** 否决：那正是失同步 bug。

## Consequences

hello-ok 增加两个字段，广播消息新增一种类型（`suppress`），与 `status`/`prnt`/`adon`/`chan` 并列。多客户端视图保持一致，重连路径无需重放 SETFILTERS/SETMCPSUPPRESS（hello-ok 即重新同步）。test-daemon.mjs 新增 4b 场景，断言 hello-ok 初始字段与 SETMCPSUPPRESS 的对端广播。

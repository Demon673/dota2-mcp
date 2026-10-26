# Agent Note: MCP 控制台输出与人类 GUI 的隔离

[English](2026-10-26-console-output-isolation.md) | 中文

Status: implemented

## 问题

relay 的 `ai_disabled; <cmd>; ai_disabled` 包装原本假设 Dota 会在命令两侧回显 `ai_disabled = false/true`。用替身 GUI 做实机抓包后发现：引擎对裸 cvar 什么都不打印，屏蔽从未真正开启，于是 `status_json`、`script_help2`、实体 dump 和 `echo` 的输出都进了 vconsole2 窗口。同一次抓包还显示，每次 VCon 客户端连接时引擎都会回放自己的控制台积压，所以新接入的 GUI 还会收到本会话早些时候的全部 dump。人类的控制台必须不出现 MCP 输出，同时仍要显示他们自己的命令和引擎消息。

## 决定

输出收集用的 echo 标记就是屏蔽边界：每条收集命令都以 `echo __mcp_<hash>_begin;` 开头，结束标记是 `__mcp_<hash>_end`。relay 维护一个**按标记 id 索引的开放窗口集合**：begin 加入自己的 id，只有匹配的 end 才移除，集合非空时 GUI 过滤生效。同步命令会回显结束标记；Lua 路径把窗口保持到同步部分之后：`RunScriptCode` 晚一帧执行，所以 Lua 体在代码跑完后才打印结束标记（`xpcall` 在运行时报错时也会打印）。因此并发会话无法关掉彼此的窗口。等不到结束标记的窗口在 15 秒（`markerWindowMs`）后过期。裸 `ai_disabled` 包装和 Lua 打印的 `ai_disabled =` 开关都已移除。异步 MCP 前缀过滤和直接命令的定时静默窗口保持不变。

每次连接 Dota 时 relay 丢弃第一波 PRNT：只要 PRNT 间隔小于 120 ms 就继续丢，第一个静默间隔结束排空，最多 2.5 秒。初始化帧不受影响，MCP 缓冲仍会收到积压内容。

## 备选方案

**继续依赖 cvar 回显。** 否决：发行版引擎对裸 cvar 不打印任何内容，这条边界在实际环境里从未存在。

**连接后丢弃所有 PRNT，直到第一条命令。** 否决：它也会隐藏第一次工具调用之前到达的真实引擎输出（错误、addon 打印）。

**连接时清空引擎控制台缓冲。** 否决：需要发送人类没有要求的变更命令，还会毁掉他们可能想看的记录。

**按内容过滤回放的积压。** 否决：dump 和 echo 输出都是没有标记的普通文本，没有内容规则能把它们与实时引擎输出分开。

## 后果

实机抓包证明了结果：人类自己的 `echo` 行会被转发，而 status、console、Lua、bridge、API 和实体 dump 的探针以及回放的积压都不进 GUI。多会话交错已有离线覆盖：两个会话的窗口嵌套，结束标记只关闭自己的窗口。每次接入 Dota 时人类的控制台从空历史开始；引擎自己的控制台缓冲仍会记录一切，`console_gui_filter auto:false` 仍会为了调试暴露 MCP 行。连接后立刻发出的命令可能要等引擎回放完缓冲（一次实机 status 调用了 6.5 秒），但不会丢失。只要有窗口打开，这段区间里引擎的非 MCP 输出也会一起被隐藏；除长 Lua 调用外窗口都很短。

## 测试

`scripts/test-relay.mjs` 覆盖 echo 标记窗口、多会话交错（结束标记只关闭自己的窗口）、未闭合窗口过期、异步前缀过滤、定时静默窗口和 `SHUTDOWN`。实机替身 GUI 抓包是端到端检查：用真引擎加接在 29001 的替身 GUI，status、API dump、实体 dump、Lua、`console_send`、launch、restart、Panorama 桥、VFX 预览和测试运行器的输出都没有进入 GUI，而电池前后裸命令（vconsole2 路径）的人类 echo 都在场，且替身 GUI 拆除后 Dota 存活。

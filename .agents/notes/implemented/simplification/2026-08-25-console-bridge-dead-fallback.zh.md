# Agent Note: 删除 console-bridge 已死的 console.log 回退路径及其孤立的依赖

[English](2026-08-25-console-bridge-dead-fallback.md) | 中文

Status: implemented

## Problem

console-bridge.ts 仍然带着整套“把命令写入 cfg 文件 + 跟踪 game/dota/console.log”的回退路径：getConsoleLogPath、tailConsoleLog、grepConsoleLog、readErrors、parseLogLine、ConsoleLogEntry、LOG_LINE_RE、ERROR_PATTERNS。零消费方：dota_status 使用 queryStatusJson（status_json），console_output 读取 relay 的 prntLog；没有任何脚本或测试导入它们中的任何一个。两个死导出跟着一起：getDotaExeName（被 resolveDotaToolPath 取代，后者内联了 .exe 逻辑）和 getDotaBinDir（没有外部导入者）。chokidar 依赖的存在只为服务那个被删除的 tail 监听器。

## Decision

console-bridge.ts 不含 cfg 文件/console.log 回退路径：文件的职责是 Dota 2 路径/进程/工具路径检测、WSL 映射与 vconsole2 启动。getDotaExeName 已删除，getDotaBinDir 为私有。chokidar 不在 package.json 的 dependencies 中。AGENTS.md 的 console-bridge 那一行与之一致，References 的“console.log path”那一行已不存在。

## Alternatives considered

- **保留回退路径作为无守护进程时的安全网。** 否决：自从 relay 路径成为唯一的控制台通道，它就没有调用者了；复活它需要产品层面的理由，而不是死代码式的保留。
- **为将来的文件监听工具保留 chokidar。** 否决：当消费方出现时重新加依赖很便宜；一个未使用的依赖是每次安装的重量和供应链攻击面。

## Consequences

每次 npm install 都少装一个未使用的依赖。console.log 不出现在仓库任何路径中；控制台历史只能通过 console_output（relay prntLog）获取。

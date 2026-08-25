# Agent Note: 删除 console-bridge 已死的 console.log 回退路径及其孤立的依赖

[English](2026-08-25-console-bridge-dead-fallback.md) | 中文

Status: proposed

## Problem

console-bridge.ts 仍然带着整套“把命令写入 cfg 文件 + 跟踪 game/dota/console.log”的回退路径：getConsoleLogPath（:72）、tailConsoleLog（:77-90）、grepConsoleLog（:92-105）、readErrors（:116-122）、parseLogLine（:125）、ConsoleLogEntry、LOG_LINE_RE、ERROR_PATTERNS（:30-71）。零消费方：dota_status 使用 queryStatusJson（status_json），console_output 读取 relay 的 prntLog；没有任何脚本或测试导入它们中的任何一个。文件头（:1-12）仍然在叙述这个已死的前提。两个死导出跟着一起：getDotaExeName（:276-279，被 resolveDotaToolPath 取代，后者内联了 .exe 逻辑）和 getDotaBinDir（:261-272，回退路径移除后就没有外部导入者）。chokidar 依赖（package.json:45）的存在只为服务那个被删除的 tail 监听器——src/ 或 scripts/ 里已经没有任何导入残留。

## Proposal

- 删除 console-bridge.ts 第 30-125 行（日志跟踪那一簇代码）；重写文件头以描述这个文件当下的角色（Dota 2 路径/进程/工具路径检测）；删除 getDotaExeName；去掉 getDotaBinDir 的 export。
- 从 package.json 的 dependencies 移除 chokidar，并重新生成 package-lock.json（npm install）。
- 在同一改动里更新 AGENTS.md：console-bridge.ts 的 Core-modules 那一行（“把命令写入 cfg 文件 + 跟踪 game/dota/console.log 作为回退路径”）以及 References 的“console.log path”那一行。

## Alternatives considered

- **保留回退路径作为无守护进程时的安全网。** 否决：自从 relay 路径成为唯一的控制台通道，它就没有调用者了；复活它需要产品层面的理由，而不是死代码式的保留。
- **为将来的文件监听工具保留 chokidar。** 否决：当消费方出现时重新加依赖很便宜；一个未使用的依赖是每次安装的重量和供应链攻击面。

## Acceptance criteria

- 在 src/ 和 scripts/ 中 grep tailConsoleLog/grepConsoleLog/readErrors/getConsoleLogPath/getDotaExeName 返回零命中。
- package.json 没有 chokidar；package-lock.json 已重新生成；npm install 干净；npm run check 通过。
- AGENTS.md 的相关行在同一 commit 里更新。

## Risks

- 任何针对旧 console.log 回退路径的外部脚本都会失去它——仓库里不存在这样的消费方，而且 relay 的 prntLog 路径严格更丰富。

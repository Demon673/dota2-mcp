# 防御性模式

[English](defensive-patterns.md) | 中文

血泪换来的 bug-class 规则：每条模式都是本仓 relay/daemon 里真实或几乎真实发生过的缺陷类别，表述为阻止其复发的规则。写生命周期、并发、子进程或 teardown 代码前先读 —— relay 的重连、活性探测、空闲退出与 daemon spawn 都在范围内。测试层对应物（离线先行、验证世界而非自述）在根 [AGENTS.md](../AGENTS.md) 的开发-验证工作流里。

## 正交结果独立上报

一个结果可以同时是几件事 —— 一个被 spawn 的进程可以既超时又退出码为 0，因为它捕获了信号。把每个独立事实（`timedOut`、`signal`、`exitCode`）各自上浮；绝不在一个标志的分支里嵌套另一个标志的上报，否则调用方会把一次被截断的运行读成干净成功。daemon spawn 的等待与 `dota_open_vconsole` 的 ≤10s 等待都面对这一点。

## 进入公共 API 前归一化

当一个实现收到同一结果的多种表示时，在返回前归一化。relay 从一处推导 `dotaConnected` —— `connected`/`close`/`error` 都设置同一个布尔量，每个瘦客户端读那一个布尔量，绝不读 socket 的本地状态。这让调用方不用猜一个 false 到底来自 Dota、一次重连，还是自己的拼装。

## 异步状态不是同步状态

`guiConnected`/`dotaConnected` 是广播快照，不是逐命令结果。一个重连计时器、一个活性探针、一个空闲退出倒计时共享同一条连接的生命周期；绝不把「Dota 已连接」当作某一次命令的结果。拥有某个转换的调用方必须等待那个具体转换，并显式处理「没什么可等」的分支，否则等待会挂起。

## Dispose 必须到达静默，而不只是请求它

一个发出 kill/close 但没等工作停止就返回的 teardown 会留下孤儿。`VConRelay.close()` 清除活性探测 interval、AINF 计时器与重连计时器，然后关 socket；让清理 await 子进程退出（kill → await `done`），并在 kill 之前先关闭监听注册，让迟到的完成保持静默。

## 在 dispatcher 里兜住回调异常

一个瘦客户端 socket 处理器抛异常，绝不能 reject 它所在的广播循环或饿死其后的客户端。用 try/catch 包住派发循环并记录；一个坏订阅者绝不破坏 relay 的核心生命周期。

## 绝不给不可信输出环境变量或可预测路径

被 spawn 的进程拿到清洗过的 env（去掉 `*KEY*`/`*SECRET*`/`*TOKEN*`/`*PASSWORD*`），让凭据无法泄漏进输出或 spill 文件。状态/token 文件用私有（0700）目录与仅属主打开 —— `relay.token` 以 0600 写在 `os.tmpdir()/dota2-mcp/` 下；可预测的世界可读路径会招致泄漏。

## 删除链接状路径

一个可能是符号链接或 Windows junction 的路径，用 `lstatSync().isSymbolicLink()` 再 `unlinkSync` 删除：unlink 只删链接、拒绝真实目录，因此绝不顺着链接进入目标。Windows 对 junction 的 `rmSync(link)` 抛 `ERR_FS_EISDIR`；递归删除可能穿过一个进入其目标。递归 `rmSync` 只留给已知的真实目录。daemon 的 lock/token 清理用到这一点。

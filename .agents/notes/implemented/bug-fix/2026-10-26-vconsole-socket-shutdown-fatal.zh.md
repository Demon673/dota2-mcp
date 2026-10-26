# Agent Note: VConsole socket 关闭致命错误（10038）

[English](2026-10-26-vconsole-socket-shutdown-fatal.md) | 中文

Status: implemented

## 问题

在 Dota 已接入并持续输出控制台内容时，用 `Stop-Process -Force` 停掉 relay 守护进程，会让 Dota 2 弹出 `FATAL ERROR: Cannot recover from failed socket shutdown. (error 10038)`，并停止在 `:29000` 上接受 VConsole 客户端。重启守护进程是日常开发的一部分，我们这一侧的突然断开不能把引擎的控制台服务带崩。

## 决定

relay 拆除连接时先等 Dota 输出出现 300 ms 静默（最多等 1 秒），再半关闭 TCP（发 FIN），继续读到对端关闭，只有在 1.2 秒兜底超时后才销毁 socket。守护进程在关闭后等待 2.5 秒再退出，给静默等待和排空留出时间。控制口在 `HELLO` token 之后接受 `SHUTDOWN`，瘦客户端暴露 `shutdownDaemon()`；开发和测试流程用它重启守护进程，而不是强杀进程。强制终止仍会在有未读数据时关闭 socket，可能触发引擎竞态，因此在 Dota 接入期间不安全。

## 引擎机制

`vconcomm.dll` 被链进 Dota 的 `server.dll` 和 `vconsole2.exe`；它拆除 VConsole 连接时调用 `shutdown(SD_BOTH)` 再调用 `closesocket`。错误检查把 `WSAECONNRESET`、`WSAENOTCONN`、`WSAESHUTDOWN` 视为正常，其余错误一律走 `Plat_FatalError`；`WSAENOTSOCK`（10038）就是致命项。recv 和 send 包装函数在出错时都会调用同一个按连接关闭函数，两者都可能先通过 `-1` 守卫再各自关闭，于是第二次 `shutdown` 落在已关闭的句柄上。关闭时若接收缓冲仍有未读数据，Windows 会发 RST 而不发 FIN，使引擎的 recv 与 send 线程同时失败，打开这个竞态窗口；发 FIN 并继续排空则让对端的读侧看到 EOF，同时其发送侧仍然可用。

这些位置是发行二进制里的 Ghidra 标号（无符号）：recv 包装 `FUN_18000e8a0`、send 包装 `FUN_18000ebf0`、按连接关闭 `FUN_18000e980`、socket 集合拆除 `FUN_18000e110`。

## 备选方案

**在 `end()` 后立即销毁（原先 250 ms 的兜底）。** 否决：带未读数据销毁 socket 正是 RST 的来源，每次拆除都会保留可触发的引擎竞态。

**让进程退出时关闭 Dota socket。** 否决：进程退出的关闭语义同样会丢弃未读数据，而且守护进程必须释放 `:29000` 才能让后继进程接入。

**要求 Dota 运行期间守护进程永不关闭。** 否决：重启守护进程是开发和崩溃恢复测试的一部分，优雅路径本身必须安全。

**在关闭期间延迟或抑制引擎控制台输出。** 否决：它只改变人看到的内容，不改变 socket 关闭方式，无法解决致命错误。

## 后果

已在加载了地图的实机验证优雅停机：Dota 保持监听 `:29000`，窗口状态正常，新守护进程能重新接入，控制台往返成功。强杀仍然不安全，仍可能触发引擎竞态；主动强杀守护进程的测试流程要接受这一风险。停机现在会多花约 2.5 秒。`SHUTDOWN` 与其他控制命令使用同一 token 认证，正常退出码为 0。

## 测试

离线 `scripts/test-relay.mjs` 覆盖 `SHUTDOWN` 触发 `shutdown-requested` 以及定时 GUI 抑制窗口；完整离线套件保持全绿。实机覆盖：加载游戏时优雅停机、重启后重新接入、控制台 echo 往返、Panorama bridge 套件。

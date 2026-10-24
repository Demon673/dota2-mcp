# Agent Note: 离线测试中的守护进程状态隔离

[English](2026-10-24-daemon-test-state-isolation.md) | 中文

Status: implemented

## Problem

离线 MCP 与守护进程测试随机化了各自的 TCP 端口，却共用生产环境的守护进程状态目录。`test-daemon.mjs` 删除并重建了真实的 `relay.token`、`relay.pid` 和 `relay.lock`；其他测试在启动守护进程时覆盖了 pid 文件。因此，与活体守护进程并存运行离线套件，会导致 `bad token` 握手失败，并让 lifecycle 操作指向错误的进程。

测试还只杀掉自己的 MCP 子进程，而不杀掉它启动的守护进程。由于运行中的 Dota 进程会抑制守护进程的空闲退出，反复的离线运行会累积脱离的 relay 进程。

## Decision

- `DOTA2_VCON_STATE_DIR` 覆盖守护进程 token、pid、lock 与日志文件，以及截图 watcher 的锁、来源和请求文件所用的目录。默认值仍是 `os.tmpdir()/dota2-mcp`，并保留既有的主目录回退。覆盖路径会被解析为绝对路径，使启动的守护进程看到与父进程相同的位置。
- 每个启动 MCP 服务器的离线脚本都使用自己的临时状态目录。`test-daemon.mjs` 跟踪它启动的所有子进程，并在每次退出时把它们连同 pid 文件中记录的进程一并杀掉。
- `spawnMcpServer` 接受 `cleanupDaemon: true`，该选项要求使用隔离的状态目录。其清理逻辑会杀掉 MCP 子进程和该目录中记录的守护进程或截图 watcher，并且在断言导致进程退出时同样执行。活体脚本不会启用它。
- 正常退出的测试会删除各自的临时目录。守护进程重新启动测试会等待 45 s 让初始端口就绪，与既有的慢启动容忍度一致；启动失败信息会附带 MCP stderr 与 relay 日志。`lib-test-ports.mjs` 会在测试开始前短暂监听申请端口段中的每个端口，因此 relay、daemon、控制台、截图、文件、资产和 MCP 冒烟测试都不再只依赖随机选段。

## Alternatives considered

- **仅随机化端口。** 否决：它们不能隔离 token、pid、lock 或日志文件。
- **在每个测试前后备份并恢复生产状态。** 否决：并发的 MCP 会话可能在测试期间改动它，恢复操作可能覆盖较新守护进程的状态，而一次失败就可能让活体配置受损。
- **按映像名称杀掉遗留的 `node` 或 `relay-main` 进程。** 否决：这可能会杀掉无关的用户会话。清理只使用测试自身子进程列表和隔离状态目录中的 pid。

## Consequences

离线套件可以在 Dota、vconsole 和生产守护进程保持活跃的同时运行，既不改变它们的认证或 lifecycle 状态，也不会留下测试守护进程。除非设置新的覆盖项，生产行为保持不变。启用 `cleanupDaemon` 的调用方必须使用唯一的状态目录；共用目录会让一个测试杀掉另一个测试的守护进程。失败的测试可能留下用于诊断的临时文件，但不会留下运行中的进程。

## Testing

在 Dota、vconsole 和活体守护进程运行的情况下，完整的离线发布套件通过了。套件运行前后对活体 `relay.token`、`relay.pid` 和 `relay.lock` 的 SHA-256 比较结果完全一致，之后查询进程时只找到原本的活体守护进程和截图 watcher。随后的 MCP 调用仍能完成握手并执行 Lua。加入端口段检查后，守护进程测试又连续通过了两次。两个在 Windows 上跳过的 VRF 脚本保留其既有的仅 POSIX 覆盖。

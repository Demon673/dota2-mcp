# Agent Note: livePid——接入启动流程还是删除它

[English](2026-08-25-livepid-wire-or-remove.md) | 中文

Status: proposed

## Problem

daemon-utils.livePid()（:56-76）——陈旧 PID/锁清理（kill(pid,0) 活性探针 + 删除前比对防御）——没有任何生产调用者。它仅有的消费方是 scripts/test-daemon.mjs（:93/:403/:426，读取 relay.pid 以杀掉守护进程）和 CHANGELOG 历史。因为它没有接入，一个崩溃（非空闲退出）的守护进程会留下 relay.lock + relay.pid，acquireLock() 永远 EEXIST，下一个会话静默降级到本地 relay——也就是 AGENTS.md Known issues 里“清空 os.tmpdir()/dota2-mcp/ 状态文件”的手动变通方案。

## Proposal

决策分叉，二选一：

- **A（纯简化）**：删除 livePid()；在 test-daemon.mjs 需要 pid 的地方内联一个普通的 readFileSync(pidPath)；保留 Known issues 的变通方案作为恢复路径。
- **B（修 bug）**：在 createRelay 中、acquireLock() 之前调用 livePid()（index.ts ~:82），这样死守护进程遗留的陈旧锁/pid 能自愈；然后从 AGENTS.md Known issues 删除手动变通那句话，测试用法保持不变。

推荐 B：它用已经测试过的辅助函数去掉了用户可见接口（手动恢复步骤），并关闭了这个辅助函数本要解决的故障模式。

## Alternatives considered

- **A（删除）。** 纯粹的接口移除；因为变通方案已经存在，今天不花任何成本，但让陈旧锁故障模式永久保留。
- **B（接入）。** 增加一个微小的启动检查。风险：pid 复用——一个指向无关存活进程的陈旧 pid 文件会阻塞启动（与今天相同的故障），而删除前比对防御已经限制了这一点。

## Acceptance criteria

- 选定的分支落地：要么删除 livePid（A），test-daemon 直接读取 relay.pid；要么 createRelay 自愈陈旧锁（B），并删除 AGENTS.md 的手动清理那句话。
- 两种情况下 test-daemon.mjs 都仍然通过；A 不改变行为，B 给 test-daemon 增加陈旧锁恢复场景。

## Risks

- B 改变启动行为（锁自恢复）。活性探针绝不能删除一个存活守护进程的状态——livePid 的 kill(pid,0) 已经守护这一点；Known issues 里“守护进程存活时不要删除 relay.token”的警告必须保留在周围的注释里。

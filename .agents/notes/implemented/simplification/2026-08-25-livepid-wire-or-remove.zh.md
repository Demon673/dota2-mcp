# Agent Note: livePid——接入启动流程还是删除它

[English](2026-08-25-livepid-wire-or-remove.md) | 中文

Status: implemented

## Problem

daemon-utils.livePid()——陈旧 PID/锁清理（kill(pid,0) 活性探针 + 删除前比对防御）——没有任何生产调用者。它仅有的消费方是 scripts/test-daemon.mjs（读取 relay.pid 以杀掉守护进程）和 CHANGELOG 历史。因为它没有接入，一个崩溃（非空闲退出）的守护进程会留下 relay.lock + relay.pid，acquireLock() 永远 EEXIST，下一个会话静默降级到本地 relay——也就是 AGENTS.md Known issues 里“清空 os.tmpdir()/dota2-mcp/ 状态文件”的手动变通方案。

## Decision

落地的是分支 B：createRelay() 在 acquireLock() 之前调用 livePid()，这样崩溃守护进程遗留的陈旧 relay.pid/relay.lock 会在下一个会话启动时自愈。手动清理步骤已从 AGENTS.md Known issues 中删除（“杀掉残留进程”的指引保留）。test-daemon.mjs 增加了一个离线场景，断言 livePid() 对已死 PID 返回 null 并清理两个陈旧文件。

## Alternatives considered

- **A（删除）。** 纯粹的接口移除；因为变通方案已经存在，今天不花任何成本，但让陈旧锁故障模式永久保留。
- **B（接入）。** 增加一个微小的启动检查。风险：pid 复用——一个指向无关存活进程的陈旧 pid 文件会阻塞启动（与今天相同的故障），而删除前比对防御已经限制了这一点。

## Consequences

启动现在会通过删除陈旧文件来改动状态目录。kill(pid,0) 探针和删除前比对守卫会防止触及存活守护进程的状态，而 Known issues 里“守护进程存活时不要删除 relay.token”的警告得以保留。陈旧锁故障模式不再需要人工干预。

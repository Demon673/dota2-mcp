# Defensive patterns

English | [中文](defensive-patterns.zh.md)

Hard-won bug-class rules: each pattern is a class of defect that shipped or nearly shipped in this repo's relay/daemon, stated as the rule that prevents its recurrence. Read this before writing lifecycle, concurrency, subprocess, or teardown code — the relay's reconnect, liveness probe, idle exit, and daemon spawn are all in scope. Test-tier counterparts (offline-first, verify the world not the self-report) are in the development-verification workflow of root [AGENTS.md](../AGENTS.md).

## Report orthogonal outcomes independently

A result can be several things at once — a spawned process can time out AND exit 0 because it trapped the signal. Surface each independent fact (`timedOut`, `signal`, `exitCode`) on its own; never nest one flag's report inside another's branch, or a caller reads a cut-short run as clean success. The daemon spawn wait and `dota_open_vconsole`'s ≤10s wait both face this.

## Normalize before the public API

When an implementation receives several representations of one outcome, normalize them before returning. The relay derives `dotaConnected` from one place — `connected`/`close`/`error` all set the same boolean, and every thin client reads that one boolean, never a socket's local state. This keeps callers from guessing whether a false came from Dota, a reconnect, or their own assembly.

## Async state is not synchronous state

`guiConnected`/`dotaConnected` are broadcast snapshots, not per-command results. A reconnect timer, a liveness probe, and an idle-exit countdown share one connection's lifecycle; never treat "Dota is connected" as the result of one command. A caller that owns a transition must await that specific transition and handle the "nothing to wait for" branch explicitly, or the wait hangs.

## Dispose must reach quiescence, not just request it

A teardown that issues kills/closes but returns before the work stops leaves orphans. `VConRelay.close()` clears the liveness interval, the AINF timer, and the reconnect timer, then closes sockets; make cleanup await children's exit (kill → await `done`), and close listener registries BEFORE killing so late completions stay silent.

## Contain callback exceptions in the dispatcher

A thin client's socket handler that throws must not reject the broadcast loop or starve the clients after it. Wrap the dispatch loop in try/catch and log; one bad subscriber never breaks the relay's core lifecycle.

## Never hand untrusted output the ambient environment or predictable paths

Spawned processes get a scrubbed env (drop `*KEY*`/`*SECRET*`/`*TOKEN*`/`*PASSWORD*`) so credentials cannot leak into output or state files. State/token files use a private (0700) dir and owner-only opens — `relay.token` is 0600 under `os.tmpdir()/dota2-mcp/`; predictable world-readable paths invite disclosure.

## Unlink link-shaped paths

A path that may be a symlink or Windows junction is removed with `lstatSync().isSymbolicLink()` then `unlinkSync`: unlink deletes only the link and refuses a real directory, so it never follows the link into its target. Windows `rmSync(link)` throws `ERR_FS_EISDIR` on a junction; recursive deletion may descend through one. Reserve recursive `rmSync` for known real directories. The daemon's lock/token cleanup uses this.

# Agent Note: 去掉配对门禁的 git 对象快照持久化

[English](2026-08-25-pairing-blob-snapshot.md) | 中文

Status: implemented

## Problem

scripts/lib/git.mjs 的 storeGitBlob 持久化 blob 对象（git hash-object -w）并创建 refs/dota2-mcp/translation-pairing/snapshots/<hash> 引用，而没有任何东西读回它们。配对契约（docs/i18n/README.md）只记录 blob hash——“对未提交文件可计算”、“纯内容比较”——而 --write 使用 storeGitBlob 仅仅是为了拿到纯 JS 的 gitBlobHash 计算出的同一个 40 位十六进制哈希。这种持久化还会泄漏悬空引用，这些引用会被推送到远端。

## Decision

scripts/lib/git.mjs 现在只包含 gitBlobHash；runGit、storeGitBlob、SNAPSHOT_REF_PREFIX、GIT_COMMAND_MAX_BUFFER 以及 spawnSync 导入已删除。verify-translation-pairing.mjs 用 gitBlobHash 计算两侧哈希——不再写入任何 git 对象，也不再在 refs/dota2-mcp 下创建任何引用。

## Alternatives considered

- **把快照保留为恢复存储。** 否决：没有任何东西从它们恢复（不存在 cat-file 读取器），i18n.yaml 记录已经保存了检测漂移所需的哈希，而 git 本身就保留已提交的字节。

## Consequences

.i18n.yaml 记录字节级一致（同样的 blob hash）；唯一被移除的行为是写入未被引用的 git 对象/引用。

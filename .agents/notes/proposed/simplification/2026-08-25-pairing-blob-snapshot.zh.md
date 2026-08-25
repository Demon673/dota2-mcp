# Agent Note: 去掉配对门禁的 git 对象快照持久化

[English](2026-08-25-pairing-blob-snapshot.md) | 中文

Status: proposed

## Problem

scripts/lib/git.mjs 的 storeGitBlob（:44-58）持久化 blob 对象（git hash-object -w）并创建 refs/dota2-mcp/translation-pairing/snapshots/<hash> 引用，而没有任何东西读回它们（grep：零读者）。配对契约（docs/i18n/README.md:11-27）只记录 blob hash——“对未提交文件可计算”、“纯内容比较”——而 --write（verify-translation-pairing.mjs:196-197）使用 storeGitBlob 仅仅是为了拿到纯 JS 的 gitBlobHash（:10-15）计算出的同一个 40 位十六进制哈希。这种持久化还会泄漏悬空引用，这些引用会被推送到远端。

## Proposal

- 在 verify-translation-pairing.mjs:196-197 把两处 storeGitBlob 调用替换为 gitBlobHash。
- 从 git.mjs 删除 runGit、storeGitBlob、SNAPSHOT_REF_PREFIX、GIT_COMMAND_MAX_BUFFER，以及 spawnSync 导入（约 30 行）。

## Alternatives considered

- **把快照保留为恢复存储。** 否决：没有任何东西从它们恢复（不存在 cat-file 读取器），i18n.yaml 记录已经保存了检测漂移所需的哈希，而 git 本身就保留已提交的字节。

## Acceptance criteria

- verify-pairs --write 重新记录的哈希与之前一致；--check 仍然校验所有配对。
- git.mjs 只包含 gitBlobHash；refs/dota2-mcp 下不再出现新引用。

## Risks

- 无可观测风险：yaml 记录内容不变（同样的哈希）；消失的只是写 git 对象/引用的副作用。

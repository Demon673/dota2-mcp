# Agent Note: 离线冒烟套件进入发布工作流

[English](2026-09-20-offline-smoke-in-release-workflow.md) | 中文

Status: implemented

## Problem

`.github/workflows/release.yml` 是本仓唯一的工作流。它在 `release: created`（或手动触发）时构建、打包、上传。它不跑任何冒烟脚本，而 push 时没有任何工作流运行，所以离线套件只有一条执行路径：人手动跑。本次改动集早些时候修掉的 Windows fixture 断裂，正是因此一直没被发现。

## Decision

发布工作流在 Build 与 Package 之间新增 `Offline smoke tests` 步骤，运行那八个离线脚本。它们逐个点名，而不用 `test-*.mjs` 通配：另有七个脚本是 live 的（需要 Dota 2 与 vconsole 窗口），通配会让每一次发布都变红。这些脚本从 `dist/` 导入，所以该步骤排在 Build 之后。在 ubuntu 与 macos 两条矩阵腿上，`test-asset-inspect` 与 `test-asset-check-refs` 会真正执行；在 windows 上它们打印 SKIP。

live 与 drill 脚本仍然手动跑。pre-commit 保持快速且本地——这是一道额外的门，不是替代（见[文档门禁笔记](2026-08-29-root-docs-pairing-and-doc-gates.md)，它否决的 "CI-only gates" 备选在此并未被推翻）。

## Alternatives considered

- **push 或 pull request 触发的工作流。** 暂予否决：套件在开发机上约 70 秒（test-daemon 32 s、test-fileops 13 s、test-mcp-offline 13 s、test-relay 10 s），而发布这道门已经在坏产物发出之前变红。若仓库出现外部贡献者，再议。
- **用 `test-*.mjs` 通配代替八个显式名字。** 否决：它会把 live 脚本一起捞进来，导致每次运行都失败。
- **用 CI 取代本地 pre-commit 检查点。** 文档门禁落地时就否决过，现在仍然否决：本地检查点在编辑后几秒内失败，CI 在几分钟后。

## Consequences

坏掉的离线测试现在拦住发布，而不是无声通过。live 覆盖不变——CI 不碰 Dota 2。套件给每条矩阵腿增加约一分钟。

## Testing

该步骤就是八次 `node` 调用，脚本自带断言；在 Windows 检出上是 6 PASS / 2 SKIP / 0 FAIL，在 ubuntu/macos 上那两个跳过的脚本会执行。工作流只在发布创建或手动触发时运行，所以下一次发布是它的第一次真实检验。

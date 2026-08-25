# Issue tracker: GitHub

[English](issue-tracker.md) | 中文

本仓库的 Issues 和 PRD 以 GitHub issues 承载。所有操作用 `gh` CLI。

## 约定

- **创建 issue**：`gh issue create --title "..." --body "..."`。多行 body 用 heredoc。
- **读 issue**：`gh issue view <number> --comments`，用 `jq` 过滤 comment，同时取 labels。
- **列 issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，配 `--label` 和 `--state` 过滤。
- **评论 issue**：`gh issue comment <number> --body "..."`
- **打 / 去 label**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**：`gh issue close <number> --comment "..."`

在 clone 内用 `git remote -v` 推断仓库 —— `gh` 会自动做。

## PR 作为 triage 入口

**PR 作为请求入口：否。**（若本仓库把外部 PR 当作功能请求处理，设为 `yes`；`/triage` 会读这个 flag。）

设为 `yes` 时，PR 走与 issue 相同的 label 与状态流转，用 `gh pr` 对等命令：

- **读 PR**：`gh pr view <number> --comments`，看 diff 用 `gh pr diff <number>`。
- **列外部 PR 供 triage**：`gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，只留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE` 的（剔除 `OWNER`/`MEMBER`/`COLLABORATOR`）。
- **评论 / 打 label / 关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 与 PR 共享同一编号空间，裸 `#42` 可能指两者之一：先用 `gh pr view 42` 解析，失败再回退 `gh issue view 42`。

## 当 skill 说 "publish to the issue tracker"

创建一个 GitHub issue。

## 当 skill 说 "fetch the relevant ticket"

运行 `gh issue view <number> --comments`。

## Wayfinding 操作

由 `/wayfinder` 使用。**map** 是一个 issue，**child** issue 是票。

- **Map**：单个 issue，label `wayfinder:map`，body 承载 Notes / Decisions-so-far / Fog。`gh issue create --label wayfinder:map`。
- **Child ticket**：作为 GitHub sub-issue 关联到 map 的 issue（sub-issues 端点走 `gh api`）。sub-issues 不可用时，在 map body 的任务列表里加 child，并在 child body 顶部写 `Part of #<map>`。Label：`wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。被认领后指派给开发负责人。
- **Blocking**：用 GitHub 原生 issue dependencies（权威、UI 可见的表达）。加边：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是 blocker 的数字 **database id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，_不是_ `#number` 或 `node_id`）。GitHub 报告 `issue_dependencies_summary.blocked_by`（只含未关闭 blocker，实时门禁）。dependencies 不可用时，回退为 child body 顶部的 `Blocked by: #<n>, #<n>` 行。所有 blocker 关闭后票才解除阻塞。
- **Frontier query**：列出 map 的未关闭 children（`gh issue list --state open`，限定 map 的 sub-issues / 任务列表），剔除有未关闭 blocker（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行里有未关闭 issue）或已有 assignee 的；按 map 顺序取第一个。
- **Claim**：`gh issue edit <n> --add-assignee @me`，会话里的第一次写。
- **Resolve**：`gh issue comment <n> --body "<answer>"`，然后 `gh issue close <n>`，再把上下文指针（gist + 链接）追加到 map 的 Decisions-so-far。

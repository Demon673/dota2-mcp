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

在 clone 内运行 `git remote -v` 推断仓库 —— `gh` 会自动做。

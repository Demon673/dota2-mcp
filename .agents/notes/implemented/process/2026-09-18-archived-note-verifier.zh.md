# Agent Note: 归档 Agent Note 校验器

[English](2026-09-18-archived-note-verifier.md) | 中文

Status: implemented

## Problem

归档 Agent Note 的冻结——路径形状、头部块、单语言状态，以及已提交 note 不得编辑、移动、删除——此前只是约定、没有检查点。notes README 只写下全局 archive-agent-notes skill 与 review 作为执行手段，`lefthook.yml` 记下归档 job 的缺席；而另外两道成文关卡（翻译配对、文档预算）各有自己的 pre-commit job。

## Decision

`scripts/verify-archived-agent-notes.mjs` 是这道关卡。它从索引列出 `.agents/notes/archived/**`（跳过 `.gitkeep`），用 `git show :path` 读取每条 note 的内容，因此提交前运行校验的是即将提交的内容而非工作区。逐条检查：路径为 `archived/<class>/yyyy-mm-dd-topic-title.md` 且类别属于六个之一（`implemented` 刻意缺席）、不存在 `.zh.md` 或 `.i18n.yaml` 兄弟文件、头部块为 `# Agent Note: <title>` / 空行 / `Status: implemented` / `Archived: YYYY-MM-DD` 且是真实日历日期。再做一次 `git diff --cached --name-status --diff-filter=MDR` 扫归档目录，拒绝 HEAD 已有 note 的任何暂存编辑、删除或移动。`--list` 打印整棵树；`scripts/test-archived-notes.mjs` 在系统临时目录里建一个一次性 git 仓库、驱动真实 CLI，跑 16 项检查。

`lefthook.yml` 以 pre-commit job `archived agent notes (frozen)` 运行它，刻意不加 `glob` 过滤：暂存删除同样必须触发关卡，而路径过滤无法可靠选中被删除的路径。

关卡只到头部为止，这是刻意的设计。头部不变而正文被改写对它不可见，仍是评审约定——notes README 以这句话收尾该节。

## Alternatives considered

- **保持纯约定的冻结。** 否决：另外两道关卡是机械的，而冻结是唯一一条违规（篡改别的文档当作历史引用的 note）既无声又永久的规则。
- **用 `glob: '.agents/notes/archived/**'` 过滤该 job。** 否决：暂存删除必须触发关卡，而文件名过滤无法可靠选中被删除的路径。
- **在关卡里加 `--self-check` 标志，而不写独立 smoke 脚本。** 否决：那会把测试夹具放进随包发布的工具里，本仓库放这类纯 node 检查的地方是 `scripts/test-*.mjs`。
- **在 `archived/` 下保留中文 counterpart。** 否决：`archived/**` 在配对语料范围之外，那里的 counterpart 是无人管理的半对；notes README 现已写明归档改动会删除它。

## Consequences

一次归档改动 = 移动文件 + 保留 `Status: implemented` + 插入 `Archived:` 行 + 连同 `.zh.md` 与 `.i18n.yaml` 兄弟文件一起删除切换行——中文译文不保留在 `archived/` 下。保留了 counterpart 的归档会让关卡转红，这是刻意给出的信号，而不是无声的半对。

根 `AGENTS.md` 不写这道新关卡：它距 4000 词上限只剩三个词，因此冻结规则仍记在 `.agents/notes/README.md`——也正是关卡失败信息指向的文件。

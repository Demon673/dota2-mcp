# Agent Notes

[English](README.md) | 中文

一类设计文档记录在这里。**Agent Note** 记录一个影响本代码库的决策或提案 —— 代码和文档带不动的 *为什么* 和 *我们放弃了什么*。本文件定义 Agent Note 放在哪里、何时写、以及 [文件内格式](#the-file-format)。

## 布局与命名

每个 Agent Note 有两条轴，都编码在 **路径** 里 —— `{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`：

- **Lifecycle**（顶层目录）是 Agent Note 的状态，note 随状态变化在目录间移动：
  - **`proposed/`** — 实现前评审的提案；尚未构建（或只完成部分）。
  - **`implemented/`** — 决策已落地。文件记录决定了什么、否决了什么，并**与实际落地保持一致**：代码之后移动文件、重命名包、改 key/默认值时，Agent Note 在同一改动里更新（只改事实 —— 路径、名字、结构 —— 不改决策本身）。
  - **`rejected/`** — 提案被考虑后否决。只在它还能阻止一个诱人的、有意义的错误时保留；否则删除。
- **Class**（内层目录）是决策的 *类别* —— 见 [Classification](#classification)。

文件名里的日期是主题**首次提出**的日期（按 git 历史）。Agent Note 之间用相对 markdown 链接互引（`[topic](../../implemented/architecture/2026-…-….md)`）—— 不用裸文件名或编号 —— 这样它们能随目录移动而存活。

活跃的 lifecycle 树就是工作清单：浏览它的 lifecycle/class 目录或搜索仓库。不要加集中式 `INDEX.md`。lifecycle/class 目录已预建（空目录以 `.gitkeep` 入库）；新 note 直接放入对应目录。

<a id="classification"></a>

## 分类

每个 Agent Note 归入一个路径编码的类别：

| Class | 覆盖什么 |
|---|---|
| `feature` | 新的用户或模型可见能力。 |
| `bug-fix` | 修一个缺陷或补一个 postmortem 暴露的缺口。 |
| `simplification` | 去掉代码/行为/表面积而不新增能力。 |
| `architecture` | 关于**交付源码**的结构决策 —— 模块怎么关联、运行时词汇是什么。 |
| `process` | 围绕代码的**工具/策略/工作流** —— 门禁、打包、测试约定 —— 不是运行时行为。 |
| `testing` | 测试基础设施与策略。 |

`architecture` / `process` 分界：**architecture** 关于我们交付的源码；**process** 是周边的工具与工作流。（`refactor` 刻意缺席 —— 它与 `simplification` 重叠，后者的判别标准「可观察行为是否变化」已经覆盖。）

## 何时写

每个非平凡改动必须在同一 commit 里新增或更新至少一条 Agent Note。改动是「非平凡」的，当它改变行为、架构、跨文件/包的契约、进程或工具、测试策略、磁盘/网络/配置格式，或任何维护者可能合理回访的决策。面向大量未来工作的提案从 `proposed/` 开始；已做的决策从 `implemented/` 开始。按决策选类别目录（见 [Classification](#classification)）。

更新已经拥有该决策的 Agent Note 即满足规则；不要造重复。只有纯机械/局部、不改变行为/契约/结构/流程/理由的编辑才豁免。Agent Note 从不被编辑成*另一个决策*：用新的一条取代它，两条互相 cross-link，除非旧 note 之后被完整合并。

一条被完全取代的 `implemented/` Agent Note 可以合并进当前拥有者并删除。删除前，拥有者必须保留每一条独特理由、备选、后果、所需验证与具名覆盖缺口；修复每条入链；同一改动里删除。部分取代不满足条件：两条都保留并 cross-link，更新每条仍成立的事实。合并不得把旧文件改写成其反面，或只靠 git 历史保留理由。

## 归档与删除

当已落地决策完整、其理由不太可能再指导未来工作时，归档一条 `implemented/` Agent Note。当它的备选、所有权边界、负面保证、持久/线上语义、安全规则或再引入条件仍然有用时保持活跃。永不归档 `proposed/` note：否决一个过时提案。`rejected/` note 只在能阻止一个看似合理错误时保留；否则删除。

归档路径是 `archived/{class}/yyyy-mm-dd-topic-title.md`；`implemented` 刻意缺席，因为只有 implemented note 能进入。归档改动 = 移动文件 + 保留 `Status: implemented` + 紧接该 status 插入 `Archived: YYYY-MM-DD`。这是归档期间唯一允许的内容改动。

一旦归档，note 永久冻结。不要编辑、翻译、改写、更新、移动或删除它，也不要把它当作当前行为的权威。活跃 prose 可以在有意引用历史时链入归档 note。本仓库没有归档校验脚本：冻结是约定，靠全局 archive-agent-notes skill 与 review 执行。

<a id="the-file-format"></a>

## 文件内格式

每条活跃 Agent Note 遵循一个格式（约定，无校验脚本；全局 doc-standards 与 archive-agent-notes skill 执行）。

### 头部块

每个文件前三行恰好是：

```markdown
# Agent Note: <title>

Status: <status>
```

后面空一行。`Status:` 值是三种之一，必须与文件所在 lifecycle 目录一致：

- `Status: proposed`
- `Status: implemented`
- `Status: rejected — <why, in one line>`

Status 不带日期、不带括号：文件名持有首次提出日期，git 持有其余。rejection 原因是唯一带内容的 status，因为一条 rejected Agent Note 的裁决就是读者要的事实。

### 正文骨架

每条 Agent Note 以 `## Problem` 开头 —— 动机，写到不依赖方案也能成立。之后随 lifecycle 而异；固定章节用这些规范名字，而真正定制化的技术章节（拓扑、wire 契约、schema）可在必需章节之间自由安排。

#### `proposed/`

```markdown
## Problem
## Proposal
…bespoke sections…
## Alternatives considered
## Acceptance criteria
## Risks
```

`## Proposal` 是意图变更，可以用将来时 —— 计划、迁移步骤、未决问题在工作未构建时属于这里。`## Acceptance criteria` 说可观察的什么状态算完成。`## Risks` 覆盖可能出错的和改动有意放弃的。

#### `implemented/`

```markdown
## Problem
## Decision
…bespoke sections…
## Alternatives considered
## Consequences
```

`## Decision` 用现在时描述已落地现实，整个文件随它保持当前。`## Consequences` 记录取舍**付出**了和**买到**了什么。proposal 时代的标题在这里是 spec-speak：`## Proposal`、`## Plan`、`## Migration plan`、`## Acceptance criteria` 不得出现在 implemented Agent Note。`## Testing`、`## Deferred`、`## Related` 在陈述现在时事实时没问题。

#### `rejected/`

一条 rejected Agent Note 就是被冻结的提案：保留它 proposal 时代的章节（包括 `## Acceptance criteria` 或 `## Plan`），裁决写在 `Status:` 行。只有头部块、`## Problem` 开头、`## Proposal` 章节、以及下面的 Alternatives 要求适用。

### Alternatives considered —— 强制

每条 Agent Note 带 `## Alternatives considered` 章节：每个真实备选与它为何输，每个备选一段粗体开头（或每个被争议的用 `### Why not <X>?` 小节）。没有记录「它打败了什么」的决策会招致重新争论 —— 这正是 Agent Note 要防止的失败。

备选是记录出来的，不是编造出来的。若一条早于本格式的 note 的备选无法从记录重建，写这一行注释占位：

```markdown
<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
```

### 在 lifecycle 之间移动

在 lifecycle 目录间移动文件 = 更新 `Status:` 行并在同一改动里重新满足目标目录的骨架。具体：`proposed/` → `implemented/` 把 `## Proposal` 改写成现在时的 `## Decision`，把 `## Acceptance criteria` 和 `## Risks` 折进 `## Consequences`（或现在时的 `## Testing`/`## Verification` 章节，记录现在固定行为的内容），并丢弃计划、保留落地内容。`proposed/` → `rejected/` 只在 `Status:` 行加理由并冻结文件。

## 双语配对

每条活跃 Agent Note 是一个三件套：英文 `foo.md`（canonical）、中文 `foo.zh.md`（counterpart）、`foo.i18n.yaml`（一致性记录）。英文是权威源；counterpart 逐节镜像。见 [配对契约](../../docs/i18n/README.md) 与 [术语表](../../docs/i18n/terminology.md)。机器校验的头部记号（`# Agent Note: ` 与 `Status:` 行）在 counterpart 中保持英文原样；`# Agent Note: ` 之后的标题翻译为中文。

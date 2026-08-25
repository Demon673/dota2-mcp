# Domain Docs

[English](domain.md) | 中文

工程类 skill 在探查代码库时如何消费本仓库的领域文档。

## 探查前先读这些

- **`AGENTS.md`** —— 仓库根目录，常驻规范与约定。
- **`.agents/notes/`** —— Agent Note 语料。读那些 class（`architecture` / `feature` / `bug-fix` / `simplification` / `process` / `testing`）或主题触及你即将工作的区域的 note。`implemented/` note 用现在时描述已落地现实；`proposed/` 在评审中；`rejected/` 是冻结的裁决。
- **`docs/i18n/terminology.md`** —— 本仓库的领域术语表（英文 ↔ 中文）。命名领域概念前先加载它。
- **`CONTEXT.md`** —— 仓库根目录（若存在），补充术语表。若不存在，静默继续。

如果这些文件里有任何一个不存在，**静默继续**。不要标注它们的缺失；不要主动提议创建。本仓库的决策记录归属 `.agents/notes/`，不在 `docs/adr/`；术语归属 `docs/i18n/terminology.md`，不在 `CONTEXT.md`。`/domain-modeling` skill（经 `/grill-with-docs` 和 `/improve-codebase-architecture` 触达）惰性地把术语与决策记录进这两个归属。

## 文件结构

单上下文仓库。Agent Note 以 `{lifecycle}/{class}/yyyy-mm-dd-topic-title.md` 路径编码，位于 `.agents/notes/` 下：

```
.agents/notes/
├── README.md              ← format + lifecycle/classification rules
├── proposed/
│   └── <class>/…
├── implemented/
│   ├── architecture/…
│   ├── feature/…
│   └── …
├── rejected/
│   └── <class>/…
└── archived/
    └── <class>/…          ← frozen history, not current authority
```

完整格式（头部块、每 lifecycle 骨架、强制 Alternatives-considered）见 `.agents/notes/README.md`。

## 使用术语表的词汇

当你的输出命名一个领域概念（issue 标题、重构提案、假设、测试名），用 `docs/i18n/terminology.md` 或 `AGENTS.md` 里定义的词。不要漂移到术语表明确避免的同义词。

如果你要的概念不在术语表里，那是个信号 —— 要么你在造项目不用的语言（重新考虑），要么真有缺口（记下来给 `/domain-modeling`）。

## 标注 Agent Note 冲突

如果你的输出与现有 Agent Note 矛盾，明确标出而不是默默覆盖：

> _与 `.agents/notes/implemented/feature/2026-07-22-vconsole-contract-and-phase-guidance.md` 矛盾 —— 但值得重新打开，因为…_

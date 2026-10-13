# Domain Docs

[English](domain.md) | 中文

工程类 skill 在探查代码库时如何消费本仓库的领域文档。

## 探查前先读这些

- **[GLOSSARY.md](../../GLOSSARY.md)** —— 领域术语及概念间的区别。命名领域概念前先读它。
- **[AGENTS.md](../../AGENTS.md)** —— 常驻规范与约定。
- **[.agents/notes/](../../.agents/notes/README.md)** —— 决策记录。读那些 class 或主题触及你即将工作区域的活跃 note：`implemented/` 描述已落地的决策，`proposed/` 是评审中的提案，`rejected/` 保留否决理由。归档 note 是历史快照。
- **[docs/i18n/terminology.md](../i18n/terminology.md)** —— 英文 ↔ 中文的译法选择。撰写或更新双语文本时加载它。

如果引用的文件不存在，静默继续。`/domain-modeling` 把定案的领域术语记进 [GLOSSARY.md](../../GLOSSARY.md)，把决策记进 [.agents/notes/](../../.agents/notes/README.md)。

## 文件结构

单上下文仓库：根目录一份 [GLOSSARY.md](../../GLOSSARY.md)。Agent Note 位于 `.agents/notes/` 下，路径为 `{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`；[Agent Note 规则](../../.agents/notes/README.md)定义其格式、lifecycle 与分类。

## 使用术语表的词汇

当 issue 标题、重构提案、假设或测试名使用某个领域概念时，用 [GLOSSARY.md](../../GLOSSARY.md) 里的词与定义。选同义词时遵循其中的 `_Avoid_` 条目；把术语译成中文时遵循[译法表](../i18n/terminology.md)。

如果术语表中缺少所需概念，先判断它是否属于本领域。把定案的领域术语记进 [GLOSSARY.md](../../GLOSSARY.md)。

## 标注 Agent Note 冲突

如果你的输出与某个活跃 Agent Note 矛盾，明确指出并链接那条 note，说明该决策为何需要重新考虑。

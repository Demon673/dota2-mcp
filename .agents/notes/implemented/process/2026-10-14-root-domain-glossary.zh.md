# Agent Note: 根领域术语表

Status: implemented

[English](2026-10-14-root-domain-glossary.md) | 中文

## Problem

领域工作流把译法表当作术语表。译法选择并不定义这些词所指的概念，而工程类 skill 在核对领域词汇时会去找根术语表。

## Decision

[GLOSSARY.md](../../../../GLOSSARY.md) 是领域定义与推荐词汇的归属。[译法表](../../../../docs/i18n/terminology.md) 是英文 ↔ 中文译名的归属；[Agent Note](../../README.md) 是决策的归属。[领域工作流](../../../../docs/agents/domain.md) 按各自的用途把读者引向这些归属。

根术语表是英文/中文三件套，受 scoped 检查与全库配对检查覆盖。这扩展了[文档门禁 note](2026-08-29-root-docs-pairing-and-doc-gates.md)所述的根文档范围。

## Alternatives considered

**继续把译法表当术语表。** 译法映射让领域定义停留在隐含状态，也不提供工程类 skill 消费的那个根入口。

**把译法策略搬进术语表。** 领域定义与译法规则服务不同的读者。两者分处各自的归属，让每个事实保持权威，而不必复制译法表。

## Consequences

定案的领域概念进根术语表；译法变更留在译法表。一次术语表编辑要同步它的 counterpart 与一致性记录。决策记录沿用现有的 Agent Note 布局。

## Testing

配对检查拒绝缺失的术语表兄弟文件、过期的记录与结构差异。文档预算、归档与空白检查覆盖周边的指令与 note 变更。

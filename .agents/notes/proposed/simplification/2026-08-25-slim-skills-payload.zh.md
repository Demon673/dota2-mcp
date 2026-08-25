# Agent Note: 停止随 skills/ 发布不可达的粒子字段级参考

[English](2026-08-25-slim-skills-payload.md) | 中文

Status: proposed

## Problem

skills/ 通过 files[] 的“skills/**/*”发布了 2,431,997 字节。其中 95.4%（2,320,640 B）是粒子字段级参考：class-ref/*.md（9 卷，638,868 B）、vpcf-class-fields.json（1,681,772 B，一个物理行）、appendix-unused.md（18 KB）。skills/ 唯一的读者是 dota2_skill，它的 data 处理器（src/index.ts:529-534, :541）只列出并读取顶层数据文件——class-ref/ 是一个子目录，所以全部 11 个文件都不可达（data='list' 会隐藏它们；data='class-ref/operators.md' 返回“Unknown data file”），而 vpcf-class-fields.json 虽然可达，却在单个 MCP 文本结果里返回 1.68 MB，没有按类的访问或搜索——对模型不实用。拥有该决策的 note（2026-08-20-vfx-model-skills.md:13）把这些完整表格记录为“TODO(rare) later slices”，而且复现是手动的、有文档的（class-ref/README.md:164-184），没有提交生成器。

## Proposal

- 把 skills/dota2-vfx/data/class-ref/（包括 appendix-unused.md）和 vpcf-class-fields.json 移到 research/（files[] 不发布 research/），让复现 README 跟着它们。
- 重写 SKILL.md:121-128：去掉 class-ref 路径的宣传和 1.6 MB JSON 的广告；保留一行指针（完整字段参考在 research/；143 个 schema 类没有被官方内容使用）。
- 把可达且很小的 vpcf-stats.json + vpcf-official-findings.md（以及 dota2-model 那一对）留在 skills/。

## Alternatives considered

- **给 dota2_skill 加子目录支持。** 否决：那会让每次请求都能返回 1.7 MB 的字段表——与分节读取决策（wayfinder #9）背道而驰，后者正是为了让正文保持轻量。
- **继续发布；已经付过成本了。** 否决：它让每次 npm install 多花约 2.3 MB，并且宣传那些会返回错误的数据路径。

## Acceptance criteria

- npm pack 的 tarball 不再包含 class-ref/ 或 vpcf-class-fields.json；dota2_skill 的 data='list' 输出在可达集合上保持不变。
- SKILL.md 不再宣传不可达的数据路径；research/ 连同它的 README 一起保存这份参考。

## Risks

- 任何直接从 node_modules 导入已发布字段 JSON 的人都会失去它——仓库或文档里不存在这样的消费方；research/ 留在仓库内用于再生成。

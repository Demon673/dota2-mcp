# Agent Note: 停止随 skills/ 发布不可达的粒子字段级参考

[English](2026-08-25-slim-skills-payload.md) | 中文

Status: implemented

## Problem

skills/ 通过 files[] 的“skills/**/*”发布了 2,431,997 字节。其中 95.4% 是粒子字段级参考：class-ref/*.md（9 卷）、vpcf-class-fields.json（1.68 MB，一个物理行）、appendix-unused.md。skills/ 唯一的读者是 dota2_skill，它的 data 处理器只列出并读取顶层数据文件——class-ref/ 是一个子目录，所以它的文件都不可达，而 vpcf-class-fields.json 虽然可达，却在单个 MCP 文本结果里返回 1.68 MB，没有按类的访问或搜索。

## Decision

字段级参考已经移出 npm 包：skills/dota2-vfx/data/class-ref/（连同 appendix-unused.md）和 vpcf-class-fields.json 现在位于 research/vpcf-field-reference/（files[] 不发布该目录）；被移动的 README 的链接已修复为指向新位置。SKILL.md 的 data 部分不再宣传不可达的数据路径——它指向 research/vpcf-field-reference/ 并注明那 143 个未被使用的 schema 类。可达的 vpcf-stats.json + vpcf-official-findings.md（以及 dota2-model 那一对）继续发布，research/README.md 的清单反映了这次移动。

## Alternatives considered

- **给 dota2_skill 加子目录支持。** 否决：那会让每次请求都能返回 1.7 MB 的字段表——与分节读取决策（wayfinder #9）背道而驰，后者正是为了让正文保持轻量。
- **继续发布；已经付过成本了。** 否决：它让每次 npm install 多花约 2.3 MB，并且宣传那些会返回错误的数据路径。

## Consequences

npm tarball 少掉约 2.3 MB（约 skills/ 的 95%）：class-ref/*.md、vpcf-class-fields.json 和 appendix-unused.md 不再是每次安装的重量，而 dota2_skill 也不再发布 1.68 MB 的 blob 或不可达的子目录路径。这份参考留在仓库内用于再生成（复现步骤保留在它的 README 里）。

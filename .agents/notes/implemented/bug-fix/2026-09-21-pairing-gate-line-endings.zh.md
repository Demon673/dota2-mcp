# Agent Note: 配对门禁的行尾盲区

[English](2026-09-21-pairing-gate-line-endings.md) | 中文

Status: implemented

## Problem

配对门禁对工作区的原始字节做哈希，又用同一批字节解析一致性记录。Windows 上工作区是 CRLF——`.gitattributes` 写着 `* text=auto` 配 `core.autocrlf=true`，而且是有意为之，"platform-native (CRLF) on checkout"——而 git 存的是 LF。于是任何一次 checkout 都会把范围内每个文件刷成 CRLF，门禁在自己的仓库上变红：record 解析器拿 `name: <40-hex>` 去匹配以 CR 结尾的文本，对每一对都报 `malformed consistency record`，而它算出的哈希也永远不可能等于记录值。在 `docs/agents/domain.md` 上实测：工作区 CRLF 形式是 `005057…`，归一化成 LF 是 `330d7084…`，记录里存的正是 `330d7084…`——索引里那个 blob 的哈希。

这个故障是潜伏的而非恒定的：工作区文件恰好是 LF 时就通过，这也解释了为什么门禁此前一直是绿的，直到一次例行 `git checkout` 把 CRLF 落到了盘上。

## Decision

`readRepositoryFile()` 在返回前把 `\r\n` 归一成 `\n`，而 `scripts/verify-translation-pairing.mjs` 里的每个读取路径都走它——两侧的哈希、record 解析、结构解析，以及 `--write` 用来判断是否重写记录的「未变更」比较。于是 record 及其哈希定义在权威的 LF 文本上，也就是 git 实际存的东西，工作区的行尾不再是契约的一部分。

没有一条 record 需要重写：存的本就是 LF 哈希，所以这次是把既有语料改正，而不是迁移它。

## Alternatives considered

- **在工作区强制 LF**，加 `*.md text eol=lf` 与 `*.i18n.yaml text eol=lf`。否决：`.gitattributes` 刻意表达了相反的意图——checkout 时用平台原生行尾，免得 Windows 工作副本把每个文件都显示成已修改——而该被要求适应所给工作区的是门禁，不是反过来。
- **按 CRLF 内容重录每一对。** 否决：record 会因此依赖平台，Linux 或 macOS 的 checkout 会栽在同一个门禁上，而且记下的哈希不再能指认 git 实际存储的 blob。
- **只让 record 解析器容忍 CRLF。** 否决：那修的是症状（malformed record），把哈希不匹配留在后面，于是配对会改报 out-of-sync。

## Consequences

Bought：门禁在任何平台的任何 checkout 上都跑得绿，而配对门禁一旦变红，就意味着这一对真的不同，而不是文件被检出过。Cost：门禁现在对它转换过的文本做哈希，所以一份内容里合法带 CRLF 的文档会按 LF 比较——这里可以接受，因为索引里每一份被跟踪的文档都是 LF，而替代方案是一个在本项目开发平台上根本跑不起来的门禁。

## Testing

`node scripts/verify-translation-pairing.mjs` 在一个 CRLF 工作区上运行——正是变更前失败的那个状态——报告 36 对一致并退出 0。同一棵树上 `--write --all` 写 0 条记录，即这次修复不带来抖动。

未覆盖：没有任何离线冒烟脚本钉住这一点。回归防线就是门禁本身的运行，而它只在检出为 CRLF 的机器上才走到那条路径。

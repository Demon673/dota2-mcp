# 双语文档配对

[English](README.md) | 中文

本仓库维护一个小型双语语料库：**英文是权威源（撰写侧）**，简体中文逐节镜像它。本页定义配对契约、门禁与范围；[translation-rules.md](translation-rules.md) 定义如何翻译；[terminology.md](terminology.md) 是术语来源真相。

## 配对契约

- **英文是权威源。** 文档用英文撰写与评审；中文 counterpart 是它的翻译。一次改动绝不只落一种语言而没有另外两个文件。
- **一对是三个同级文件。** 英文 `foo.md`、中文 `foo.zh.md`、一致性记录 `foo.i18n.yaml`，都在同一目录——两种语言做成同级兄弟文件，不按语言分文件夹（不要 `en/`/`zh-CN/` 这类目录），也不交织在同一个文件里。「一文件一语言」唯一的例外是根 `README.md`/`CHANGELOG.md` 的文件内双语（见「范围与排除」）。
- **一致性记录。** `foo.i18n.yaml` 记录两边自最后一次确认「说同一件事」以来的 git blob hash：

  ```yaml
  foo.md: <40-hex-blob-hash>
  foo.zh.md: <40-hex-blob-hash>
  ```

  blob hash（`git hash-object` 的结果）而非 commit hash，所以记录对未提交文件也可计算，一致性是纯内容比较。`--write` 重算并记录两边；那个 yaml diff 是「确认两边说同一件事」的可评审动作，所以 `--write` 要求点名你确认过的配对。
- **语言切换行。** 中文文件在 H1 之后立刻用 `[English](foo.md) | 中文` 回链；英文文件用 `English | [中文](foo.zh.md)` 呼应。
- **结构与 counterpart 镜像。** 标题层级与顺序、逐字节相同的代码块（含注释）、表格行列数、列表项数与有序列表起始值、以及除切换行外的每个链接目标，一一匹配。链接总是指向 `foo.md`，绝不指向 `foo.zh.md`。

## 门禁：verify-translation-pairing

`node scripts/verify-translation-pairing.mjs` 机械化地执行契约：

1. 每个 scope 内的文档有完整的一对（三个文件齐全）。
2. 每边的当前 blob hash 等于记录值；编辑任一边而不重记录就变红。
3. 切换行存在，且结构签名匹配（标题、代码块、表格、列表、链接目标）。

`--list` 打印每对的状态（ok / out-of-sync）且永不失败。`--write <file…>` 重记录点名的各对；它拒绝裸跑，所以批量重记录总是显式的。

这条门禁产生的实操规则：**当一次改动编辑配对文档的英文侧，同一次改动以一次术语引导的通读更新中文 counterpart，并用 `--write <file>` 重记录。** 让一对失步的改动会变红。

门禁的局限，说清楚：**绿灯只意味着这对在这些确切内容下被确认为一致，不意味着确认本身是可靠的。** 它检查 hash 与 Markdown 结构；它无法判断两边是否真的说同一件事，或措辞是否准确、术语正确、自然 —— 那是评审人承担的一半契约。

## 范围与排除

**范围**（配对）：`.agents/notes/**`（Agent Note 及其 README）与 `docs/**` 下的每个活跃 `.md`，见 [scripts/translation-pairing.manifest.json](../../scripts/translation-pairing.manifest.json)。

**范围外**（非三件套）：

- 根 `AGENTS.md`、`CLAUDE.md` —— 常驻规范，仅英文。
- 根 `README.md`、`CHANGELOG.md` —— **文件内双语**（英文在前，中文逐节/逐条在后），是「禁止交织双语文件」为公开面保留的唯一例外：一个文档一个文件，不设 `.zh.md`/`.i18n.yaml`，门禁不覆盖它们。`npm run sync-version` 在 `README.md` 内同步双语言版本号。
- `docs/AGENTS.md` —— 文档规范是 agent 指令，与根 `AGENTS.md` 一样只维护英文。
- `skills/**` —— agent 面向的工作流与知识，只英文，随包发布到 npm。
- `docs/i18n/terminology.md` —— 术语表天然双语。
- `.agents/notes/archived/**` —— 冻结的历史快照。

## 分工

例行的 counterpart 更新由工作 agent 在加载 [terminology.md](terminology.md) 后一次性直接完成：针对英文侧的 diff 最小化补译 counterpart，绝不为应用一个小更新而整篇重译。然后用 `node scripts/verify-translation-pairing.mjs --write <file>` 重记录。全局 translate-docs skill 记录这条路径；评审拥有翻译质量与术语。

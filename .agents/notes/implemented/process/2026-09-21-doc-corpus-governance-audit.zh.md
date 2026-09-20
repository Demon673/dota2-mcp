# Agent Note: 文档语料治理审计

[English](2026-09-21-doc-corpus-governance-audit.md) | 中文

Status: implemented

## Problem

文档语料已经与它描述的东西脱节，而现有门禁没有一处看得见。根 `AGENTS.md` 里手工维护的清单已经过期：Core modules 表漏了三个已发布的 `src/tools/` 模块，测试表漏了 release workflow 正在跑的脚本，而工具计数、VCon ports 行、triage 标签列表与配对排除清单各自重述了一个别处拥有的事实。Agent Note 里带着过期计数与时间索引戳。同一份门控合同在四个文件里各写了一遍，改一次就要改四处。

可移植性规则由一条看不见自身盲区的自检守着：`Grep "[A-Za-z]:[\\/]"` 只匹配盘符路径，于是 WSL 形式的 `/mnt/d/…` 路径与一个私有测试 addon 名在 `research/` 和一篇 Agent Note 里活了下来。

配对门禁的问题比脱节更糟——它在说谎。`docs/i18n/README.md` 承诺校验每侧的 blob hash、并让 `--list` 打印每一对的状态，但 `discoverCorpus()` 只把裸字符串 `README.md`/`CHANGELOG.md` 放进集合，从不放它们的 `.zh.md`/`.i18n.yaml` 兄弟，而 `isScopeFile()` 也只认这两个名字。于是根部的两对从不进入 `pairAnchors`：全语料检查在没比较过它们的情况下退出 0，`--list` 则把两对报成 `missing (required)`，尽管四个兄弟文件都在。

## Decision

文档治理以全语料审计的方式运行，而不是随手读一遍。六个探针镜头并行扫过英文权威源语料——leakage、prompt pollution、duplication、手工目录、Agent Note 卫生、结构检查——随后每条发现由三个独立反驳者进攻（是否真有条款禁止它；所引证据是否真实且承重；所开修复是否安全）。只有至少两个反驳者没能击破，发现才成立。之后由完整性批判者审这份审计本身。范围为英文侧：`*.zh.md` 与 `.agents/notes/archived/**` 既不审计也不修改。

修复按「一个 agent 一个文件」执行，任何两个 agent 不会编辑同一文件，且只动英文侧；中文 counterpart 在随后的一趟里同步。删文本要通过文档规范自己设的同一道关：若该文本承载着别处没有的义务、前置条件或后果，就搬位或保留，并把该处记作 adapted，绝不删。有两处因此从「照单删」改为 adapted——替换测试表时保留了 `test-mcp-tools.mjs` 的「vconsole 已连接」前置条件；替换 Core modules 表时保留了一句导航句，因为该表的逐模块角色是那份知识的唯一归宿。

`scripts/verify-translation-pairing.mjs` 现在点名根部每一对的三个文件：`ROOT_ANCHORS` 持有两个锚点，`rootPairFiles()` 把每个展开成它的 `.md`、`.zh.md` 与 `.i18n.yaml`，`isScopeFile()` 与 `discoverCorpus()` 共用。根部两对因此与其他每一对一样被 blob hash 校验，`--list` 报告的是它们的真实状态。

## Alternatives considered

- **更新过期清单而不是删除它们。** 否决：刷新过的手工表是同一个腐坏面换了个更新的时间戳，而分层规则早已给这些事实各指派了归宿。缺的三个模块经工具表与目录本身即可抵达。
- **把 `docs/i18n/README.md` 削弱到与门禁实际行为一致。** 否决：该文档陈述的是仓库想要的契约，错的工具。削弱措辞只会让这份保证在它点名的两对上永久为假。
- **以一次仔细的阅读代替带反驳的扇出。** 否决：约二十条修复建议都是删文本，而单个读者一条貌似合理实则错误的发现就会删掉承重段落，且没有任何环节能拦住它。反驳环节剔除了 50 条中的 14 条。
- **一趟把整个语料连配对一起改完。** 否决：在尚未复核的散文改动旁边写出的译文，会在散文再变时白写。英文先行、配对后随，让每份译文只对着定稿写一次。

## Consequences

Bought：语料门禁现在覆盖了它自己契约点名的那些配对，根部 `README.md`/`CHANGELOG.md` 再不会在无人校验的情况下漂移；过期的清单已删，那类腐坏在 `AGENTS.md` 里已无处重生；可移植性规则的盲区现已写在下一个读者会碰到的地方。

Cost：`AGENTS.md` 从约 4000 词降到约 3400 词，manifest 天花板上出现了原本没有的余量，预算门禁在未来的新增花掉它之前是一根更弱的警戒线。这份审计自己的修复列需要一趟首轮漏掉的探针 6——上面那道删文本的关之所以存在，是因为这个缺口是完整性批判者发现的，而不是扫描发现的。

Deferred：`research/` 在配对范围之外、在预算 manifest 之外、也在任何链接检查之外，所以它内部的链接与引用只由评审把关。

## Testing

`node scripts/verify-doc-budgets.mjs`、`npm run verify-pairs`、`node scripts/verify-archived-agent-notes.mjs` 与 `git diff --check` 是这次变更必须留绿的门禁；配对门禁正是证明中文侧随英文侧一起移动的那个。

根部配对的修复由门禁自身的输出钉住：对被编辑过的根部配对，`--list` 报告 `out-of-sync`，对未编辑的报告 `ok`，而它此前无论哪种情况都报 `missing (required)`。配对门禁没有专门的冒烟脚本，这是本次变更具名的覆盖缺口。

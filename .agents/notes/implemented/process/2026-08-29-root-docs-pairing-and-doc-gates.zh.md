# Agent Note: 根 README/CHANGELOG 配对范围与提交前文档门禁

[English](2026-08-29-root-docs-pairing-and-doc-gates.md) | 中文

Status: implemented

## Problem

根 `README.md` 与 `CHANGELOG.md` 曾是文件内双语（中英交织在一个文件里），违反配对契约「一文件一语言」的规则，且配对门禁不覆盖它们。同时仓库没有提交前检查点：配对漂移、文档预算超限、空白错误只能靠显式跑全库门禁发现。

## Decision

根 `README.md`/`CHANGELOG.md` 是范围内的三件套：英文 `.md` + `.zh.md` + `.i18n.yaml`，由 `verify-translation-pairing.mjs` 发现并校验（isScopeFile + discoverCorpus 包含它们）。`sync-version` 英文标记在 `README.md`、中文标记在 `README.zh.md`；`package.json` files[] 两者都发布。契约的范围段写明它们；单语言的只剩根 `AGENTS.md`/`CLAUDE.md`、`docs/AGENTS.md`、`skills/**`、术语表与归档笔记。

提交前检查点：`lefthook.yml` 跑三个 job——翻译配对（对暂存的 `*.md`/`*.i18n.yaml` 做 scoped 检查；检查跳过配对语料之外的文件，例如单语言的 AGENTS.md）、文档预算（AGENTS.md 上限 4000 词，经 `verify-doc-budgets.mjs` + `scripts/doc-budgets.manifest.json`）、暂存空白检查。`scripts/change-scope.mjs` 供 pre-push-checks 与 code-review 读取已提交/工作区范围。激活方式：`npm run install-lefthook`（lefthook 本身不是包依赖，安装器的报错提示 `npm install --no-save lefthook`）。

## Alternatives considered

- **保留文件内双语的根文档。** 否决：「一文件一语言」是契约的核心规则；开特例等于再造门禁要防的漂移。
- **只靠 CI 门禁。** 否决：本地提交前检查点在编辑后几秒内失败，而不是几分钟后的 CI。
- **把 lefthook 加进 dependencies。** 否决：它只是开发便利工具；no-save 安装保持发布依赖图不变。

## Consequences

每次配对文档编辑都必须同步 counterpart 并重录，否则提交前 scoped 检查（以及全库门禁）转红。新克隆环境执行一次 `npm install --no-save lefthook && npm run install-lefthook`。AGENTS.md 载有纪律四行与 4000 词预算上限。

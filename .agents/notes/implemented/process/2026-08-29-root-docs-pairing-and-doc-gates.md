# Agent Note: Root README/CHANGELOG pairing scope and pre-commit doc gates

English | [中文](2026-08-29-root-docs-pairing-and-doc-gates.zh.md)

Status: implemented

## Problem

Root `README.md` and `CHANGELOG.md` were in-file bilingual (English and Chinese interleaved in one file), which violates the pairing contract's "one language per file" rule, and the pairing gate did not cover them. Separately, the repo had no pre-commit checkpoints: pairing drift, doc-budget overruns, and whitespace errors were caught only by the explicit corpus-wide gate run.

## Decision

Root `README.md`/`CHANGELOG.md` are trio pairs in scope: English `.md` + `.zh.md` + `.i18n.yaml`, discovered and validated by `verify-translation-pairing.mjs` (isScopeFile + discoverCorpus include them). `sync-version` keeps the EN marker in `README.md` and the ZH marker in `README.zh.md`; `package.json` files[] ships both. The contract's scope section names them; only root `AGENTS.md`/`CLAUDE.md`, `docs/AGENTS.md`, `skills/**`, the terminology table, and archived notes stay single-language.

Pre-commit checkpoints: `lefthook.yml` runs three jobs — translation pairing (scoped check over staged `*.md`/`*.i18n.yaml` records; the check skips staged files outside the pairing corpus, e.g. single-language AGENTS.md), doc budgets (AGENTS.md ceiling, 4000 words, via `verify-doc-budgets.mjs` + `scripts/doc-budgets.manifest.json`), and staged-whitespace. `scripts/change-scope.mjs` reports committed/worktree scope for pre-push-checks and code-review. Activation: `npm run install-lefthook` (lefthook itself is not a package dependency; the installer's error hints `npm install --no-save lefthook`).

## Alternatives considered

- **Keep in-file bilingual root docs.** Rejected: "one language per file" is the contract's core rule; a blessed exception re-creates the drift the gate exists to prevent.
- **CI-only gates.** Rejected: local pre-commit checkpoints fail seconds after the edit, not minutes later in CI.
- **Add lefthook to dependencies.** Rejected: it is a dev-only convenience; the no-save install keeps the shipped dependency graph unchanged.

## Consequences

Every paired-doc edit must update the counterpart and re-record, or the pre-commit scoped check (and the corpus-wide gate) goes red. A fresh clone runs `npm install --no-save lefthook && npm run install-lefthook` once. AGENTS.md carries the four session-discipline lines and a 4000-word budget ceiling.

---
name: translate-docs
description: Use when updating, adding, or auditing a bilingual document pair in the dota2-mcp repo — editing either side of an English↔Chinese pair, creating a counterpart, re-recording a sidecar, or diagnosing a verify-translation-pairing failure. English is canonical; the Chinese side mirrors it section-for-section.
---

# Keeping dota2-mcp Bilingual Pairs Consistent

**This skill is guidance, not a translation memory.** It maps the workflow for keeping `foo.md ↔ foo.zh.md` pairs consistent, with English as the canonical (authored) side and Simplified Chinese as its counterpart. The contract lives in [docs/i18n/README.md](../../docs/i18n/README.md); terminology is binding in [docs/i18n/terminology.md](../../docs/i18n/terminology.md). You are the translator: the rules say what must hold, phrasing judgment is yours, terminology is not.

## Triage by change type

- **Update** (pair exists, English edited): follow the update path below. Never re-translate a whole document to apply a small update — a minimal update preserves the reviewed phrasing of everything that didn't change.
- **New pair** (no counterpart yet): write the Chinese counterpart section-for-section under the same structure.
- **Deleted or renamed doc**: delete or rename the `.zh.md` and `.i18n.yaml` alongside it.

## Read the owning contracts

- [docs/i18n/README.md](../../docs/i18n/README.md) — the pairing contract (three files, blob-hash sidecar, switchers, structural parity).
- [docs/i18n/translation-rules.md](../../docs/i18n/translation-rules.md) — how to translate (faithfulness, voice, structure, terminology, typography).
- [docs/i18n/terminology.md](../../docs/i18n/terminology.md) — load it BEFORE translating, not when a term feels uncertain; the terms you don't notice are the ones that drift.

## The update path

1. Load [terminology.md](../../docs/i18n/terminology.md).
2. Diff the English side and apply the smallest Chinese edit that covers that diff: nothing added, nothing dropped, terminology per the table, code spans verbatim.
3. Preserve the reviewed phrasing of everything the diff does not touch.
4. Re-record: `node scripts/verify-translation-pairing.mjs --write <pair>` — name exactly the pairs you confirmed; `--write` refuses to run bare so a bulk re-record is always explicit.
5. Verify: `node scripts/verify-translation-pairing.mjs <pair>` for the touched pairs, then the no-argument corpus-wide form.

## Structural rules (the gate enforces these)

- The Chinese file keeps `[English](foo.md) | 中文` immediately after its H1; the English file keeps `English | [中文](foo.zh.md)`.
- Heading depths and order match; verbatim code blocks are byte-identical (comments included); table row/column counts, list item counts, ordered-list starts, and every link target apart from the switcher match.
- Links always target `foo.md`, never `foo.zh.md`.
- An Agent Note's Chinese H1 keeps the exact prefix `# Agent Note: ` and a translated title; the `Status:` line stays in English verbatim.

## What not to touch

- `docs/AGENTS.md`, `skills/**`, root `AGENTS.md`/`CLAUDE.md`/`README.md` — single-language (see the contract's scope section).
- `docs/i18n/**` — meta-docs, bilingual by construction.
- `.agents/notes/archived/**` — frozen snapshots, never re-translated.

## Report

State which pairs are new versus minimally updated, list any term added to the terminology table, and name the checks actually run.

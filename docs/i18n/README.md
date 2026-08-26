# Bilingual documentation pairing

English | [中文](README.zh.md)

This repo maintains a small bilingual corpus: **English is the canonical (authored) side**, and Simplified Chinese mirrors it section-for-section. This page defines the pairing contract, the gate, and scope; [translation-rules.md](translation-rules.md) defines how to translate; [terminology.md](terminology.md) is the terminology source of truth.

## The pairing contract

- **English is canonical.** A document is authored and reviewed in English; the Chinese counterpart is a translation of it. A change never lands one language without the other two files.
- **A pair is three sibling files.** The English `foo.md`, the Chinese `foo.zh.md`, and a consistency record `foo.i18n.yaml`, all in the same directory — two languages as sibling files, never split into per-language folders like `en/`/`zh-CN/`, and never interleaved inside one file.
- **The consistency record.** `foo.i18n.yaml` holds the git blob hash of each side as of the last time the two were confirmed to say the same thing:

  ```yaml
  foo.md: <40-hex-blob-hash>
  foo.zh.md: <40-hex-blob-hash>
  ```

  Blob hashes (the `git hash-object` result), not commit hashes, so the record is computable for uncommitted files and consistency is a pure content comparison. `--write` recomputes and records both; that yaml diff is the reviewable act of confirming the two sides say the same thing, which is why `--write` requires naming the pairs you confirmed.
- **Language switcher.** The Chinese file links back immediately after its H1 with `[English](foo.md) | 中文`; the English file reciprocates with `English | [中文](foo.zh.md)`.
- **Structure mirrors the counterpart.** Heading depths and order, verbatim code blocks (byte-identical, comments included), table row and column counts, list item counts and ordered-list starts, and every link target apart from the switcher match one-to-one. Links always target `foo.md`, never `foo.zh.md`.

## The gate: verify-translation-pairing

`node scripts/verify-translation-pairing.mjs` enforces the contract mechanically:

1. Every document in scope has a complete pair (all three files).
2. Each side's current blob hash equals the recorded one; editing either side without re-recording goes red.
3. Switchers are present, and the structural signatures match (headings, code blocks, tables, lists, link targets).

`--list` prints the state of every pair (ok / out-of-sync) and never fails. `--write <file…>` re-records named pairs; it refuses to run bare so a bulk re-record is always explicit.

The practical rule this gate creates: **when a change edits the English side of a paired document, the same change updates the Chinese counterpart in one terminology-guided pass and re-records the pair with `--write <file>`.** A change that leaves a pair out of sync goes red.

The gate's limit, stated plainly: **a green gate means the pair was confirmed consistent at these exact contents, not that the confirmation was sound.** It checks hashes and Markdown structure; it cannot judge whether the two sides actually say the same thing, or whether the wording is accurate, well-termed, and natural — that is the reviewer's half of the contract.

## Scope and exclusions

**Scope** (paired): every active `.md` under `.agents/notes/**` (the Agent Notes and their README), under `docs/**`, plus root `README.md` and `CHANGELOG.md`, per [scripts/translation-pairing.manifest.json](../../scripts/translation-pairing.manifest.json).

**Out of scope** (single-language):

- Root `AGENTS.md`, `CLAUDE.md` — standing orders, English only.
- `docs/AGENTS.md` — the documentation standard is an agent instruction, maintained in English only like root `AGENTS.md`.
- `skills/**` — agent-facing workflows and knowledge, English only, shipped to npm.
- `docs/i18n/terminology.md` — the terminology table is bilingual by construction.
- `.agents/notes/archived/**` — frozen historical snapshots.

## Division of labor

Routine counterpart updates are done directly by the working agent in one pass after loading [terminology.md](terminology.md): minimally patch the counterpart against the edited English side's diff, never re-translate a whole document to apply a small update. Then re-record with `node scripts/verify-translation-pairing.mjs --write <file>`. The global translate-docs skill documents this path; review owns translation quality and terminology.

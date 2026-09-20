# Agent Note: Pairing gate line-ending blindness

English | [中文](2026-09-21-pairing-gate-line-endings.zh.md)

Status: implemented

## Problem

The pairing gate hashed the working tree's raw bytes and parsed the consistency record from those same bytes. On Windows the working tree carries CRLF — `.gitattributes` is `* text=auto` with `core.autocrlf=true`, deliberately, "platform-native (CRLF) on checkout" — while git stores LF. So any checkout flipped every in-scope file to CRLF and the gate went red on its own repository: the record parser matched its `name: <40-hex>` line against text ending in a CR, reports `malformed consistency record` for every pair, and the hashes it computed could never equal the recorded ones. Measured on `docs/agents/domain.md`: `005057…` as working-tree CRLF, `330d7084…` normalized to LF, and the record holds `330d7084…` — the blob hash of what the index stores.

The failure is latent rather than constant: a working tree whose files happened to be LF passes, which is why the gate had been green until a routine `git checkout` materialized CRLF.

## Decision

`readRepositoryFile()` normalizes `\r\n` to `\n` before returning, and every reader in `scripts/verify-translation-pairing.mjs` goes through it — the two side hashes, the record parse, the structure parse, and the unchanged-check that decides whether `--write` rewrites a record. The record and its hashes are therefore defined on the canonical LF text, which is what git stores, and the working tree's line endings stop being part of the contract.

No record needed rewriting: the stored hashes were already LF hashes, so this made the existing corpus correct rather than migrating it.

## Alternatives considered

- **Force LF in the working tree**, adding `*.md text eol=lf` and `*.i18n.yaml text eol=lf`. Rejected: `.gitattributes` states the opposite intent on purpose — platform-native endings on checkout, so a Windows working copy does not show every file as modified — and the gate is the component that must tolerate the tree it is handed.
- **Re-record every pair from CRLF content.** Rejected: the record would then be platform-dependent, so a Linux or macOS checkout would fail the same gate, and a recorded hash would no longer identify the blob git actually stores.
- **Make only the record parser CRLF-tolerant.** Rejected: it repairs the symptom (the malformed record) and leaves the hash mismatch behind it, so the pairs would then report out-of-sync instead.

## Consequences

Bought: the gate runs green on any checkout on any platform, and a red pairing gate means the pair genuinely differs rather than the file having been checked out. Cost: the gate now hashes text it has transformed, so a document whose content legitimately contained CRLF is compared as if it held LF — acceptable because every tracked document is LF in the index, and the alternative is a gate that cannot run on the platform this project is developed on.

## Testing

`node scripts/verify-translation-pairing.mjs` run against a CRLF working tree — the exact state that failed before the change — reports 36 pairs consistent and exits 0. `--write --all` on the same tree writes 0 records, so the fix introduces no churn.

Not covered: no offline smoke script pins this. The regression guard is the gate run itself, which only exercises the path on a machine whose checkout is CRLF.

# Agent Note: Documentation corpus governance audit

English | [中文](2026-09-21-doc-corpus-governance-audit.zh.md)

Status: implemented

## Problem

The documentation corpus had drifted from what it describes, and nothing in the gate set could see it. Hand-maintained inventories in root `AGENTS.md` had gone stale: the Core modules table omitted three shipped `src/tools/` modules, the test table omitted a script the release workflow runs, and the tool count, the VCon-ports row, the triage-label list and the pairing-exclusion list each restated a fact owned elsewhere. Agent Notes carried stale counts and indexical stamps. The same gating contract was restated in four files, so one change meant four edits.

The portability rule was enforced by a self-check that cannot see its own blind spot: `Grep "[A-Za-z]:[\\/]"` matches drive-letter paths only, so a WSL-style `/mnt/d/…` path and a private test-addon name survived in `research/` and in one Agent Note.

The pair gate was worse than drifted — it was lying. `docs/i18n/README.md` promises that each side's blob hash is verified and that `--list` prints every pair's state, but `discoverCorpus()` added only the bare strings `README.md`/`CHANGELOG.md`, never their `.zh.md`/`.i18n.yaml` siblings, and `isScopeFile()` admitted only those two names. The two root pairs therefore never entered `pairAnchors`: the corpus-wide check exited 0 with them uncompared, and `--list` reported them `missing (required)` although all four sibling files existed.

## Decision

Documentation governance runs as a whole-corpus audit, not as an ad-hoc read. Six probe lenses sweep the English-canonical corpus in parallel — leakage, prompt pollution, duplication, hand-written catalogs, Agent Note hygiene, and the structural pass — and every finding is then attacked by three independent refuters (does a clause actually forbid this; is the quoted evidence real and load-bearing; is the prescribed fix safe). A finding survives only if at least two refuters fail to break it. A completeness critic then audits the audit. Scope is the English side only: `*.zh.md` and `.agents/notes/archived/**` are excluded from both audit and edit.

Fixes are applied one file per agent, so no two agents edit the same file, and only on the English side; the Chinese counterparts are synced in a following pass. Deleting prose requires clearing the same bar the standard sets: if the text carries an obligation, a prerequisite or a consequence with no other home, it is relocated or kept and the change is recorded as adapted, never deleted. Two fixes were adapted rather than applied for this reason — the test-table replacement kept `test-mcp-tools.mjs`'s "vconsole already connected" prerequisite, and the Core-modules replacement kept a navigational sentence because the table's per-module roles were the only home for that knowledge.

`scripts/verify-translation-pairing.mjs` now names all three files of each root pair: `ROOT_ANCHORS` holds the two anchors and `rootPairFiles()` expands each to its `.md`, `.zh.md` and `.i18n.yaml`, used by both `isScopeFile()` and `discoverCorpus()`. The root pairs are therefore hash-verified like every other pair, and `--list` reports their real state.

## Alternatives considered

- **Update the rotted catalogs instead of deleting them.** Rejected: a refreshed hand-maintained table is the same rot surface with a newer timestamp, and the tier taxonomy already assigns each of those facts a home. The three missing modules are reached through the tool tables and the directory itself.
- **Weaken `docs/i18n/README.md` to match what the gate did.** Rejected: the document states the contract the repo wants, and the tool was the thing that was wrong. Weakening the prose would have made the guarantee permanently false for the two pairs the contract names.
- **Run the audit as one careful read instead of a refuted fan-out.** Rejected: roughly twenty of the prescribed fixes were deletions, and a single reader's plausible-but-wrong finding would have deleted load-bearing prose with nothing to catch it. The refutation stage removed 14 of 50 findings.
- **Fix the whole corpus in one pass, pairs included.** Rejected: a translation written beside a not-yet-reviewed prose edit has to be redone when the prose changes. English first, pairs second, keeps each translation written once against settled text.

## Consequences

Bought: the corpus gate now covers the pairs its own contract names, so root `README.md`/`CHANGELOG.md` can no longer drift unverified; the rotted catalogs are gone, so that class of drift has nowhere left to reappear in `AGENTS.md`; and the portability rule's blind spot is now written down where the next reader will meet it.

Cost: `AGENTS.md` dropped from about 4000 words to roughly 3400, so the manifest ceiling now carries headroom it did not have, and the budget gate is a weaker tripwire until a future addition spends it. The audit's own fix column needed a probe-6 pass that the first run omitted — the deletion bar above exists because that gap was found by the completeness critic, not by the sweep.

Deferred: `research/` is outside the pairing scope, outside the budget manifest and outside any link check, so its internal links and its citations are verified by review alone.

## Testing

`node scripts/verify-doc-budgets.mjs`, `npm run verify-pairs`, `node scripts/verify-archived-agent-notes.mjs` and `git diff --check` are the gates this change must leave green; the pairing gate is what proves the Chinese side moved with the English.

The root-pair fix is pinned by the gate's own output: `--list` reports `out-of-sync` for an edited root pair and `ok` for an unedited one, where it previously reported both `missing (required)` regardless. There is no dedicated smoke script for the pairing gate, which is the named coverage gap on this change.

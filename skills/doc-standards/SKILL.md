---
name: doc-standards
description: Use when writing, moving, reviewing, or auditing documentation in the dota2-mcp repo — choosing hierarchy and detail, separating tutorials from references, trimming doc slop, or responding to requests like "improve the docs", "audit the docs", "where should this be documented", or "this doc is too long".
---

# Applying the dota2-mcp Documentation Standard

The documentation rules live in [docs/AGENTS.md](../../docs/AGENTS.md). This workflow covers placement, corpus audits, and validation across Markdown, JSDoc, and code comments. It is guidance, not a script; use the global prose-standard skill for required coverage and editorial judgment, and never treat length alone as a defect.

## Sources of truth (read, don't re-summarize)

- [docs/AGENTS.md](../../docs/AGENTS.md) — hierarchy, tutorial/reference forms, taxonomy, and the slop checklist.
- [.agents/notes/README.md](../../.agents/notes/README.md) — when a decision earns an Agent Note, how to file it, and what goes inside one (header block, per-lifecycle skeleton, and the Alternatives-considered mandate).
- [docs/i18n/README.md](../../docs/i18n/README.md) — the bilingual pairing contract: which docs are English-canonical pairs, the `.i18n.yaml` sidecar, and the `verify-pairs` gate.
- Root [AGENTS.md](../../AGENTS.md) — the standing orders whose discipline this skill protects.

## Review structure before prose

Apply the standard's authoring order to every human-facing document in scope. Do not apply this structural pass to Agent Notes, which follow their own format.

1. Locate the document in the repository and navigation trees. State its own subject and identify its direct children.
2. Set the permitted level of detail. Keep full detail about the document's subject, summarize direct children by purpose, responsibility, and high-level behavior, and move deeper explanations to their owning descendants with links. Treat test scripts as descendant-owned unless the test is the document's subject.
3. Classify the document from its intended use, not its path or title. A tutorial must lead through ordered work to an observable outcome; a reference must support lookup within an explicit scope without requiring sequential reading.
4. For a tutorial, privately classify the starting reader and concepts as beginner, intermediate, or advanced. Trace each concept to its prerequisites, reorder premature material, and move optional advanced detail to a later tutorial or reference.
5. Split substantial mixed forms. Put a small secondary form in a clearly labeled section.

Then check constraints that make placement expensive or wrong:

- `skills/**` ships to npm and is exposed through `dota2_skill`; it holds reusable workflows and knowledge, not product or runtime contracts (those live in `AGENTS.md` / `README.md`).
- Paired docs (`.agents/notes/**`, `docs/agents/**`) cost a Chinese counterpart update and a `--write` re-record on every edit; prefer a single-language home (root `AGENTS.md`, `skills/`, `docs/AGENTS.md`) for content that will churn.
- Before renaming or moving any doc, grep for inbound references; there is no link-lint gate in this repo, so a move is only safe when you fix every inbound link in the same change. A move is atomic: remove from the old home, add to the new home, fix every inbound link.

## Audit the corpus

After the structural pass, hunt the standard's slop checklist with the cheapest probes first, then apply semantic judgment.

1. Measure with `git ls-files '*.md' | xargs wc -w | sort -rn | head -30` to spot oversized outliers. There is no budget gate; use size as a discovery hint, not a verdict.
2. Hunt reasoning-transcript leakage — narrated history, dead design-session citations, review choreography, control-flow narration, test walkthroughs — with the global trim-cot-leakage skill, which defines the taxonomy and rules for what to keep or delete. Preserve only a non-obvious contract or durable rationale; the same rationale repeated beside sibling methods keeps one home.
3. Hunt duplication by grepping distinctive phrases. Keep one home and replace other copies with links.
4. In `implemented/` Agent Notes, remove migration plans, acceptance-task checklists, and future-tense spec language. Keep concise verification contracts that identify the behaviors and tiers pinning the shipped decision, plus named coverage gaps.
5. If removing prose changes a promised behavior rather than its explanation, use a proposed Agent Note first.

Exclude `node_modules/`, `dist/`, and any archived Agent Notes from corpus audits and edits. Active prose may repair, redirect, or delete an inbound link into an archived note, but never follow a cleanup into the frozen target.

Keep every load-bearing rule, preferably as one to three lines plus a link to its rationale. Cut stories, duplicates, status notes, and the path used to derive the rule. Do not create a new explanation merely to relocate disposable reasoning.

## Validation

Run at least `npm run check`, `npm run verify-pairs`, and `git diff --check` for doc-only changes. If a paired document changed, re-record it with `node scripts/verify-translation-pairing.mjs --write <file>`. Report the documents changed, any deliberately long exception, and the checks actually run.

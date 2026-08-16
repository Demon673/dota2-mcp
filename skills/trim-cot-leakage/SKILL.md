---
name: trim-cot-leakage
description: Use when auditing or fixing prose that reads like a leaked reasoning transcript — dead design-session citations such as (decision N) or §N of uncommitted drafts; change narration such as "used to", "no longer", "this cut"; stack or review vantage ("a later PR", "rejected in review"); reviewer-addressed justifications; control-flow narration; or hedged planning residue in comments, JSDoc, docs, or Agent Notes.
---

# Trimming Chain-of-Thought Leakage

Chain-of-thought leakage is prose whose vantage is the authoring session rather than the repository: it cites artifacts only that session could see, narrates the change instead of the state, or argues with a reviewer who has left. The fix is never deletion alone when a passage carries factual clauses — restate each so it stands at HEAD, then delete the transcript around it; a passage carrying none (an audit code, control-flow narration) is deleted outright. **REQUIRED BACKGROUND:** [prose-standard](../prose-standard/SKILL.md) owns the complete-proposition rule this skill applies. It is guidance, not a script.

## The one test

For every suspect passage ask: **could a reader at HEAD, with no access to any session transcript, PR thread, or uncommitted draft, resolve every reference and verify every claim?** If no, restate the surviving facts from the repository's vantage and delete the rest. If yes, it is not leakage, however historical it sounds — but resolvability only clears this skill's bar: on current-state surfaces (README, docs, JSDoc) a resolvable change story is still change narration, and class 3 routes it to its sanctioned home.

## Taxonomy

1. **Dead design-session citations** — `(decision 7)`, `(audit C2)`, `design §4.7`, phase labels (`T4`, `W3`). If the decision has a committed owner, cite it by name and path (an Agent Note); otherwise delete the citation and restate its factual clause to stand alone.
2. **Stack and PR vantage** — "a later PR in this stack", "this PR adds", "the previous commit". State the shipped mechanism; deferred work moves to a `TODO` marker or an issue reference.
3. **Change narration and version stamps** — "used to", "no longer", "the old X", and indexical stamps ("v1", "this cut", "now" contrasting with a past state). State the present behavior; a fixed regression becomes a present-tense counterfactual ("without X, Y happens"), never repo history ("used to Y").
4. **Review choreography** — "Rejected in review:", draft ordinals ("v5 of this note"), round attributions. Keep the surviving decision and rationale as plain fact; delete who said it when.
5. **Reviewer-addressed justification** — "the cast is safe — it simply…", "this is correct because…". A comment arguing its own correctness addresses a reviewer, not a maintainer. State the invariant that makes the code safe, or delete the comment if the code shows it.
6. **Restatement and derivation transcripts** — control-flow narration ("first we X, then we Y"), test walkthroughs, proofs of obvious branches. Delete; keep only a non-obvious contract or invariant.
7. **Hedges and planning residue** — "probably fine for now", "should be enough", deferrals with no marker. Promote to `TODO`/`FIXME` or restate as the actual bound; delete the hedge.
8. **Authoring-language slips** — untranslated working-language fragments in prose whose language is otherwise the other (e.g. an English leftover in a Chinese note, or a stray `---- 私有 ----` separator). Translate or delete.

## What is not leakage

- **Issue references** — `#42`, `TODO(name):`, "issue #N owns the follow-up" resolve at HEAD; keep them on any surface.
- **Merged-PR and issue citations inside Agent Notes** — sanctioned evidence per the [documentation standard](../../docs/AGENTS.md)'s change-story routing.
- **Suppression justifications** — lint-disable reasons, empty-catch explanations are required prose; fix a false reason, never delete it.
- **Counterfactual-present regression pins** — "without X, Y happens", "a naive X would…".
- **Measured bounds** — "(measured: 512 nests ≈ 0.15s)" calibrating a constant; the provenance word "measured" is load-bearing.
- **Runtime old/new states** — "the old connection drains before the new one accepts" is runtime lifecycle, not change history.
- **External references that resolve outside the repo by design** — standards sections (RFC 9110 §10.1.5), Dota 2 wiki page names; the §-ban covers uncommitted internal drafts, not external standards.
- **Project voice and genre forms** — "we" as project voice; a note's Alternatives-considered section.

## Workflow

1. Scope and exclusions per [prose-standard](../prose-standard/SKILL.md): require an explicit scope; never touch `dist/`, `node_modules/`, or archived Agent Notes.
2. Audit read-only first: search the recall patterns, then judge every hit semantically. The patterns are probes, not the definition — also read the densest prose in scope (module JSDoc, README, Agent Notes) without a pattern in hand.
3. Fix owner-first per surface: generated output → fix the source and regenerate; Agent Notes → the owning note is authoritative for its decision, so restate there; model-visible strings (tool descriptions, error text) → wording is behavior, so treat a rewording as a behavior change, not a cosmetic edit.
4. Before deleting anything, enumerate the passage's propositions (prose-standard) and check the overcorrection traps: trims that flip an obligation into an endorsement, promote a hypothetical to a shipped feature, delete a true fact, or drop provenance.
5. Verify: re-search the patterns expecting only sanctioned keeps; confirm every remaining citation resolves at HEAD; run `npm run check` for code and `git diff --check`.

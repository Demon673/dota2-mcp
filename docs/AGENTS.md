# AGENTS.md — The documentation standard

This file defines document structure, Markdown tiers, and writing rules for this repo. Use the global doc-standards skill for placement and validation, and the global prose-standard skill for required coverage and editorial judgment.

## Document structure

These rules apply to human-facing documentation; [Agent Notes](../.agents/notes/README.md) are decision records and follow their own format.

A document's subject and tree position fix its scope: describe its own subject at appropriate detail, and direct children only by purpose, responsibility, and high-level behavior; link to the owning descendant for lower-level detail. Document type does not widen that scope.

Classify every document as a tutorial or a reference. Tutorials follow an ordered path to an observable outcome and introduce only what each step needs. References define a lookup scope and current behavior without a teaching sequence. Separate substantial mixed forms; label a section when one part is small.

Author in this order: locate the document in the tree; set its permitted detail; choose tutorial or reference; for a tutorial, order concepts by prerequisite and difficulty; relocate descendant-owned detail; replace lower-level explanations with links to their owners.

## The tier taxonomy: one home per fact

Each fact has one home — the tier whose job it is; elsewhere, link there.

| Tier | Job | Does NOT belong there |
|---|---|---|
| Root `AGENTS.md` | Standing orders: rules an agent needs in context every session, one to three lines each, linking its home | Stories, worked examples, situational procedures, anything restated from a linked home |
| `README.md` | Public consumer contract: configuration, semantics, failures, limitations, extension points | Implementation detail, internal protocol, decision rationale |
| `docs/AGENTS.md` | This standard | Repo-wide rules the root file already carries |
| `docs/agents/*.md` | Agent workflow guidance: issue tracker, triage labels, domain consumption | Decision rationale (→ Agent Notes) |
| [Agent Notes](../.agents/notes/README.md) | Active decision records: the why, what-was-given-up, and required verification; `implemented/` notes describe shipped reality in present tense | Migration plans, acceptance checklists, fixture walkthroughs, spec-speak |
| [postmortem/](postmortem/README.md) | Incident stories — the only tier where war-story narrative belongs | — |
| `skills/` | Reusable workflows and specialized knowledge, shipped to npm and exposed via `dota2_skill` (machine-readable data in `skills/<name>/data/`, read via the tool's `data` argument) | Product and runtime contracts (→ `AGENTS.md` / `README.md`) |
| `research/` | One-off investigation records (sampling methodology, decompiler behavior notes) not yet absorbed into a skill | Duplicated copies of files already delivered under `skills/` — the skill's `data/` copy is canonical |
| Code comments / JSDoc | Non-obvious contracts: behavior, failure, timing, ownership, exceptions | Reasoning transcripts, control-flow narration, code restatement |
| `scripts/*.mjs` | Plain-node smoke tests (assert style) | — |

Placement: rationale → Agent Notes; procedures → skills or cookbook content; contracts → `AGENTS.md` / `README.md`; standing orders → root `AGENTS.md`; known issues → the `已知问题 / 注意事项` section of `AGENTS.md` (a defect a fix closed may earn a `bug-fix` Agent Note; an incident that escaped to users earns a postmortem).

## Writing rules

- **Document current state, not change history.** Avoid "previously / now / no longer", PRs, commits, and stack positions in durable prose; name the live mechanism. Put change stories in commits, Agent Notes, or postmortems; Agent Notes may cite merged PRs and issues as evidence.
- **Every non-trivial change includes at least one Agent Note in the same commit.** Update the owning note or add one; only mechanical/local edits are exempt ([scope](../.agents/notes/README.md#when-to-write-one)).
- **One physical line per paragraph** — use editor soft-wrap. Code blocks, tables, and list structure keep their formatting.
- **Comments and JSDoc state complete contracts, not reasoning transcripts.** Preserve behavior, failure, timing, ownership, modality, exceptions, and consequences; delete narration, test walkthroughs, and code restatement. Use the global prose-standard skill for details.
- **Write directly: name actors and facts.** Reserve `contract`, `boundary`, `seam`, `gate`, and `surface` for the exact technical subject; otherwise name the rule, API, field set, type, or failure state.
- **Cross-reference with relative Markdown paths, never bare filenames.** Links must resolve from the document's location; keep them mechanically checkable — a move fixes every inbound link in the same change.
- **Paired documents update together.** Documents in scope (`.agents/notes/**`, `docs/**`) are English-canonical bilingual pairs; a change to the English side updates the Chinese counterpart in the same change and re-records the pair with `node scripts/verify-translation-pairing.mjs --write <file>`. See [the pairing contract](i18n/README.md), [translation rules](i18n/translation-rules.md), and [terminology](i18n/terminology.md). This file, `skills/**`, and root `AGENTS.md`/`CLAUDE.md` are single-language (out of scope); root `README.md`/`CHANGELOG.md` are in-file bilingual, also outside the pairing scope (see the pairing contract).

## The slop checklist

Hunt these in any document; the global doc-standards skill runs this list as an audit:

- The same rule stated in more than one home. Grep a distinctive phrase; keep one home and link the rest.
- Narrated history or war stories: "previously", "now", "no longer", "used to", "renamed", PRs, or commits. State the current fact; link an Agent Note when needed.
- Implementation-status annotations in prose ("implemented!", "future: …"). Status rots; the repo layout and tool registry carry it.
- Reasoning transcripts: step-by-step implementation narration, proofs of obvious branches, test walkthroughs, or rejected local alternatives. Keep the resulting contract or durable rationale; delete the path used to derive it.
- Rationale repeated beside sibling methods instead of once at the owning capability.
- Paragraph walls: one paragraph carrying several rules and parenthetical asides. Split it or demote the detail to its home.
- Emphasis inflation: bold, CAPS, or "critically" everywhere means nothing stands out. Reserve emphasis for the clause that changes behavior.
- Spec-speak in `implemented/` Agent Notes: "should", migration plans, acceptance checklists. An implemented Agent Note describes what is.

This repo has no word-budget gate; keep documents lean by relocation and condensation, not by a script.

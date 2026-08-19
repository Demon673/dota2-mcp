# Agent Notes

English | [中文](README.zh.md)

One kind of design doc lives here. An **Agent Note** records a decision or proposal that affects this codebase — the *why* and *what we gave up*, the parts code and docs can't carry. This file defines where Agent Notes live, when to write one, and [the in-file format](#the-file-format).

## Layout and naming

Every Agent Note has two axes, both encoded in its **path** — `{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`:

- **Lifecycle** (the top-level folder) is the Agent Note's status, and a note moves between folders as that status changes:
  - **`proposed/`** — proposals reviewed before implementation; not yet built (or only partly).
  - **`implemented/`** — the decision shipped. The file records what was decided and what was rejected, and is **kept current with what actually shipped**: when the code later moves a file, renames a package, or changes a key/default, the Agent Note is updated in the same change to match (facts only — paths, names, structure — not the decision itself).
  - **`rejected/`** — the proposal was considered and declined. Keep it only while its rationale prevents a tempting, meaningful mistake; otherwise delete it.
- **Class** (the nested folder) is the *kind* of decision — see [Classification](#classification).

The date in the filename is when the topic was **first proposed** (per git history). Cross-references between Agent Notes use relative markdown links (`[topic](../../implemented/architecture/2026-…-….md)`) — never bare prose or numbers — so they survive moves between folders.

The active lifecycle tree is the working inventory: browse its lifecycle/class folders or search the repository. Do not add a centralized `INDEX.md`. Lifecycle/class directories are pre-created (empty directories are tracked via `.gitkeep`); drop a new note into the matching directory.

## Classification

Each Agent Note belongs to one path-encoded class:

| Class | What it covers |
|---|---|
| `feature` | A new user- or model-facing capability. |
| `bug-fix` | Corrects a defect or closes a gap a postmortem surfaced. |
| `simplification` | Removes code, behavior, or surface area without adding a capability. |
| `architecture` | A structural decision about the **shipped source** — how modules relate, what the runtime vocabulary is. |
| `process` | Tooling, policy, or workflow **around** the code — gates, packaging, testing conventions — not runtime behavior. |
| `testing` | Test infrastructure and strategy. |

The `architecture` / `process` line: **architecture** is about the source we ship; **process** is the surrounding tooling and workflow. (`refactor` is deliberately absent — it overlaps `simplification`, whose discriminator, "does observable behavior change?", already covers it.)

## When to write one

Every non-trivial change MUST add or update at least one Agent Note in the same commit. A change is non-trivial when it alters behavior, architecture, a contract shared across files or packages, process or tooling, testing strategy, an on-disk, wire, or configuration format, or another decision a maintainer may reasonably revisit. A proposal for substantial future work starts in `proposed/`; a decision already made starts in `implemented/`. Pick the class folder that matches the decision (see [Classification](#classification)).

Updating the Agent Note that already owns the decision satisfies the rule; do not create a duplicate. Only a purely mechanical or local edit with no change to behavior, contracts, structure, process, or rationale is exempt. An Agent Note is never edited into a *different decision*: supersede it with a new one, and keep both notes cross-linked unless the old note is later fully consolidated.

A fully superseded `implemented/` Agent Note may be consolidated into the current owning note and deleted. Before deletion, the owner must preserve every unique rationale, alternative, consequence, required verification, and named coverage gap; repair every inbound link; and delete in the same change. Partial supersession does not qualify: keep both notes cross-linked and update every fact that remains current. Consolidation must not rewrite the old file into its opposite, or rely on git history as the only copy of rationale.

## Archiving and deletion

Archive an `implemented/` Agent Note when the shipped decision is complete and its rationale is unlikely to guide future work. Keep it active when its alternatives, ownership boundary, negative guarantee, durable or wire semantics, security rule, or reintroduction condition remains useful. Never archive a `proposed/` note: reject an obsolete proposal. Keep a `rejected/` note only while it prevents a plausible mistake; otherwise delete it.

The archive path is `archived/{class}/yyyy-mm-dd-topic-title.md`; `implemented` is deliberately absent because only implemented notes can enter it. An archival change moves the file, keeps `Status: implemented`, and inserts `Archived: YYYY-MM-DD` immediately below that status. These are the only permitted content changes during archival.

Once archived, a note is permanently frozen. Do not edit, translate, reformat, update, move, or delete it, and do not treat it as authority for current behavior. Active prose may link into an archived note when it intentionally cites history. This repo has no archive verifier script: the freeze is a convention enforced by the global archive-agent-notes skill and review.

## The file format

Every active Agent Note follows one in-file format (a convention, with no verifier script; [doc-standards](../../skills/doc-standards/SKILL.md) and the global archive-agent-notes skill enforce it).

### The header block

The first three lines of every Agent Note are exactly:

```markdown
# Agent Note: <title>

Status: <status>
```

followed by a blank line. The `Status:` value is one of three forms, and must agree with the lifecycle folder the file sits in:

- `Status: proposed`
- `Status: implemented`
- `Status: rejected — <why, in one line>`

The status carries no dates and no parentheticals: the filename holds the first-proposed date, git holds everything else. The rejection reason is the one status with content, because a rejected Agent Note's verdict is the fact readers come for.

### The body skeleton

Every Agent Note opens its body with `## Problem` — the motivation, written to stand without the solution. What follows depends on the lifecycle; recurring sections use these canonical names, while genuinely bespoke technical sections (topology, wire contracts, schemas) remain free-form between the required ones.

#### `proposed/`

```markdown
## Problem
## Proposal
…bespoke sections…
## Alternatives considered
## Acceptance criteria
## Risks
```

`## Proposal` is the intended change and may speak in the future tense — plans, migration steps, and open questions belong here while the work is unbuilt. `## Acceptance criteria` says what observable state means done. `## Risks` covers both what could go wrong and what the change knowingly gives up.

#### `implemented/`

```markdown
## Problem
## Decision
…bespoke sections…
## Alternatives considered
## Consequences
```

`## Decision` describes shipped reality in the present tense, and the whole file is kept current with it. `## Consequences` records what the trade-off cost **and** bought. Proposal-era headings are spec-speak here: `## Proposal`, `## Plan`, `## Migration plan`, and `## Acceptance criteria` may not appear in an implemented Agent Note. A `## Testing`, `## Deferred`, or `## Related` section is fine where it states present-tense fact.

#### `rejected/`

A rejected Agent Note is the proposal, frozen: it keeps whatever proposal-time sections it had (including `## Acceptance criteria` or `## Plan`), and the verdict lives on the `Status:` line. Only the header block, the `## Problem` opener, a `## Proposal` section, and the Alternatives mandate below apply.

### Alternatives considered — mandatory

Every Agent Note carries an `## Alternatives considered` section: each genuine alternative and why it lost, one bold-led paragraph per alternative or a `### Why not <X>?` subsection per contested one. A decision recorded without what it beat invites re-litigation — the failure Agent Notes exist to prevent.

Alternatives are recorded, never invented. If a pre-format note's alternatives cannot be reconstructed from the record, write this exact comment in place of the section:

```markdown
<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
```

### Moving between lifecycles

Moving a file between lifecycle folders means updating the `Status:` line and re-satisfying that folder's skeleton in the same change. Concretely, `proposed/` → `implemented/` rewrites `## Proposal` into a present-tense `## Decision`, folds `## Acceptance criteria` and `## Risks` into `## Consequences` (or a present-tense `## Testing`/`## Verification` section for what now pins the behavior), and drops plans in favor of what shipped. `proposed/` → `rejected/` only adds the reason to the `Status:` line and freezes the file.

## Bilingual pairing

Every active Agent Note is a bilingual triplet: the English `foo.md` (canonical), the Chinese `foo.zh.md` (counterpart), and `foo.i18n.yaml` (consistency record). English is canonical; the counterpart mirrors it section-for-section. See [the pairing contract](../../docs/i18n/README.md) and [terminology](../../docs/i18n/terminology.md). The machine-checked header tokens (`# Agent Note: ` and the `Status:` line) stay in English verbatim in the counterpart; the title after `# Agent Note: ` is translated.

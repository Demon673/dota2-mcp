# Agent Note: Archived Agent Note verifier

English | [中文](2026-09-18-archived-note-verifier.zh.md)

Status: implemented

## Problem

The archived Agent Note freeze — path shape, header block, single-language status, and no edit, move, or delete of a committed note — was a convention with no checkpoint. The notes README named the global archive-agent-notes skill and review as its only enforcement, and `lefthook.yml` recorded the archive job's absence, while the two other documented gates (translation pairing, doc budgets) each had a pre-commit job.

## Decision

`scripts/verify-archived-agent-notes.mjs` is the gate. It lists `.agents/notes/archived/**` from the index (skipping `.gitkeep`) and reads each note's content with `git show :path`, so a pre-commit run validates what is being committed rather than the worktree. Per note it checks that the path is `archived/<class>/yyyy-mm-dd-topic-title.md` with one of the six classes (`implemented` deliberately absent), that no `.zh.md` or `.i18n.yaml` sibling exists, and that the header block is `# Agent Note: <title>` / blank / `Status: implemented` / `Archived: YYYY-MM-DD` carrying a real calendar date. One further `git diff --cached --name-status --diff-filter=MDR` over the archive directory rejects a staged edit, deletion, or move of a note HEAD already carries. `--list` prints the tree; `scripts/test-archived-notes.mjs` runs 16 checks against a throwaway git repository in the OS temp directory, driving the real CLI.

`lefthook.yml` runs the gate as the pre-commit job `archived agent notes (frozen)`, deliberately without a `glob` filter: the gate must also fire on a staged deletion, and a path filter does not reliably select one.

The gate is header-deep by design. A rewritten body under an unchanged header is invisible to it and stays a review convention — the sentence the notes README closes the section with.

## Alternatives considered

- **Keep the convention-only freeze.** Rejected: the other two gates are mechanical, and the freeze is the one rule whose violation — editing a note another doc cites as history — is both silent and permanent.
- **Filter the job with `glob: '.agents/notes/archived/**'`.** Rejected: a staged deletion must trip the gate, and a filename filter does not reliably select a removed path.
- **A `--self-check` flag on the gate instead of a separate smoke script.** Rejected: it puts fixtures inside shipped tooling, and the repo's home for a plain-node check is `scripts/test-*.mjs`.
- **Keep the Chinese counterpart under `archived/`.** Rejected: `archived/**` sits outside the pairing corpus, so a counterpart there is an unmanaged half-pair; the notes README now states that the archival change removes it.

## Consequences

An archival change is: move the file, keep `Status: implemented`, insert the `Archived:` line, and drop the switcher line with the `.zh.md` and `.i18n.yaml` siblings — a Chinese translation is not retained under `archived/`. An archival that keeps the counterpart turns the gate red, which is the intended signal rather than a silent half-pair.

Root `AGENTS.md` does not name the new gate: it sits three words below its 4000-word ceiling, so the freeze rules stay documented in `.agents/notes/README.md`, the file the gate's failure message points at.

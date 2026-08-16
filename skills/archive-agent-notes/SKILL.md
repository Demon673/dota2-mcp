---
name: archive-agent-notes
description: Use when adding, auditing, pruning, archiving, restoring, or reviewing Agent Notes in dota2-mcp; checks every new note for superseded active records, classifies implemented notes by future decision value, deletes rejected notes that no longer prevent a tempting fallacy, and applies the frozen archived/{class} rules.
---

# Archive dota2-mcp Agent Notes

Reduce the active decision corpus without erasing history that can still guide work. Judge every note semantically; word count and age are discovery aids, never archive criteria.

## Read the contracts

Read [the Agent Note rules](../../.agents/notes/README.md) before classifying. Use current code, configuration, docs, newer Agent Notes, and inbound links to establish whether a rationale still owns or constrains anything. There is no archive verifier script in this repo: the frozen rules are enforced by this skill and review.

## Check supersession when adding a note

Every new Agent Note triggers a scoped audit of active notes covering the same decision, mechanism, or rejected alternative. Classify each full or partial supersession while writing the new note: archive qualifying implemented notes in the same change, retain and cross-link partial supersessions or independently useful rationale, reject obsolete proposals, and delete rejected notes that no longer prevent a plausible mistake. Do not defer a known match to a later corpus audit.

## Classify by future value

- **Implemented — keep active:** retain a note when its rationale, alternatives, negative guarantees, durable/wire semantics, ownership boundary, security rule, or reintroduction condition is likely to guide a future change. Length does not matter.
- **Implemented — archive:** archive a note when the shipped decision is complete and its body is unlikely to guide future work, such as one-off behavior, a narrow adapter, a minor closed bug, superseded implementation detail, or process history whose current behavior is obvious elsewhere.
- **Proposed — never archive:** keep a live proposal active; if it is no longer worth pursuing, reject it with an honest reason and satisfy the rejected lifecycle format.
- **Rejected — keep only as a guardrail:** retain a rejection only when the losing proposal remains a tempting, meaningful mistake and the note explains why it loses.
- **Rejected — delete:** delete the note when the rejected idea is obsolete, superseded, no longer plausible, or unlikely to prevent re-litigation. Repair or delete inbound links.

Do not archive toward a quota. Inspect every note in scope, classify analogous groups under one principle, use best judgment for close cases, and record genuinely borderline decisions for the handoff. As calibration for this repo: the two `implemented/` notes from 2026-07-22 remain active — the vconsole contract note owns a still-binding product contract (no-window-no-tools), and the lifecycle note owns the relay's liveness/ownership boundary.

## Archive one implemented note

1. Move the file from `implemented/{class}/` to `archived/{class}/`; `implemented` is deliberately absent from the archive path.
2. Make no body edits. Insert only `Archived: YYYY-MM-DD` immediately below `Status: implemented`, using the archival date.
3. Search for inbound links from active prose. Redirect them to current authority, retarget them to the archived path only when the historical snapshot is intentionally cited, or delete them. Never verify or repair links out of the archived note.

After the note is archived, never edit, move, translate, reformat, or delete it. Archived notes remain valid inbound-link targets but are historical snapshots, not authority for current behavior.

## Validate and report

Run `npm run check` and `git diff --check` for doc-only changes. Report active implemented notes kept, implemented notes archived, rejected notes kept/deleted, proposed notes rejected if any, and every genuinely borderline case with its word count and chosen outcome. Do not claim archived outbound links are valid: this repo has no archive verifier to check them.

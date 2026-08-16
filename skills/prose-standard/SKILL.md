---
name: prose-standard
description: Use when writing, reviewing, restoring, trimming, or auditing prose in the dota2-mcp repo, including deciding where documentation or comments are required across Markdown, JSDoc, code and test comments, tool descriptions, diagnostics, and CLI strings.
---

# dota2-mcp Prose Standard

Write enough to preserve the contract, then remove reasoning transcripts, repetition, and decoration. A contract is an obligation, invariant, precondition, postcondition, or compatibility promise that a caller, callee, implementer, producer, or consumer relies on. This skill owns editorial judgment and required prose coverage; use [doc-standards](../doc-standards/SKILL.md) for placement and the slop checklist, and [trim-cot-leakage](../trim-cot-leakage/SKILL.md) for hunting and fixing reasoning-transcript leakage. It is guidance, not a script.

Treat `contract`, `boundary`, `shape`, `surface`, `seam`, `gate`, and `vocabulary` as terms to check before use, not banned words. First ask whether the exact rule, API, field set, type, validation, timing point, or failure state names the fact better. Keep a term when it names the exact technical subject, including caller/callee contracts and security/process boundaries.

Comments describe non-obvious contracts or rationale that code cannot express; they do not restate what code already implies.

## Inputs and exclusions

Require an explicit `scope`. If it is missing, report the required input and stop; do not infer a repository-wide scope or begin an interview.

Accept `mode: automatic | interactive`; default to `automatic`. Enter interactive mode only when the user explicitly requests questions or calibration. `mode` controls questions, not write authority: review and audit tasks report findings without editing; explicitly requested write, fix, or trim tasks apply clear changes.

Always exclude `node_modules/` and `dist/` from discovery, review, and edits, even when the requested scope is the whole repository. `dist/` is a build artifact; edit the `.ts` source or owning doc instead. Also exclude archived Agent Notes: they are frozen snapshots; inspect an exact target only to understand a historical inbound citation, never to modernize its prose.

## Preserve the complete proposition

Before editing, identify every proposition in the passage. Preserve each relevant:

- actor and action;
- condition, timing, and ordering;
- modality such as must, may, or never;
- negative guarantee and exception;
- ownership, side effect, failure mode, and consequence.

Remove adjectives, repetition, and narration only when every factual clause survives and the result is clearer. A smaller word count alone is not an improvement.

Keep a complete local contract at the point of use: behavior, failure, ownership, and consequence that a caller or maintainer needs there. Aggressively link to the owning document for architecture, rationale, algorithms, history, or extended examples. One explanation has one home; essential contract facts may repeat locally.

Keep non-obvious rationale when omitting it could plausibly cause misuse or an incorrect simplification. Otherwise state the consequence and link the rationale home.

## Required coverage by prose location

This is not a one-way shortening pass. Add or restore prose when code, types, and structure do not communicate a required contract below. Do not add a comment when those facts are already obvious locally.

- **Public JSDoc:** document caller-visible return distinctions, throws or rejections, side effects, ownership, timing, cancellation, and durability.
- **Internal comments:** orient non-local structure and obviously complicated local structure, including invariants, race ordering, ownership, security boundaries, and surprising failure behavior. Delete control-flow narration and code restatement.
- **Module comments:** state the module's role, dependencies, responsibilities, and non-obvious architecture choices; link architecture choices to their owning explanation.
- **Tests (`scripts/*.mjs`):** explain only non-obvious test design — why a fixture, platform accommodation, real entry path, or indirect observation is necessary. Delete walkthroughs and inventories.
- **Skills:** state behavioral guardrails and explicit scope limitations such as "guidance, not a script/checklist". Keep the workflow concise and link its source of truth.
- **README:** include the consumer contract: configuration, semantics, failures, limitations, and extension points. Keep durable gaps and maintainer traps, not ordinary cleanup inventories. Do not restate internal protocol or implementation detail.
- **Agent Notes:** retain unique rationale, mechanisms, alternatives, consequences, shipped verification evidence, and named coverage gaps. Implemented Agent Notes state shipped reality in the present tense; remove planning checklists, not evidence of what pins the decision.
- **Tool descriptions (`src/index.ts`):** treat wording as behavior — the MCP client reads it to decide how to act. Name the exact console command and the failure state, and keep the prerequisite (e.g. "requires an open vconsole") visible.

Preserve searchable mechanism names and meaningful modal, temporal, or negative emphasis. Normalize decorative emphasis only.

## Workflow

1. Confirm the scope, mode, and the applicable `AGENTS.md` files (`docs/AGENTS.md` for documentation, root `AGENTS.md` for standing orders). Do not inspect unrelated branches.
2. Read the owning code or document before judging a passage.
3. Inspect the requested scope, not only the largest files. Use searches and word counts to find candidates, then judge passages semantically.
4. Classify each candidate as keep, add, trim, restore, restructure, or defer. Apply clear changes only when the task authorizes edits; do not manufacture edits to satisfy a deletion target.
5. Update the owner before derivative artifacts. Re-check analogous passages after learning a new rule.
6. Run the narrow relevant checks (`npm run check` for code, `git diff --check`). Verify the final diff contains no `dist/` or `node_modules/` path.
7. Report the inspected scope, clear changes, deliberate keeps, deferred cases, and checks actually run.

## Borderline decisions

A case is borderline only when at least two versions satisfy the complete-proposition rule but trade accepted principles, and this skill does not already resolve the tradeoff. A rewrite with one proposition-preserving answer is not borderline.

In automatic mode, apply clear edits when authorized and report genuine borderline cases without asking questions. Do not weaken a proposition to make progress.

In interactive mode, group analogous passages under the governing principle. Present two or three viable versions, recommend one, and state the factual or structural difference. Do not offer inferior distractors. After the user decides, apply the learned rule to every analogous passage in scope.

# Domain Docs

English | [中文](domain.zh.md)

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`AGENTS.md`** at the repo root — standing orders and conventions.
- **`.agents/notes/`** — the Agent Note corpus. Read the notes whose class (`architecture` / `feature` / `bug-fix` / `process` / `testing`) or topic touches the area you're about to work in. `implemented/` notes describe shipped reality in present tense; `proposed/` are under review; `rejected/` are frozen verdicts.
- **`CONTEXT.md`** at the repo root, if it exists — a glossary of domain terms. If absent, proceed silently.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront.

## File structure

Agent Notes are path-encoded as `{lifecycle}/{class}/yyyy-mm-dd-topic-title.md` under `.agents/notes/`:

```
.agents/notes/
├── README.md              ← format + lifecycle/classification rules
├── proposed/
│   └── <class>/…
├── implemented/
│   ├── architecture/…
│   ├── feature/…
│   └── …
├── rejected/
│   └── <class>/…
└── archived/
    └── <class>/…          ← frozen history, not current authority
```

Read `.agents/notes/README.md` for the full format (header block, per-lifecycle skeleton, mandatory Alternatives-considered).

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md` or `AGENTS.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for the author).

## Flag Agent Note conflicts

If your output contradicts an existing Agent Note, surface it explicitly rather than silently overriding:

> _Contradicts `.agents/notes/implemented/feature/2026-07-22-vconsole-contract-and-phase-guidance.md` — but worth reopening because…_

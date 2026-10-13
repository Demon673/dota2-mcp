# Domain Docs

English | [中文](domain.zh.md)

How the engineering skills consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **[GLOSSARY.md](../../GLOSSARY.md)** — domain terms and distinctions. Read it before naming domain concepts.
- **[AGENTS.md](../../AGENTS.md)** — standing orders and conventions.
- **[.agents/notes/](../../.agents/notes/README.md)** — decision records. Read active notes whose class or topic touches the area you're working in: `implemented/` describes shipped decisions, `proposed/` holds proposals under review, and `rejected/` preserves rejection rationale. Archived notes are historical snapshots.
- **[docs/i18n/terminology.md](../i18n/terminology.md)** — English ↔ Chinese translation choices. Load it when writing or updating bilingual prose.

If a referenced file is absent, proceed silently. `/domain-modeling` records resolved domain terms in [GLOSSARY.md](../../GLOSSARY.md) and decisions in [.agents/notes/](../../.agents/notes/README.md).

## File structure

Single-context repo: one root [GLOSSARY.md](../../GLOSSARY.md). Agent Notes live under `.agents/notes/` as `{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`; [the Agent Note rules](../../.agents/notes/README.md) define their format, lifecycle, and classification.

## Use the glossary's vocabulary

When an issue title, refactor proposal, hypothesis, or test name uses a domain concept, use the term and definition in [GLOSSARY.md](../../GLOSSARY.md). Follow its `_Avoid_` entries when choosing synonyms; follow [the translation table](../i18n/terminology.md) when rendering terms in Chinese.

If a needed concept is absent, check whether it belongs to this domain. Record a resolved domain term in [GLOSSARY.md](../../GLOSSARY.md).

## Flag Agent Note conflicts

If your output contradicts an active Agent Note, name and link that note and explain why the decision needs reconsideration.

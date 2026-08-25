# Post-mortems

English | [中文](README.zh.md)

Incident write-ups: a bug reached a place it shouldn't have (a real user, a merged change, a release), and the interesting part is *why our process let it through*, not just the one-line fix.

A post-mortem is NOT an [Agent Note](../../.agents/notes/README.md) (which records a deliberate design decision and its rejected alternatives, or proposes future work). It is a backward-looking record of a failure: what broke, the mechanism, why every safety net missed it, and the concrete guardrails added so the same class of bug fails loudly next time.

Write one when a bug is **subtle** (the mechanism is non-obvious and a careful engineer would re-derive it the hard way), **systemic** (the reason it escaped is a gap in tests/tooling/conventions, not a one-off typo), and **costly to rediscover** (it cost real debugging time, and would cost it again). Link the guardrails (tests, `AGENTS.md` rules, Agent Notes) the post-mortem motivated.

Every post-mortem opens with an **Executive summary**: one short paragraph a busy reader can absorb in thirty seconds — what broke, the root cause in plain terms, why it escaped, and the durable lesson — before the detailed Summary / Timeline / Root cause / Guardrails sections that follow.

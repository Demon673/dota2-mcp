# Agent Note: Root domain glossary

Status: implemented

English | [中文](2026-10-14-root-domain-glossary.zh.md)

## Problem

The domain workflow uses a translation table as its glossary. Translation choices do not define the concepts those words name, and engineering skills look for a root glossary when checking domain vocabulary.

## Decision

[GLOSSARY.md](../../../../GLOSSARY.md) owns domain definitions and preferred vocabulary. [The translation table](../../../../docs/i18n/terminology.md) owns English ↔ Chinese renderings; [Agent Notes](../../README.md) own decisions. [The domain workflow](../../../../docs/agents/domain.md) directs readers to each owner for its purpose.

The root glossary is an English/Chinese trio covered by the scoped and corpus-wide pairing checks. This extends the root-document scope described in [the doc-gates note](2026-08-29-root-docs-pairing-and-doc-gates.md).

## Alternatives considered

**Continue using the translation table as the glossary.** A translation mapping leaves domain definitions implicit and does not provide the root entry point engineering skills consume.

**Move translation policy into the glossary.** Domain definitions and translation rules serve different readers. Their separate homes keep each fact authoritative without duplicating the translation table.

## Consequences

Resolved domain concepts go in the root glossary; translation changes stay in the translation table. A glossary edit updates its counterpart and consistency record. Decision records retain the existing Agent Note layout.

## Testing

The pairing check rejects missing glossary siblings, stale records, and structural differences. The documentation budget, archive, and whitespace checks cover the surrounding instruction and note changes.

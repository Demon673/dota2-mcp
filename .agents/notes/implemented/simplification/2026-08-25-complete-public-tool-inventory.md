# Agent Note: Complete the README tool inventory to all 31 tools

English | [中文](2026-08-25-complete-public-tool-inventory.zh.md)

Status: implemented

## Problem

README.md "Available tools" listed 21 of 31 tools — missing vrf_ensure, asset_inspect, asset_check_refs, vfx_preview, vfx_preview_stop, the four file_* tools, and dota2_skill (all production symbols in src/index.ts). Two hand-maintained inventories mirrored the real authority (the src/index.ts registry): README (public, purpose-only) and AGENTS.md (agent-facing with console commands). The public copy had rotted.

## Decision

README.md's Available tools table now lists all 31 tools (both language tables). AGENTS.md keeps its agent-facing table with console commands per tool — the two tables serve different audiences per the tier taxonomy, and this note is the recorded sync obligation.

## Alternatives considered

- **README links to AGENTS.md instead of listing tools.** Rejected: README is the public contract and must stand alone for npm/GitHub readers.
- **Generate both tables from the registry.** Rejected for now: a catalog script is a larger investment than the drift it fixes; revisit if a third mirror appears.

## Consequences

The public contract shows every capability. The two tables remain hand-maintained for different audiences; the sync obligation lives here so the drift cannot silently recur.

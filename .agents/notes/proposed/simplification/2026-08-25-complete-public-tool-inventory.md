# Agent Note: Complete the README tool inventory to all 31 tools

English | [中文](2026-08-25-complete-public-tool-inventory.zh.md)

Status: proposed

## Problem

README.md "Available tools" (:241-290) lists 21 of 31 tools — missing vrf_ensure, asset_inspect, asset_check_refs, vfx_preview, vfx_preview_stop, the four file_* tools, and dota2_skill (all production symbols in src/index.ts). Two hand-maintained inventories mirror the real authority (the src/index.ts registry): README (public, purpose-only) and AGENTS.md (:193-256, agent-facing with console commands). The public copy has already rotted.

## Proposal

- Complete the README table to all 31 tools — the public contract must show every capability.
- Keep AGENTS.md's table as the agent-facing reference (console command per tool): the two tables serve different audiences per the tier taxonomy. Record the sync obligation here so the drift cannot silently recur.

## Alternatives considered

- **README links to AGENTS.md instead of listing tools.** Rejected: README is the public contract and must stand alone for npm/GitHub readers.
- **Generate both tables from the registry.** Rejected for now: a catalog script is a larger investment than the drift it fixes; revisit if a third mirror appears.

## Acceptance criteria

- README table has 31 rows matching src/index.ts's server.tool registrations; AGENTS.md unchanged except possibly a link note.

## Risks

- None observable: adding ten rows of public documentation.

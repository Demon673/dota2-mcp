# Agent Note: dota2-vfx / dota2-model skills and sectioned retrieval

English | [中文](2026-08-20-vfx-model-skills.zh.md)

Status: implemented

## Problem

Agents needed built-in format knowledge for the vfx/model toolchain (map #9): how to write .vpcf/.vmdl/.vmat KV3, and how the nine tools compose into a workflow. The #9 resolution also warned that full-content skills make the dota2_skill full-body return too heavy.

## Decision

Two built-in skills ship under `skills/`: `dota2-vfx` (particles: KV3 structure verified against a real basic-template addon, C_OP_*/C_INIT_* vocabulary, pipeline mental model, SOP, tool map, error table, minimal template) and `dota2-model` (vmdl/vmat/vtex, same shape; model validation is compile + inspect + refs + load errors — no preview tool by design, map #7). Shared pipeline/SOP sections are duplicated per skill by the #9 resolution (self-containment over DRY). The 完整字段参考 sections carry TODO(rare) markers: everyday work is covered, the full Valve-wiki field tables are filled in later slices.

`dota2_skill` gains `section` (return one `##` section) and `outline` (list headings) parameters; the full body remains the default for small skills.

## Alternatives considered

- **One combined skill.** Rejected in map #9: the user chose two skills with duplicated shared sections.
- **Truncate long bodies silently.** Rejected: sectioned retrieval is explicit and lossless; silent truncation hides content.

## Consequences

- Skills exposed by dota2_skill: dota2-game-phases, dota2-model, dota2-runtime-dev, dota2-vfx.
- The word-for-word field tables (字面全量) remain open work tracked by TODO(rare) inside the two skills.

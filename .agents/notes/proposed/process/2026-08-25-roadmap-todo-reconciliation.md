# Agent Note: Reconcile the AGENTS.md TODO section with the roadmap spec and shipped 1.6.0

English | [中文](2026-08-25-roadmap-todo-reconciliation.zh.md)

Status: proposed

## Problem

AGENTS.md "TODO — Roadmap" (:336-343) contradicts both the new roadmap spec (docs/superpowers/specs/2026-08-05-roadmap-design.md) and shipped reality: BuildTools still lists the full plan the spec "缩水"-ed (:16); "[ ] Claude MCP configuration" is already done (README per-client configuration); FileOps/AssetInspector are marked [x] landed, which post-dates the spec's "砍 / 保留（2.0）" verdicts; the spec's own 1.6 row plans dota_map_error + verification cleanup while 1.6.0 actually shipped the asset tooling (wayfinder map #4). The spec mandates "AGENTS.md 的 TODO 段收敛为一行指针「开发路线见 docs/ROADMAP.md」" (:5, :72), and docs/ROADMAP.md does not exist yet.

## Proposal

- Once the user refreshes the roadmap spec to match shipped 1.6.0 (its 1.6 row and FileOps/AssetInspector verdicts are pre-wayfinder), fold AGENTS.md TODO lines 336-343 into the one-line pointer to docs/ROADMAP.md the spec mandates, and create docs/ROADMAP.md from the spec's 版本总览 (bilingual per the docs/ pairing contract).
- Immediately safe sub-step: delete the "[ ] Claude MCP configuration" line (README already documents all clients).

## Alternatives considered

- **Update AGENTS.md TODOs in place without a roadmap doc.** Rejected: the spec owns the convergence decision; a second hand-maintained list re-creates the drift.
- **Do nothing until the roadmap lands.** Rejected for the Claude MCP configuration line, which is already false today.

## Acceptance criteria

- AGENTS.md TODO section is one pointer line; docs/ROADMAP.md exists; no TODO line restates a shipped feature or the spec's verdicts.
- The roadmap spec's 1.6 row reflects shipped reality (or the spec is marked historical).

## Risks

- The roadmap spec is the user's active design doc; changes to it need the user's call. This note only proposes the reconciliation once they refresh it.

# Agent Note: Stop shipping the unreachable field-level particle reference in skills/

English | [中文](2026-08-25-slim-skills-payload.zh.md)

Status: implemented

## Problem

skills/ shipped 2,431,997 bytes via files[] "skills/**/*". 95.4% of it was the particle field-level reference: class-ref/*.md (9 volumes), vpcf-class-fields.json (1.68 MB, one physical line), appendix-unused.md. The only reader of skills/ is dota2_skill, whose data handler lists and reads only top-level data files — class-ref/ was a subdirectory, so its files were unreachable, and vpcf-class-fields.json, though reachable, returned 1.68 MB in a single MCP text result with no per-class access or search.

## Decision

The field-level reference moved out of the npm package: skills/dota2-vfx/data/class-ref/ (with appendix-unused.md) and vpcf-class-fields.json now live under research/vpcf-field-reference/, which files[] does not ship; the moved README's links are repaired to point at the new homes. SKILL.md's data section no longer advertises unreachable data paths — it points at research/vpcf-field-reference/ and notes the 143 unused schema classes. The reachable vpcf-stats.json + vpcf-official-findings.md (and the dota2-model pair) stay shipped, and research/README.md's inventory reflects the move.

## Alternatives considered

- **Teach dota2_skill subdirectory support.** Rejected: it would make 1.7 MB of field tables returnable per request — the opposite of the sectioned-retrieval decision (wayfinder #9) that keeps bodies light.
- **Keep shipping; it is already paid for.** Rejected: it cost every npm install ~2.3 MB and advertised data paths that returned errors.

## Consequences

The npm tarball drops ~2.3 MB (~95% of skills/): class-ref/*.md, vpcf-class-fields.json, and appendix-unused.md are no longer per-install weight, and dota2_skill no longer ships a 1.68 MB blob or unreachable subdirectory paths. The reference stays in-repo for regeneration (reproduction steps preserved in its README).

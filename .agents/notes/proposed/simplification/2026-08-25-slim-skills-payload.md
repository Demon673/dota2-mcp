# Agent Note: Stop shipping the unreachable field-level particle reference in skills/

English | [中文](2026-08-25-slim-skills-payload.zh.md)

Status: proposed

## Problem

skills/ ships 2,431,997 bytes via files[] "skills/**/*". 95.4% of it (2,320,640 B) is the particle field-level reference: class-ref/*.md (9 volumes, 638,868 B), vpcf-class-fields.json (1,681,772 B, one physical line), appendix-unused.md (18 KB). The only reader of skills/ is dota2_skill, whose data handler (src/index.ts:529-534, :541) lists and reads only top-level data files — class-ref/ is a subdirectory, so all 11 files are unreachable (data='list' hides them; data='class-ref/operators.md' returns "Unknown data file"), and vpcf-class-fields.json, though reachable, returns 1.68 MB in a single MCP text result with no per-class access or search — impractical for a model. The owning note (2026-08-20-vfx-model-skills.md:13) records the full tables as "TODO(rare) later slices", and reproduction is manual and documented (class-ref/README.md:164-184) with no committed generator.

## Proposal

- Move skills/dota2-vfx/data/class-ref/ (including appendix-unused.md) and vpcf-class-fields.json to research/ (files[] does not ship research/), keeping the reproduction README with them.
- Rewrite SKILL.md:121-128: drop the class-ref path advertisement and the 1.6 MB JSON ad; keep one pointer line (full field reference lives in research/; 143 schema classes are unused by official content).
- Keep the reachable, small vpcf-stats.json + vpcf-official-findings.md (and the dota2-model pair) in skills/.

## Alternatives considered

- **Teach dota2_skill subdirectory support.** Rejected: it would make 1.7 MB of field tables returnable per request — the opposite of the sectioned-retrieval decision (wayfinder #9) that keeps bodies light.
- **Keep shipping; it is already paid for.** Rejected: it costs every npm install ~2.3 MB and advertises data paths that return errors.

## Acceptance criteria

- npm pack tarball no longer contains class-ref/ or vpcf-class-fields.json; dota2_skill data='list' output unchanged in its reachable set.
- SKILL.md no longer advertises unreachable data paths; research/ holds the reference with its README.

## Risks

- Anyone importing the shipped field JSON directly from node_modules loses it — no such consumer exists in repo or docs; research/ stays in-repo for regeneration.

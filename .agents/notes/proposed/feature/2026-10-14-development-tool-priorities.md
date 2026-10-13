# Agent Note: CustomGame development tool priorities

Status: proposed

English | [中文](2026-10-14-development-tool-priorities.zh.md)

## Problem

The [CustomGame integration investigation](../../../../research/2026-10-14-dota2-ai-integration.md) identifies several possible extensions, but their development value and implementation certainty differ. A capability list alone does not establish what to build first. Priorities should reflect routine developer tasks, saved manual work, and evidence that the integration can work.

## Proposal

Prioritize tools that connect engine output, resources, or runtime observations to the source a developer edits. Reuse client file and terminal tools, the existing console connection, and Valve/VRF utilities. This proposal records development order; it does not authorize implementation. P0 means first in this queue, not a release blocker. Priority labels here do not change the repository's FIXME/TODO/XXX semantics.

| Priority / order | Capability | Development value | First scope |
|---|---|---|---|
| P0 / 1 | TSTL runtime error mapping | Locate the TypeScript source behind a generated Lua error without manual bundle inspection | Follow the existing [dota_map_error proposal](2026-08-05-dota-map-error-tool.md): artifact path and error line → source file, line, and context. Report missing mappings, stale or unverified artifacts, unsupported formats, and ambiguous filenames explicitly |
| P1 / 2 | Resource path lookup and reading, including VPK entries | Find actual models, textures, sounds, and other resources; distinguish a missing loose file from a missing resource | Resolve addon and official loose files first; use VRF for archive search and selected-entry reading/extraction. Connect results to existing asset tools; report archive checks that were not performed |
| P1 / 3 | Map entity reading and queries | Find spawn points, triggers, entity names, positions, and properties without manually inspecting a large converted map | Convert a copy with dmxconvert and filter by classname/targetname. Read only; no map write-back |
| P2 / 4 | Runtime Panorama panel inspection | Diagnose panels that are absent, clipped, or styled incorrectly using runtime evidence | First verify available commands and readable output; then inspect a selected addon subtree. Reuse client screenshot capabilities |
| P2 / 5 | Particle preview owner and multiple control points | Preview beams and entity attachments without repeatedly writing setup Lua | Extend existing vfx_preview parameters; verify owner and CP behavior against actual effects |
| P3 / 6 | Resource build freshness check | Identify whether a source resource needs rebuilding | Verify resourcecompiler's -dependency_check_only output and exit behavior, then consider an option on the existing compile tool |

The first implementation group is error mapping plus resource lookup. Map queries follow. Investigate Panorama feasibility early; if the existing console path provides stable panel or render-tree output, promote panel inspection to P1 ahead of map queries. That promotion requires live evidence, not strings found in a binary.

Scope ownership remains with the existing [error mapping proposal](2026-08-05-dota-map-error-tool.md), [asset inspection note](../../implemented/feature/2026-08-20-asset-inspect.md), [reference checking note](../../implemented/feature/2026-08-20-asset-check-refs.md), and [particle preview note](../../implemented/feature/2026-08-20-vfx-preview.md). This ordering does not supersede those records or promise that the proposed extensions already exist.

## Alternatives considered

**Wrap ordinary builds and file edits in more MCP tools.** Client terminal and file tools already handle these tasks. Add only the missing engine operation or diagnostic, rather than another BuildTools layer.

**Prioritize business snapshots, scenario frameworks, balance testing, or in-game AI applications.** These require specific project needs and often project-maintained code. They do not provide the general development value targeted by this queue.

**Start with map write-back or full editor automation.** Map conversion has only been demonstrated on a template copy; editor automation interfaces remain unconfirmed. Neither has enough evidence to precede the smaller read and diagnostic operations.

## Acceptance criteria

- Error mapping identifies the correct source location for a real TSTL runtime error and has offline checks for missing, unsupported, stale, and ambiguous mappings. Mapping availability depends on the actual build artifacts; do not assume every TSTL output contains a map.
- Resource lookup reports where an entry was found and which sources were checked. It handles loose and packed resources without classifying an unchecked archive entry as missing, and reuses the pinned VRF version after verifying its options.
- Map queries return the requested entities and properties from representative source maps while leaving originals untouched. Conversion failures and unsupported versions are explicit.
- Panorama implementation starts only after live verification establishes usable output in the target context. Particle preview changes require live owner/CP and visual verification; freshness checks require observed up-to-date and rebuild-needed cases.
- Each implemented capability demonstrates fewer manual steps or previously unavailable evidence. Retain native workflows when a dedicated tool adds no practical value.

## Risks

TSTL mapping formats vary; stale outputs and source basenames can make a location ambiguous. Static mapping must not depend on runtime traceback support.

The resource inventory reflects one installation and does not prove complete coverage. Archive presence does not prove the engine mounts or renders that resource, and extraction does not guarantee a complete editable project.

The observed map conversion changes the vmap format version from 20 to 40 and is not byte-identical on reverse encoding. Successful conversion does not establish safe write-back, compilation, or loading.

Panorama strings do not prove command registration or accessibility. Editor DLLs do not prove the absence of automation interfaces. Missing evidence keeps these integrations conditional.

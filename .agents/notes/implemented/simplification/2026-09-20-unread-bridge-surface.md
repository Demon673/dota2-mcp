# Agent Note: Delete the unread VCon bridge surface and the unused VRF byte count

English | [中文](2026-09-20-unread-bridge-surface.zh.md)

Status: implemented

## Problem

An audit of the relay and bridge layer found four pieces of surface with no reader:

1. `VrfInfo.downloadedBytes` (`vrf-ensure.ts`) is written on the fresh-install path and read nowhere; `scripts/test-vrf-ensure.mjs` asserts `ok`/`cached`/`sha256Ok`/`executable`/`message` field by field, with no key-set comparison.
2. `AinfMessage` is imported by `vcon-relay.ts` and never referenced — the `ainf` handler takes an untyped parameter and gets its type by inference from `VConClientEvents`.
3. `VConClient.get connected()` has no caller. Every `.connected` occurrence in the tree belongs to `RelayClient`'s own field, and the `connected` *event* is the surface the relay actually subscribes to.
4. `VConClientEvents.cvrb` / `cfgv` have zero subscribers. `_dispatch` emitted them for frames that `rawFrame` had already delivered one line earlier, so the relay's GUI forwarding and its `INIT_FRAME_TYPES` replay cache never depended on them.

The same audit found two notes misstating the connect gate. The lifecycle note's Decision read "the relay **holds Dota 2 `:29000` constantly … no on-demand connection**", and it listed on-demand connect among the rejected alternatives, while `vcon-relay.ts` gates the connect on `_guiConnected`. The contract note's Consequences justified the window prerequisite as "a deliberate contract, not a technical necessity (29000 itself needs no GUI)" — true of the engine's listener, which the readiness probe connects to with no window open, but silent on the relay gate that refuses one layer up.

## Decision

The four unread members are deleted: `downloadedBytes`, the `AinfMessage` import, `get connected()`, the two event members and their `_dispatch` arms. CVRB/CFGV frames keep reaching the relay through `rawFrame`, so the init-frame replay and GUI forwarding are untouched.

Both notes now state the GUI-gated connect — the model `vcon-relay.ts` implements and `AGENTS.md` documents. The lifecycle note carries it in its title, Decision, and Alternatives; the contract note's clause names the relay's connect gate instead of implying 29000 is ungated.

## Alternatives considered

- **Delete every parsed-but-unread wire field too** (`PrntMessage.channelId/color/millisecondTime`, `AinfMessage.productCRC32/gameDir/platformFlags`, `AdonMessage.totalAddons/enabledAddons`, `FrameHeader.handle`, `ChannelInfo`'s unknowns) — rejected: those declarations are the wire-format model of `vcon-bridge.ts`, which `package.json` publishes under `dist/tools/**` as the reusable low-level VConsole2 client. Removing a declaration removes its read, leaving a positional offset with no name; the saving is about 25 declaration lines against a leaner protocol model. Revisit if the module stops being published.
- **Keep `cvrb`/`cfgv` as a hook for future raw-CVar work** — rejected: `rawFrame` already carries every frame type to the relay, so a subscriber can be added in the same commit as the consumer that needs it.

## Consequences

Fifteen lines leave `src/`, and no behavior changes: the four members were unreachable from the single `VConClient` construction site and from every consumer of `ensureVrf`. The published `.d.ts` for `vrf-ensure` and `vcon-bridge` shrinks by the same members — a break only for a deep-path importer of `dist/tools/**`, of which none exists in-repo.

## Testing

`npm run check` is the evidence that no reference survived: `tsc --noEmit` resolves every identifier, so a missed reader fails the type check. `scripts/test-relay.mjs` (init-frame replay, probe keep-alive, probe-line filtering), `scripts/test-daemon.mjs`, `scripts/test-mcp-offline.mjs`, `scripts/test-fileops.mjs`, and `scripts/test-archived-notes.mjs` pass unchanged.

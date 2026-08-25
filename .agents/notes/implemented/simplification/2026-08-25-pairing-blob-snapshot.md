# Agent Note: Drop the pairing gate's git-object snapshot persistence

English | [中文](2026-08-25-pairing-blob-snapshot.zh.md)

Status: implemented

## Problem

scripts/lib/git.mjs's storeGitBlob persisted blob objects (git hash-object -w) and created refs/dota2-mcp/translation-pairing/snapshots/<hash> refs that nothing ever read back. The pairing contract (docs/i18n/README.md) records blob hashes only — "computable for uncommitted files", "pure content comparison" — and --write used storeGitBlob solely to obtain the same 40-hex hash the pure-JS gitBlobHash computes. The persistence also leaked dangling refs that would be pushed to remotes.

## Decision

scripts/lib/git.mjs now contains only gitBlobHash; runGit, storeGitBlob, SNAPSHOT_REF_PREFIX, GIT_COMMAND_MAX_BUFFER, and the spawnSync import are deleted. verify-translation-pairing.mjs computes both side hashes with gitBlobHash — no git objects are written and no refs are created under refs/dota2-mcp anymore.

## Alternatives considered

- **Keep the snapshots as a recovery store.** Rejected: nothing recovered from them (no cat-file reader existed), the i18n.yaml record already holds the hash needed to detect drift, and git itself preserves committed bytes.

## Consequences

The .i18n.yaml records are byte-identical (same blob hashes); the only removed behavior is the write of unreferenced git objects/refs.

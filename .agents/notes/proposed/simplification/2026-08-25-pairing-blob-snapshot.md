# Agent Note: Drop the pairing gate's git-object snapshot persistence

English | [中文](2026-08-25-pairing-blob-snapshot.zh.md)

Status: proposed

## Problem

scripts/lib/git.mjs's storeGitBlob (:44-58) persists blob objects (git hash-object -w) and creates refs/dota2-mcp/translation-pairing/snapshots/<hash> refs that nothing ever reads back (grep: zero readers). The pairing contract (docs/i18n/README.md:11-27) records blob hashes only — "computable for uncommitted files", "pure content comparison" — and --write (verify-translation-pairing.mjs:196-197) uses storeGitBlob solely to obtain the same 40-hex hash the pure-JS gitBlobHash (:10-15) computes. The persistence also leaks dangling refs that would be pushed to remotes.

## Proposal

- Replace the two storeGitBlob calls with gitBlobHash at verify-translation-pairing.mjs:196-197.
- Delete runGit, storeGitBlob, SNAPSHOT_REF_PREFIX, GIT_COMMAND_MAX_BUFFER, and the spawnSync import from git.mjs (~30 lines).

## Alternatives considered

- **Keep the snapshots as a recovery store.** Rejected: nothing recovers from them (no cat-file reader exists), the i18n.yaml record already holds the hash needed to detect drift, and git itself preserves committed bytes.

## Acceptance criteria

- verify-pairs --write re-records hashes identical to before; --check still validates all pairs.
- git.mjs contains only gitBlobHash; no new refs appear under refs/dota2-mcp.

## Risks

- None observable: the yaml record content is unchanged (same hashes); only the side effect of writing git objects/refs disappears.

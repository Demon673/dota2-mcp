---
name: release
description: 'Use when preparing or publishing a release: measuring changes against the previous tag, writing the changelog pair, creating or moving the version tag, assembling bilingual release notes, or auditing tag/changelog consistency.'
---

# Preparing a release

A release turns a commit range into a promise: one version, one tag, one user-facing story. The changelog is part of that promise, not a separate document.

## 1. Fix the range

- Read the repository's release contract: `package.json` version, `CHANGELOG.md` / `CHANGELOG.zh.md`, the release workflow, and the gate list.
- Fetch tags (`git fetch --tags`). The range is `<previous-tag>..<next-tag>`; the next tag is `vX.Y.Z`.
- List commits (`git log --oneline`) and the net diff (`git diff --stat`). The net diff is authoritative.
- Include only changes a user of the published package can perceive. Exclude changes introduced and reverted inside the range, WIP not in the tag, internal refactors, tests, CI and build tooling.
- Every changelog entry must be traceable to the range. Drop entries with no support; add user-visible changes with no entry.

## 2. Write the changelog

```
## <version> (<YYYY-MM-DD>)
### Added | Changed | Fixed | Removed | Security
- **<outcome>**: <one or two sentences>
```

- Newest first; dates match the tag; one `##` per version; categories in order, only non-empty, never repeated.
- One bullet per independent change; no blank lines between bullets, no nested lists; at most one table per version.
- The bold lead names the tool, feature, or symptom; after the colon, the user-visible result.
- In: what users can do now, what changed, what no longer breaks; tool and parameter names; measured limits that are part of the contract.
- Out: class and function names, file paths, protocol frames, queues, caches, state directories, test script names, CI steps, commit hashes, Agent Note links, root-cause narration.
- For fixes: the symptom first, then the new behavior.
- The English and Chinese files are two language zones with the same structure and facts; neither summarizes the other. Re-record the pair with `npm run verify-pairs -- --write CHANGELOG.md`.

## 3. Own the tag

- A released version has one annotated tag `vX.Y.Z` on the release commit; heading, tag and `package.json` version agree.
- The top entry may be `## X.Y.Z (unreleased)` while work is in progress; releasing replaces it with the date and creates the tag.
- Moving a tag is allowed only before the release is published and with the old tag deleted; never leave two tags for one version.
- Run the repository's tag gate (`npm run verify-changelog-tags`) before publishing.

## 4. Assemble release notes

Use the two language zones explicitly:

```
## 中文
<version section from CHANGELOG.zh.md>

## English
<version section from CHANGELOG.md>
```

The release title names the version and the main user-facing theme.

## 5. Verify before publishing

- Run the repository gates: typecheck, pairing, budgets, tag gate, archived notes.
- Build and run the release smoke set; package the artifact and start it once.
- Run `npm pack --dry-run` and check the file list and size.
- Check the registry version and auth (`npm view <name> version`, `npm whoami`); publishing needs a login or token.

## 6. Publish in order

1. Push the release commit.
2. Create the tag and release; the repository's workflow builds and uploads artifacts.
3. Wait for CI and verify every platform asset and the packaged binary.
4. Set the release body from both changelog zones.
5. Publish the package by the repository's path; verify the registry version.
6. Report the tag, release URL, artifacts and registry version.

## Correcting history

When rewriting old entries, measure each version from its own tag range; fix headings that do not match a tag (for example, a heading left `unreleased` after a tag was cut). Preserve shipped user-visible facts; never invent history.

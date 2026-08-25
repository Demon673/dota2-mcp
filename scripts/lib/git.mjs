// lib/git.mjs — git-blob operations owned by the bilingual pairing workflow.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const SNAPSHOT_REF_PREFIX = 'refs/dota2-mcp/translation-pairing/snapshots'
const GIT_COMMAND_MAX_BUFFER = 1 << 26

/** Full SHA-1 git blob hash (the 40-hex format used by pairing records). */
export function gitBlobHash(content) {
  const hash = createHash('sha1')
  hash.update(`blob ${content.byteLength}\0`)
  hash.update(content)
  return hash.digest('hex')
}

/**
 * Run one git subprocess and return its exact stdout bytes.
 * @param {string} root - Repository root used as git's working directory.
 * @param {string[]} args - Arguments following the `git` executable.
 * @param {string} operation - Human-readable operation for failure diagnostics.
 * @param {Buffer} [input] - Optional stdin bytes.
 */
export function runGit(root, args, operation, input) {
  const result = spawnSync('git', ['-C', root, ...args], {
    input,
    maxBuffer: GIT_COMMAND_MAX_BUFFER,
  })
  if (result.error) {
    throw new Error(`${operation} failed: ${result.error.message}`, { cause: result.error })
  }
  if (result.status !== 0) {
    throw new Error(`${operation} failed with status ${String(result.status)}: ${result.stderr.toString('utf8').trim()}`)
  }
  return result.stdout
}

/**
 * Persist exact working-tree bytes so a pairing record can later recover them
 * with `git cat-file`, even when they have never appeared in the index or a
 * commit. The returned object id is checked against the pairing format's own
 * content hash before the caller writes a sidecar.
 */
export function storeGitBlob(root, content) {
  const expected = gitBlobHash(content)
  const stored = runGit(root, ['hash-object', '-w', '--stdin'], 'git hash-object -w --stdin', content)
    .toString('utf8')
    .trim()
  if (stored !== expected) {
    throw new Error(`git hash-object -w --stdin returned unexpected object id ${JSON.stringify(stored)}; expected ${expected}`)
  }
  runGit(
    root,
    ['update-ref', `${SNAPSHOT_REF_PREFIX}/${stored}`, stored],
    'git update-ref for translation snapshot',
  )
  return stored
}

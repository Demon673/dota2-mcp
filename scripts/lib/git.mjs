// lib/git.mjs — git-blob hash owned by the bilingual pairing workflow (pure JS, no git objects/refs written).

import { createHash } from 'node:crypto'

/** Full SHA-1 git blob hash (the 40-hex format used by pairing records). */
export function gitBlobHash(content) {
  const hash = createHash('sha1')
  hash.update(`blob ${content.byteLength}\0`)
  hash.update(content)
  return hash.digest('hex')
}

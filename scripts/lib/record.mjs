// lib/record.mjs — canonical paths, parsing, and rendering for bilingual pairing records.

import { basename } from 'node:path'

/** The three repository-relative paths that form one bilingual pair. */
export function translationPairPaths(source) {
  if (!source.endsWith('.md') || source.endsWith('.zh.md')) {
    throw new Error(`expected an English Markdown path, received ${JSON.stringify(source)}`)
  }
  return {
    source,
    zh: source.replace(/\.md$/, '.zh.md'),
    meta: source.replace(/\.md$/, '.i18n.yaml'),
  }
}

const META_LINE = /^([^:#]+\.md): ([0-9a-f]{40})$/

/**
 * Parse a consistency record for its expected sibling names. Returns the two
 * hashes, or `undefined` for malformed, duplicate, or unexpected keys.
 */
export function parseTranslationPairingRecord(content, paths) {
  const hashes = new Map()
  for (const line of content.split('\n')) {
    if (line === '' || line.startsWith('#')) continue
    const match = META_LINE.exec(line)
    if (!match?.[1] || !match[2] || hashes.has(match[1])) return undefined
    hashes.set(match[1], match[2])
  }
  const sourceHash = hashes.get(basename(paths.source))
  const zhHash = hashes.get(basename(paths.zh))
  if (hashes.size !== 2 || sourceHash === undefined || zhHash === undefined) return undefined
  return { sourceHash, zhHash }
}

/**
 * Render the canonical consistency record for a pair, with exactly one trailing newline.
 */
export function renderTranslationPairingRecord(paths, record) {
  return [
    '# Bilingual-pair consistency record (docs/i18n/README.md): the git blob hash of each',
    '# side as of the last confirmed-consistent state. Both languages carry equal authority;',
    '# after editing either side, bring the other along and re-record with:',
    `#   node scripts/verify-translation-pairing.mjs --write ${paths.source}`,
    `${basename(paths.source)}: ${record.sourceHash}`,
    `${basename(paths.zh)}: ${record.zhHash}`,
    '',
  ].join('\n')
}

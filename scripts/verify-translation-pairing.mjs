#!/usr/bin/env node
// verify-translation-pairing.mjs — enforce complete English/Chinese pairs, matching
// structure, and recorded git blob hashes for every in-scope document. The manifest
// contains only explicit exclusions, which may have neither a counterpart nor a sidecar.
// `--list` reports state; `--write <pairs...>` records the named confirmed pairs
// (`--write --all` records every complete pair); the no-flag run is the corpus-wide check.
// Translation quality remains a review responsibility.
// See `docs/i18n/README.md` for the owning contract.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitBlobHash } from './lib/git.mjs'
import {
  parseTranslationPairingRecord,
  renderTranslationPairingRecord,
  translationPairPaths,
} from './lib/record.mjs'
import { linksTo, parseMarkdown, structureSignature } from './lib/markdown.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = join(root, 'scripts', 'translation-pairing.manifest.json')

// ---- manifest ---------------------------------------------------------------

function parseManifest(content) {
  const value = JSON.parse(content)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('translation-pairing.manifest.json: expected an object')
  }
  const unsupported = Object.keys(value).filter((field) => field !== 'excluded')
  if (unsupported.length > 0) {
    throw new Error(`translation-pairing.manifest.json: unsupported field(s): ${unsupported.join(', ')}; every in-scope document is required`)
  }
  const excluded = value.excluded
  if (!Array.isArray(excluded) || !excluded.every((entry) => typeof entry === 'string')) {
    throw new Error('translation-pairing.manifest.json: excluded must be an array of strings')
  }
  return { excluded }
}

// ---- scope ------------------------------------------------------------------

function isExcluded(file, excluded) {
  return excluded.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry))
}

function isScopeFile(file) {
  if (file === 'README.md' || file === 'CHANGELOG.md') return true
  return (file.startsWith('.agents/notes/') || file.startsWith('docs/'))
    && !file.startsWith('.agents/notes/archived/')
}

// ---- discovery ---------------------------------------------------------------

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (e.name.endsWith('.md') || e.name.endsWith('.i18n.yaml')) out.push(full)
  }
  return out
}

function discoverCorpus() {
  const files = new Set()
  for (const dir of ['.agents/notes', 'docs']) {
    for (const full of walk(join(root, dir))) {
      const rel = relative(root, full).split(sep).join('/')
      if (isScopeFile(rel)) files.add(rel)
    }
  }
  for (const rootFile of ['README.md', 'CHANGELOG.md']) {
    if (isScopeFile(rootFile)) files.add(rootFile)
  }
  return [...files]
}

// ---- CLI args ----------------------------------------------------------------

function pairAnchorOfArgument(argument) {
  const normalized = argument.split('\\').join('/').replace(/^\.\//, '')
  if (normalized.endsWith('.zh.md')) return `${normalized.slice(0, -'.zh.md'.length)}.md`
  if (normalized.endsWith('.i18n.yaml')) return `${normalized.slice(0, -'.i18n.yaml'.length)}.md`
  if (normalized.endsWith('.md')) return normalized
  return `${normalized}.md`
}

function parseCliArgs(argv) {
  const flags = argv.filter((argument) => argument.startsWith('--'))
  const anchors = [...new Set(argv.filter((argument) => !argument.startsWith('--')).map(pairAnchorOfArgument))].sort()
  const unknown = flags.filter((flag) => !['--list', '--write', '--all'].includes(flag))
  if (unknown.length > 0) throw new Error(`unknown flag(s): ${unknown.join(', ')}`)
  const listMode = flags.includes('--list')
  const writeMode = flags.includes('--write')
  const allMode = flags.includes('--all')
  if (listMode && (writeMode || allMode || anchors.length > 0)) {
    throw new Error('--list reports the whole corpus and takes no other flags or paths')
  }
  if (allMode && !writeMode) throw new Error('--all only applies to --write')
  if (writeMode) {
    if (anchors.length > 0 && allMode) throw new Error('--write takes either pair paths or --all, not both')
    if (anchors.length === 0 && !allMode) {
      throw new Error('--write requires the pair(s) you confirmed (any file of a pair), or --all to re-record every complete pair; recording pairs you did not review blesses unconfirmed content')
    }
    return { mode: 'write', scope: allMode ? 'corpus' : 'pairs', anchors }
  }
  if (listMode) return { mode: 'list', scope: 'corpus', anchors: [] }
  return { mode: 'check', scope: anchors.length > 0 ? 'pairs' : 'corpus', anchors }
}

// ---- structure diff -----------------------------------------------------------

function show(value) {
  if (value === undefined) return 'nothing'
  const text = JSON.stringify(value)
  return text.length > 72 ? `${text.slice(0, 72)}…` : text
}

function structureDiff(source, zh) {
  const out = []
  const fields = [
    ['heading (depth)', source.headings, zh.headings],
    ['code block', source.code, zh.code],
    ['table (row x column count)', source.tables, zh.tables],
    ['list (kind, start, item count)', source.lists, zh.lists],
    ['link target', source.links, zh.links],
  ]
  for (const [field, sourceValues, zhValues] of fields) {
    const length = Math.max(sourceValues.length, zhValues.length)
    for (let index = 0; index < length; index++) {
      if (sourceValues[index] !== zhValues[index]) {
        out.push(`${field} #${index + 1} diverges between the pair: ${show(sourceValues[index])} vs ${show(zhValues[index])}`)
        break
      }
    }
  }
  return out
}

// ---- main ----------------------------------------------------------------------

const manifest = parseManifest(readFileSync(MANIFEST_PATH, 'utf8'))
let request
try {
  request = parseCliArgs(process.argv.slice(2))
} catch (error) {
  console.error(`verify-translation-pairing: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}

function repositoryFileExists(file) {
  return existsSync(join(root, file))
}
function readRepositoryFile(file) {
  return readFileSync(join(root, file))
}

// Enumerate the scope: the whole corpus, or exactly the named pairs' files.
const files = new Set()
if (request.scope === 'pairs') {
  for (const anchor of request.anchors) {
    if (!isScopeFile(anchor) || isExcluded(anchor, manifest.excluded)) {
      console.error(`verify-translation-pairing: ${anchor} is not an in-scope pair (excluded or outside the documentation corpus; see docs/i18n/README.md)`)
      process.exit(2)
    }
    const { source, zh, meta } = translationPairPaths(anchor)
    for (const file of [source, zh, meta]) {
      if (repositoryFileExists(file)) files.add(file)
    }
  }
} else {
  for (const file of discoverCorpus()) files.add(file)
}

const sources = [...files].filter((f) => f.endsWith('.md') && !f.endsWith('.zh.md')).sort()
const translations = [...files].filter((f) => f.endsWith('.zh.md')).sort()
const metas = [...files].filter((f) => f.endsWith('.i18n.yaml')).sort()

// --write: (re)record both hashes for the requested complete pairs.
if (request.mode === 'write') {
  let written = 0
  for (const source of sources) {
    if (isExcluded(source, manifest.excluded)) continue
    const paths = translationPairPaths(source)
    if (!repositoryFileExists(source) || !repositoryFileExists(paths.zh)) {
      if (request.scope === 'pairs') {
        console.error(`verify-translation-pairing: cannot record ${source}: missing ${repositoryFileExists(source) ? paths.zh : source}`)
        process.exit(2)
      }
      continue
    }
    const record = renderTranslationPairingRecord(paths, {
      sourceHash: gitBlobHash(readRepositoryFile(source)),
      zhHash: gitBlobHash(readRepositoryFile(paths.zh)),
    })
    if (existsSync(join(root, paths.meta)) && readFileSync(join(root, paths.meta), 'utf8') === record) continue
    writeFileSync(join(root, paths.meta), record)
    console.log(`verify-translation-pairing: recorded ${paths.meta}`)
    written++
  }
  console.log(`verify-translation-pairing: ${written} record(s) written; run the check to validate the pairs.`)
  process.exit(0)
}

const errors = []
const state = new Map()

// 1. Every in-scope, non-excluded source merges bilingual.
for (const source of sources) {
  if (isExcluded(source, manifest.excluded)) continue
  const { zh } = translationPairPaths(source)
  if (!repositoryFileExists(zh)) {
    errors.push(`${source}: in-scope documentation must merge bilingual (docs/i18n/README.md); add the counterpart and record the pair`)
    state.set(source, 'missing')
  }
}

// 2. Every pair that exists at all is complete and consistent.
const pairAnchors = new Set()
for (const zh of translations) pairAnchors.add(zh.replace(/\.zh\.md$/, '.md'))
for (const meta of metas) pairAnchors.add(meta.replace(/\.i18n\.yaml$/, '.md'))

for (const source of [...pairAnchors].sort()) {
  const paths = translationPairPaths(source)
  const have = {
    source: repositoryFileExists(source),
    zh: repositoryFileExists(paths.zh),
    meta: repositoryFileExists(paths.meta),
  }
  if (isExcluded(source, manifest.excluded)) {
    if (have.zh) errors.push(`${paths.zh}: ${source} is excluded from pairing (generated or bilingual-by-construction); this translation must not exist`)
    if (have.meta) errors.push(`${paths.meta}: ${source} is excluded from pairing; this consistency record must not exist`)
    continue
  }
  const missing = Object.entries(have).filter(([, ok]) => !ok).map(([k]) => (k === 'source' ? source : k === 'zh' ? paths.zh : paths.meta))
  if (missing.length > 0) {
    errors.push(`${source}: incomplete pair — missing ${missing.join(', ')} (pairs merge whole: both languages plus the .i18n.yaml record)`)
    continue
  }

  const sourceContent = readRepositoryFile(source)
  const zhContent = readRepositoryFile(paths.zh)
  const metaContent = readRepositoryFile(paths.meta)
  const record = parseTranslationPairingRecord(metaContent.toString('utf8'), paths)
  if (record === undefined) {
    errors.push(`${paths.meta}: malformed consistency record (expected exactly \`${basename(source)}: <40-hex>\` and \`${basename(paths.zh)}: <40-hex>\`)`)
    continue
  }

  let consistent = true
  for (const [file, content] of [[source, sourceContent], [paths.zh, zhContent]]) {
    const current = gitBlobHash(content)
    const recorded = file === source ? record.sourceHash : record.zhHash
    if (recorded !== current) {
      errors.push(`${file}: out of sync — content no longer matches the pair's last confirmed-consistent state in ${paths.meta} (bring the other side along, then re-record with --write)`)
      consistent = false
    }
  }
  if (!consistent) {
    state.set(source, 'out-of-sync')
    continue
  }

  const sourceTree = parseMarkdown(sourceContent.toString('utf8'))
  const zhTree = parseMarkdown(zhContent.toString('utf8'))
  if (!linksTo(zhTree, [basename(source)])) {
    errors.push(`${paths.zh}: missing language switcher — no link to ${basename(source)}`)
  }
  if (!linksTo(sourceTree, [basename(paths.zh)])) {
    errors.push(`${source}: missing language switcher — no link back to ${basename(paths.zh)}`)
  }
  for (const divergence of structureDiff(
    structureSignature(sourceTree, [basename(paths.zh)]),
    structureSignature(zhTree, [basename(source)]),
  )) {
    errors.push(`${source} ↔ ${paths.zh}: ${divergence}`)
  }
  if (!state.has(source)) state.set(source, 'ok')
}

for (const source of sources) {
  if (!isExcluded(source, manifest.excluded) && !state.has(source)) state.set(source, 'missing')
}

if (request.mode === 'list') {
  const order = { 'out-of-sync': 0, missing: 1, ok: 2 }
  const rows = [...state.entries()].sort((a, b) => order[a[1]] - order[b[1]] || a[0].localeCompare(b[0]))
  for (const [file, status] of rows) {
    console.log(`${status.padEnd(11)} ${file}${status === 'missing' ? '  (required)' : ''}`)
  }
  const counts = { ok: 0, 'out-of-sync': 0, missing: 0 }
  for (const status of state.values()) counts[status]++
  console.log(`verify-translation-pairing: ${counts.ok} ok, ${counts['out-of-sync']} out-of-sync, ${counts.missing} missing (of ${state.size} in scope)`)
  process.exit(0)
}

if (errors.length === 0) {
  console.log(request.scope === 'pairs'
    ? `verify-translation-pairing: ${pairAnchors.size} named pair(s) consistent; the corpus-wide check still runs separately.`
    : `verify-translation-pairing: ${pairAnchors.size} pair(s) checked across all in-scope documentation, all consistent.`)
  process.exit(0)
}

console.error('verify-translation-pairing: bilingual pairing rules violated (see docs/i18n/README.md):')
for (const message of errors) console.error(`  ${message}`)
process.exit(1)

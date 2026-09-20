#!/usr/bin/env node
// Enforce the archived Agent Note freeze (.agents/notes/README.md "Archiving and
// deletion"): path shape, header block, single-language, and no edit, move, or
// delete of an already-committed note.
// Content comes from the index (`git show :path`), so a pre-commit hook validates
// what is being committed rather than the worktree.
// `--list` prints the archived tree; the no-flag run is the gate.
// What the gate cannot see — the frozen body beyond the header block — stays a
// review convention owned by the global archive-agent-notes skill.
// Smoke test: `node scripts/test-archived-notes.mjs`.

import { spawnSync } from 'node:child_process'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ARCHIVE_DIR = '.agents/notes/archived'
const CLASSES = ['architecture', 'bug-fix', 'feature', 'process', 'simplification', 'testing']
const NOTE_PATH = new RegExp(
  `^${ARCHIVE_DIR}/(?:${CLASSES.join('|')})/\\d{4}-\\d{2}-\\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\\.md$`,
)
const TITLE_LINE = /^# Agent Note: \S/
const ARCHIVED_LINE = /^Archived: (\d{4})-(\d{2})-(\d{2})$/
const PAIRING_SUFFIX = /\.zh\.md$|\.i18n\.yaml$/

function git(...args) {
  const result = spawnSync('git', ['-C', root, '-c', 'core.fsmonitor=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LANG: 'C', LC_ALL: 'C' },
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (status ${String(result.status)}): ${result.stderr.trim()}`)
  }
  return result.stdout
}

function isRealDate(year, month, day) {
  const stamp = `${year}-${month}-${day}`
  const date = new Date(`${stamp}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === stamp
}

/** Violations for one archived note's path and committed content. */
function archivedNoteProblems(path, text) {
  if (PAIRING_SUFFIX.test(path)) {
    return [
      `${path}: an archived note is frozen and single-language — the Chinese counterpart and the .i18n.yaml record are out of pairing scope`,
    ]
  }
  if (!NOTE_PATH.test(path)) {
    return [
      `${path}: expected ${ARCHIVE_DIR}/<class>/yyyy-mm-dd-topic-title.md with <class> one of ${CLASSES.join(', ')} (implemented is deliberately absent)`,
    ]
  }

  const problems = []
  const lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))

  if (!TITLE_LINE.test(lines[0] ?? '')) problems.push(`${path}: line 1 must be "# Agent Note: <title>"`)
  else if (lines[1] !== '') problems.push(`${path}: line 2 must be blank`)

  if (lines[2] !== 'Status: implemented') {
    problems.push(`${path}: line 3 must be "Status: implemented" — an archived note keeps the status it was archived with`)
  }

  const archived = ARCHIVED_LINE.exec(lines[3] ?? '')
  if (!archived) problems.push(`${path}: line 4 must be "Archived: YYYY-MM-DD" immediately below the status`)
  else if (!isRealDate(archived[1], archived[2], archived[3])) {
    problems.push(`${path}: the Archived line is not a real calendar date`)
  }
  return problems
}

/** Notes committed before this change: frozen, so the index may only add to the tree. */
function frozenProblems() {
  const tokens = git('diff', '--cached', '--name-status', '-z', '--diff-filter=MDR', '--', ARCHIVE_DIR)
    .split('\0')
    .filter(Boolean)
  const problems = []
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index++]
    if (status.startsWith('R')) {
      const from = tokens[index++]
      const to = tokens[index++]
      problems.push(`${to}: an archived note is permanently frozen — ${from} may not be moved`)
      continue
    }
    const path = tokens[index++]
    problems.push(
      `${path}: an archived note is permanently frozen and may not be ${status === 'D' ? 'deleted' : 'edited'}`,
    )
  }
  return problems
}

function archivedPaths() {
  return git('ls-files', '-z', '--', ARCHIVE_DIR)
    .split('\0')
    .filter((path) => path !== '' && basename(path) !== '.gitkeep')
}

const paths = archivedPaths()

if (process.argv.includes('--list')) {
  console.log(paths.length === 0 ? `${ARCHIVE_DIR}: empty` : paths.map((path) => `frozen  ${path}`).join('\n'))
  process.exit(0)
}

const problems = []
for (const path of paths) problems.push(...archivedNoteProblems(path, git('show', `:${path}`)))
problems.push(...frozenProblems())

if (problems.length > 0) {
  console.error('verify-archived-agent-notes failed:\n')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('\nSee .agents/notes/README.md "Archiving and deletion" for the freeze rules.')
  process.exit(1)
}

console.log(`verify-archived-agent-notes: ${String(paths.length)} archived note(s) within the freeze.`)

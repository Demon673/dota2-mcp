#!/usr/bin/env node
// Smoke test for scripts/verify-archived-agent-notes.mjs.
// A throwaway git repository under the OS temp directory is the only faked
// boundary; the gate runs as a real subprocess, so path, header, and freeze
// cases are exercised through its actual CLI.

import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GATE = 'scripts/verify-archived-agent-notes.mjs'
const NOTE = '.agents/notes/archived/process/2026-01-02-sample-decision.md'
const HEADER = ['# Agent Note: Sample decision', '', 'Status: implemented', 'Archived: 2026-01-02', '', '## Problem']

const work = mkdtempSync(join(tmpdir(), 'archived-notes-test-'))
process.on('exit', () => rmSync(work, { recursive: true, force: true }))

function git(...args) {
  const result = spawnSync('git', ['-C', work, '-c', 'user.email=test@example.invalid', '-c', 'user.name=test', ...args], {
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`)
  }
  return result.stdout
}

function write(path, lines) {
  const absolute = join(work, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, Array.isArray(lines) ? lines.join('\n') : lines)
}

function gate() {
  return spawnSync(process.execPath, [join(work, GATE)], { cwd: work, encoding: 'utf8' })
}

function reset() {
  git('reset', '--hard', 'HEAD')
  git('clean', '-qfd')
}

mkdirSync(join(work, dirname(GATE)), { recursive: true })
copyFileSync(join(root, GATE), join(work, GATE))
write(NOTE, HEADER)
git('init', '-q')
git('add', '-A')
git('commit', '-qm', 'base')

const failures = []
let checked = 0

function check(label, expected, setup) {
  checked += 1
  try {
    reset()
    setup()
    const result = gate()
    if (result.status !== expected) {
      failures.push(`${label}: expected exit ${String(expected)}, got ${String(result.status)}\n${result.stderr}`)
    }
  } catch (error) {
    failures.push(`${label}: ${error.message}`)
  }
}

check('a committed archive with a clean index passes', 0, () => {})
check('an edit outside the index passes (the gate reads the index)', 0, () => {
  write(NOTE, [...HEADER, '', 'edited in the worktree only'])
})
check('a second well-formed note passes', 0, () => {
  write('.agents/notes/archived/feature/2026-01-03-good-note.md', HEADER)
  git('add', '-A')
})

check('a staged edit of a committed note fails', 1, () => {
  write(NOTE, [...HEADER, '', 'edited'])
  git('add', '-A')
})
check('a staged deletion fails', 1, () => git('rm', '-q', NOTE))
check('a rename inside archived fails', 1, () => {
  mkdirSync(join(work, '.agents/notes/archived/feature'), { recursive: true })
  git('mv', NOTE, '.agents/notes/archived/feature/2026-01-02-sample-decision.md')
})
check('a move back out of archived fails', 1, () => {
  mkdirSync(join(work, '.agents/notes/implemented/process'), { recursive: true })
  git('mv', NOTE, '.agents/notes/implemented/process/2026-01-02-sample-decision.md')
})

check('a Chinese counterpart fails', 1, () => {
  write(`${NOTE.replace(/\.md$/, '')}.zh.md`, HEADER)
  git('add', '-A')
})
check('an .i18n.yaml record fails', 1, () => {
  write(`${NOTE.replace(/\.md$/, '')}.i18n.yaml`, 'x: y')
  git('add', '-A')
})
check('an implemented/ class folder fails', 1, () => {
  write('.agents/notes/archived/implemented/2026-01-02-sample-decision.md', HEADER)
  git('add', '-A')
})
check('a file outside a class folder fails', 1, () => {
  write('.agents/notes/archived/2026-01-02-sample-decision.md', HEADER)
  git('add', '-A')
})
check('a missing Archived line fails', 1, () => {
  write(NOTE, HEADER.filter((line) => !line.startsWith('Archived: ')))
  git('add', '-A')
})
check('a status that is not implemented fails', 1, () => {
  write(NOTE, ['# Agent Note: Sample decision', '', 'Status: proposed', ...HEADER.slice(3)])
  git('add', '-A')
})
check('a nonexistent calendar date fails', 1, () => {
  write(NOTE, [...HEADER.slice(0, 3), 'Archived: 2026-02-31', ...HEADER.slice(5)])
  git('add', '-A')
})
check('a title line that is not an Agent Note title fails', 1, () => {
  write(NOTE, ['# Note: Sample decision', ...HEADER.slice(1)])
  git('add', '-A')
})

reset()
const listed = spawnSync(process.execPath, [join(work, GATE), '--list'], { cwd: work, encoding: 'utf8' })
checked += 1
if (listed.status !== 0 || !listed.stdout.includes(NOTE)) {
  failures.push(`--list did not report ${NOTE}: exit ${String(listed.status)}\n${listed.stdout}${listed.stderr}`)
}

if (failures.length > 0) {
  console.error(`test-archived-notes: ${String(failures.length)} of ${String(checked)} checks failed\n`)
  for (const failure of failures) console.error(`  ${failure}\n`)
  process.exit(1)
}

console.log(`test-archived-notes: ${String(checked)} checks passed.`)

#!/usr/bin/env node
// Faithful port of deepseek-harness scripts/install-lefthook.mjs, reduced to a
// small zero-dependency installer. The dsh-specific worktree-local hooks
// directory, ownership marker, install lock, and translation-pairing
// merge-driver configuration are omitted. Installs this repository's
// lefthook.yml hooks with `lefthook install --force`.

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

function stripGitLineTerminator(output) {
  const withoutLineFeed = output.endsWith('\n') ? output.slice(0, -1) : output
  return process.platform === 'win32' && withoutLineFeed.endsWith('\r')
    ? withoutLineFeed.slice(0, -1)
    : withoutLineFeed
}

function lefthookBinary(root) {
  const local = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'lefthook.cmd' : 'lefthook')
  return existsSync(local) ? local : (process.platform === 'win32' ? 'lefthook.cmd' : 'lefthook')
}

function runLefthook(root, lefthook) {
  const args = ['install', '--force']
  // Node refuses to spawn Windows `.cmd` shims directly; the quoted path is
  // re-parsed by cmd.exe, while POSIX can execute its extensionless shim.
  const result = process.platform === 'win32'
    ? spawnSync(`"${lefthook}"`, args, { cwd: root, stdio: 'inherit', shell: true })
    : spawnSync(lefthook, args, { cwd: root, stdio: 'inherit' })
  if (result.error) {
    const hint = result.error.code === 'ENOENT'
      ? ' (lefthook not found; install it, e.g. `npm install --no-save lefthook` or https://lefthook.dev)'
      : ''
    throw new Error(`lefthook install --force failed: ${result.error.message}${hint}`)
  }
  if (result.status !== 0) {
    throw new Error(`lefthook install --force failed: exit status ${String(result.status)}`)
  }
}

function main() {
  if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') return
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  if (top.status !== 0) return
  const root = stripGitLineTerminator(top.stdout)
  runLefthook(root, lefthookBinary(root))
}

try {
  main()
} catch (error) {
  console.error(`[install-lefthook] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}

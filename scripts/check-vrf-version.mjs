#!/usr/bin/env node
// VRF 版本巡检：把 src/tools/vrf-ensure.ts 的 DEFAULT_VERSION 与上游最新 release 比对。
//
//   node scripts/check-vrf-version.mjs               只报告；落后则退出码 1
//   node scripts/check-vrf-version.mjs --write       把 pin 移到最新版（先守住资产不回退）
//   node scripts/check-vrf-version.mjs --version X   跳过网络，拿 X 当"最新"（离线自测用）
//
// 版本号只在源码里存一处（vrf-ensure.ts 的常量）；工具描述从它插值，所以 --write 只需改一行。
// 退出码：0 已同步或已写入，1 落后，2 无法判定（网络失败、解析失败，或写入被拒）。

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(root, 'src/tools/vrf-ensure.ts')
const PIN_LINE = /export const DEFAULT_VERSION = "[^"]+";/

const args = process.argv.slice(2)
const write = args.includes('--write')
const forced = args.includes('--version') ? args[args.indexOf('--version') + 1] : undefined

function fail(message) {
  console.error(`check-vrf-version: ${message}`)
  process.exit(2)
}

const source = readFileSync(SOURCE, 'utf8')
const pin = /const DEFAULT_VERSION = "([^"]+)";/.exec(source)?.[1]
const repo = /const REPO = "([^"]+)";/.exec(source)?.[1]
if (pin === undefined) fail(`no DEFAULT_VERSION found in ${SOURCE}`)
if (repo === undefined) fail(`no REPO found in ${SOURCE}`)

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'dota2-mcp' },
    signal: AbortSignal.timeout(30000),
  }).catch((e) => fail(`${url} failed: ${e.message}`))
  if (!res.ok) fail(`${url} returned HTTP ${res.status}`)
  return res.json()
}

const releaseTag = async () => (await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`)).tag_name
const releaseAssets = async (tag) => {
  const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/tags/${tag}`)
  return (release.assets ?? []).map((a) => a.name).filter((n) => /^cli-.*\.zip$/.test(n)).sort()
}

const latest = forced ?? (await releaseTag())

if (latest === pin) {
  console.log(`check-vrf-version: pin ${pin} is the latest release.`)
  process.exit(0)
}

console.log(`check-vrf-version: pin ${pin} -> upstream ${latest}`)

if (!write) {
  console.log('  pass --write to move the pin; the tool descriptions interpolate the constant, so it is the only edit.')
  process.exit(1)
}

// 升级前守一条不变量：新版不能丢掉旧版已有的平台资产，否则某些平台会下载 404。
const newAssets = await releaseAssets(latest)
const missing = (await releaseAssets(pin)).filter((name) => !newAssets.includes(name))
if (missing.length > 0) {
  fail(`release ${latest} drops platform asset(s) ${missing.join(', ')} that ${pin} shipped — refusing to move the pin`)
}
console.log(`  platform assets: ${newAssets.join(', ')}`)

if (source.match(new RegExp(PIN_LINE.source, 'g')).length !== 1) {
  fail(`${PIN_LINE.source} does not match exactly once in ${SOURCE} — refusing to write`)
}
writeFileSync(SOURCE, source.replace(PIN_LINE, `export const DEFAULT_VERSION = "${latest}";`))
console.log(`  wrote ${SOURCE}: ${pin} -> ${latest}. Run npm run build to refresh dist/.`)

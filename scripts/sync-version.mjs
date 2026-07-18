#!/usr/bin/env node
/**
 * sync-version — 以 package.json 的 version 为唯一权威，同步散落在各处的版本号。
 *
 * 用法：
 *   node scripts/sync-version.mjs          # 直接同步（就地修改不一致的文件）
 *   node scripts/sync-version.mjs --check  # 只检查，不一致时退出码 1（用于 CI）
 *
 * 当前同步目标：
 *   - src/index.ts  → getVersion() 的 fallback 字符串（SEA 单文件打包读不到 package.json 时兜底）
 *   - README.md     → 「## 版本」一节的 当前版本：`vX.Y.Z`
 *
 * 发版时 bump 了 package.json 版本号但忘记同步这里，就是这个脚本要防的问题。
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const checkOnly = process.argv.includes("--check");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @typedef {{ file: string, desc: string, find: RegExp, replace: (v: string) => string }} SyncTarget */

/** @type {SyncTarget[]} */
const targets = [
  {
    file: "src/index.ts",
    desc: "getVersion() fallback",
    find: /(catch \{\s*return\s*")([^"]+)("\s*;?\s*\})/,
    replace: (v) => `$1${v}$3`,
  },
  {
    file: "README.md",
    desc: "README 版本号",
    find: /(当前版本：`v)([^`]+)(`)/,
    replace: (v) => `$1${v}$3`,
  },
];

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const version = pkg.version;
if (!version) {
  console.error("[sync-version] package.json 缺少 version 字段");
  process.exit(1);
}

let stale = 0;

for (const t of targets) {
  const filePath = path.join(root, t.file);
  if (!fs.existsSync(filePath)) {
    console.warn(`[sync-version] 跳过 ${t.file}（文件不存在）`);
    continue;
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const m = content.match(t.find);
  if (!m) {
    console.error(`[sync-version] ${t.file}: 未找到 ${t.desc} 的版本号模式（正则失效，脚本需要更新）`);
    stale++;
    continue;
  }
  if (m[2] === version) {
    console.log(`[sync-version] ${t.file}: ${t.desc} 已是 ${version} ✓`);
    continue;
  }

  stale++;
  if (checkOnly) {
    console.error(`[sync-version] ${t.file}: ${t.desc} 为 ${m[2]}，应为 ${version}`);
    continue;
  }

  const updated = content.replace(t.find, t.replace(version));
  fs.writeFileSync(filePath, updated);
  console.log(`[sync-version] ${t.file}: ${t.desc} ${m[2]} → ${version}`);
}

if (stale > 0) {
  if (checkOnly) {
    console.error(`[sync-version] ${stale} 处版本号未同步，请运行 node scripts/sync-version.mjs`);
    process.exit(1);
  }
  console.log(`[sync-version] 已同步 ${stale} 处到 ${version}`);
} else {
  console.log(`[sync-version] 全部版本号均为 ${version}`);
}

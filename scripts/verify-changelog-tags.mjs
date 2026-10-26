#!/usr/bin/env node
// Release tag gate: every dated changelog version has a vX.Y.Z tag on an
// ancestor of HEAD with the same date. The top entry may be "(unreleased)"
// while package.json already names that version.
// Exit 1 on the first mismatch; run before publishing a release.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const fail = (message) => { console.error(`verify-changelog-tags: ${message}`); process.exit(1); };
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const rows = [...readFileSync("CHANGELOG.md", "utf8").matchAll(/^## (\d+\.\d+\.\d+) \((unreleased|\d{4}-\d{2}-\d{2})\)$/gm)]
  .map((m) => ({ version: m[1], date: m[2] }));
if (rows.length === 0) fail("no '## X.Y.Z (date|unreleased)' headings in CHANGELOG.md");

const seen = new Set();
for (const row of rows) {
  if (seen.has(row.version)) fail(`duplicate version ${row.version}`);
  seen.add(row.version);
}

const semver = (v) => v.split(".").map(Number);
const newer = (a, b) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
for (let i = 1; i < rows.length; i++) {
  if (!newer(rows[i - 1].version, rows[i].version)) {
    fail(`versions are not newest-first: ${rows[i - 1].version} then ${rows[i].version}`);
  }
}

if (rows[0].version !== pkg.version) {
  fail(`top changelog version ${rows[0].version} != package.json ${pkg.version}`);
}

let checked = 0;
for (const [i, row] of rows.entries()) {
  if (row.date === "unreleased") {
    if (i !== 0) fail(`${row.version} is marked unreleased but is not the top entry`);
    continue;
  }
  const tag = `v${row.version}`;
  if (!git("tag", "--list", tag)) fail(`${row.version} has no ${tag} tag`);
  try {
    git("merge-base", "--is-ancestor", tag, "HEAD");
  } catch {
    fail(`${tag} is not an ancestor of HEAD`);
  }
  const tagDate = git("log", "-1", "--format=%ad", "--date=short", tag);
  if (tagDate !== row.date) fail(`${row.version} is dated ${row.date} but ${tag} was committed ${tagDate}`);
  checked++;
}
console.log(`verify-changelog-tags: ${checked} dated version(s) match their tags${rows[0].date === "unreleased" ? "; the top entry is unreleased" : ""}.`);

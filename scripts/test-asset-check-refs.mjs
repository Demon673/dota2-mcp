// 离线 asset_check_refs 冒烟：直接单测 checkRefs（临时 addon 树 + fake VRF CLI）
// 场景：vmdl 引用 a.vmat（有产物）、b.vmat（源在产物缺）、missing.vmat（不存在）、engine.vmat（引擎）、自身（环）。
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkRefs } from "../dist/tools/asset-check-refs.js";

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("ok -", msg);
}

const root = mkdtempSync(path.join(tmpdir(), "refs-test-"));
const ADDON = "testaddon";
// addon 源（content）
const cMats = path.join(root, "content", "dota_addons", ADDON, "materials");
mkdirSync(cMats, { recursive: true });
writeFileSync(path.join(cMats, "a.vmat"), "x");
writeFileSync(path.join(cMats, "b.vmat"), "x");
// addon 产物（game）：a 已编译、b 未编译
const gMats = path.join(root, "game", "dota_addons", ADDON, "materials");
mkdirSync(gMats, { recursive: true });
writeFileSync(path.join(gMats, "a.vmat_c"), "x");
// 引擎资产
const eMats = path.join(root, "game", "dota", "materials");
mkdirSync(eMats, { recursive: true });
writeFileSync(path.join(eMats, "engine.vmat_c"), "x");
// 目标 vmdl 源（被检查对象）
const cModels = path.join(root, "content", "dota_addons", ADDON, "models");
mkdirSync(cModels, { recursive: true });
const target = path.join(cModels, "hero.vmdl");
writeFileSync(target, "x");

// fake VRF CLI：对 vmdl 输出引用 fixture；对 a.vmat 输出空（无更深引用）
const vmdlFixture = JSON.stringify([
  '_class = "CMesh"',
  'm_material = resource:"materials/a.vmat"',
  'm_material2 = resource:"materials/b.vmat"',
  'm_material3 = resource:"materials/missing.vmat"',
  'm_material4 = resource:"materials/engine.vmat"',
  'm_refSelf = resource:"models/hero.vmdl"',
].join("\n"));
const cliSrc = `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const i = argv.indexOf("-i");
const input = i >= 0 ? argv[i + 1] : "";
const o = argv.indexOf("-o");
const out = o >= 0 ? argv[o + 1] : null;
const body = { vmdl: ${vmdlFixture}, vmat: "" };
const emit = (t) => { if (out) writeFileSync(out, t); else process.stdout.write(t); };
if (input.endsWith("hero.vmdl")) { emit(body.vmdl); process.exit(0); }
emit("");
process.exit(0);
`;
const cache = mkdtempSync(path.join(tmpdir(), "refs-cache-"));
const vDir = path.join(cache, "v9.9.9");
mkdirSync(vDir, { recursive: true });
const cliPath = path.join(vDir, "Source2Viewer-CLI");
writeFileSync(cliPath, cliSrc);
chmodSync(cliPath, 0o755);

process.env.VRF_CACHE_DIR = cache;
process.env.VRF_VERSION = "9.9.9";

try {
  const res = await checkRefs(root, ADDON, target);
  assert(res.ok, "checkRefs runs");
  const out = JSON.parse(res.text);
  console.log(res.text);
  assert(out.checked === 5, "checked count = 5 (got " + out.checked + ")");
  assert(out.ok.length === 1 && out.ok[0].ref === "materials/a.vmat", "a.vmat ok");
  assert(out.uncompiled.length === 2, "two uncompiled (b.vmat + self ref), got " + out.uncompiled.length);
  assert(out.uncompiled.some((r) => r.ref === "materials/b.vmat"), "b.vmat uncompiled");
  assert(out.uncompiled.some((r) => r.ref === "models/hero.vmdl"), "self ref reported as uncompiled source (its own _c is missing)");
  assert(out.broken.length === 1 && out.broken[0].ref === "materials/missing.vmat", "missing.vmat broken");
  assert(out.engine_refs.length === 1 && out.engine_refs[0] === "materials/engine.vmat", "engine.vmat engine ref");
  assert(!out.ok.some((r) => r.ref.includes("hero.vmdl")) && out.checked === 5, "self ref deduped by visited (no loop)");
  console.log("PASS");
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(cache, { recursive: true, force: true });
}
process.exit(0);

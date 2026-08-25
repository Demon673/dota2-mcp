// 离线 asset_inspect 冒烟：fake VRF CLI（按 -i 扩展名输出 fixture）+ 最小 PNG
// 断言五类型摘要字段、include_raw 截断、unknown 透传。
import { spawnMcpServer, assert, sleep } from "./lib-mcp.mjs";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// fake VRF CLI：Node 脚本，按 -i 参数扩展名选择 fixture；vtex 写 PNG 到 -o
const vpcfFixture = `
_class = "CParticleSystemDefinition"
m_nMaxParticles = 64
m_Children =
[
  { m_ChildRef = resource:"particles/test/bits.vpcf" },
]
_class = "C_OP_InstantaneousEmitter"
m_flSpawnRate = 100
_class = "C_INIT_RandomLifeTime"
_class = "C_OP_BasicMovement"
m_Material = resource:"materials/particle/test_glow.vtex"
`;
const vmdlFixture = `
m_meshList =
[
  { _class = "CMesh", m_material = resource:"materials/models/hero/hero_body.vmat" },
  { _class = "CMesh", m_material = resource:"materials/models/hero/hero_armor.vmat" },
]
m_refLODGroup = resource:"models/hero/hero_lod.vmdl"
`;
const vmatFixture = `
m_shader = "dota_hero.vfx"
g_tColor = resource:"materials/models/hero/hero_color.vtex"
g_tNormal = resource:"materials/models/hero/hero_normal.vtex"
g_flRoughness = 0.8
`;

const fakeCli = `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const i = argv.indexOf("-i");
const o = argv.indexOf("-o");
const input = i >= 0 ? argv[i + 1] : "";
const out = o >= 0 ? argv[o + 1] : null;
if (input.endsWith(".vtex_c") || input.endsWith(".vtex")) {
  if (out) {
    // 最小 1x1 RGBA8 PNG（67 字节：签名+IHDR+IDAT+IEND）
    const png = Buffer.alloc(67);
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(png, 0);
    png.writeUInt32BE(13, 8); png.write("IHDR", 12, "latin1");
    png.writeUInt32BE(1, 16); png.writeUInt32BE(1, 20);
    png[24] = 8; png[25] = 6;
    png.writeUInt32BE(0x0f0f0f0f, 26); png.write("IDAT", 30, "latin1");
    png.writeUInt32BE(0x08040000, 34); png.write("IEND", 42, "latin1");
    writeFileSync(out, png);
  }
  process.exit(0);
}
const body = ${JSON.stringify({ vpcf: vpcfFixture, vmdl: vmdlFixture, vmat: vmatFixture })};
for (const [k, v] of Object.entries(body)) if (input.endsWith(k) || input.endsWith(k + "_c")) {
  if (out) { writeFileSync(out, v); } else { process.stdout.write(v); }
  process.exit(0);
}
if (out) writeFileSync(out, "opaque_binary_blob_that_is_not_any_known_format");
else process.stdout.write("opaque_binary_blob_that_is_not_any_known_format");
process.exit(0);
`;

const cache = mkdtempSync(path.join(tmpdir(), "inspect-test-"));
const vDir = path.join(cache, "v9.9.9");
mkdirSync(vDir, { recursive: true });
const cliPath = path.join(vDir, "Source2Viewer-CLI");
writeFileSync(cliPath, fakeCli);
chmodSync(cliPath, 0o755);

const BASE = 20000 + Math.floor(Math.random() * 20000);
const env = {
  ...process.env,
  DOTA2_VCON_DOTA_PORT: String(BASE),
  DOTA2_VCON_GUI_PORT: String(BASE + 1),
  DOTA2_VCON_CTRL_PORT: String(BASE + 2),
  DOTA2_TEST_ADDON: process.env.DOTA2_TEST_ADDON || "dota2mcptest",
  VRF_CACHE_DIR: cache,
  VRF_VERSION: "9.9.9",
};
const { call, notify, kill } = spawnMcpServer({ timeoutMs: 45000, env });
await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "inspect", version: "0" } });
notify("notifications/initialized");
await sleep(12000);

const ADDON = env.DOTA2_TEST_ADDON;
async function inspect(target, extra = {}) {
  const r = await call("tools/call", { name: "asset_inspect", arguments: { target, addon: ADDON, ...extra } });
  assert(!r.result.isError, "inspect " + target + " ok");
  return JSON.parse(r.result.content[0].text);
}

// vpcf
const vp = await inspect("game/dota_addons/" + ADDON + "/particles/x.vpcf_c");
assert(vp.asset_type === "vpcf", "vpcf asset_type");
assert(vp.summary.particle_system_count === 1, "vpcf system count");
assert(vp.summary.emitter_count === 1, "vpcf emitter count");
assert(vp.summary.operator_count === 2, "vpcf operator count (C_OP_*)");
assert(vp.summary.initializer_count === 1, "vpcf initializer count");
assert(vp.summary.max_particles === 64, "vpcf max particles");
assert(vp.summary.material_refs.includes("materials/particle/test_glow.vtex"), "vpcf material ref");
assert(vp.summary.child_refs.includes("particles/test/bits.vpcf"), "vpcf child ref");

// vmdl
const md = await inspect("game/dota_addons/" + ADDON + "/models/x.vmdl_c");
assert(md.asset_type === "vmdl", "vmdl asset_type");
assert(md.summary.mesh_count === 2, "vmdl mesh count");
assert(md.summary.material_refs.length === 2, "vmdl material refs");
assert(md.summary.lod_group_ref === "models/hero/hero_lod.vmdl", "vmdl lod ref");

// vmat
const mt = await inspect("game/dota_addons/" + ADDON + "/materials/x.vmat_c");
assert(mt.asset_type === "vmat", "vmat asset_type");
assert(mt.summary.shader === "dota_hero.vfx", "vmat shader");
assert(Object.keys(mt.summary.texture_refs).length === 2, "vmat texture refs");
assert(mt.summary.texture_refs.g_tColor === "materials/models/hero/hero_color.vtex", "vmat texture mapping");

// vtex（PNG 尺寸）
const tx = await inspect("game/dota_addons/" + ADDON + "/materials/x.vtex_c");
assert(tx.asset_type === "vtex", "vtex asset_type");
assert(tx.summary.width === 1 && tx.summary.height === 1, "vtex PNG dimensions");
assert(tx.summary.format === "RGBA-8bit", "vtex PNG format: " + tx.summary.format);
assert(tx.notes.some((n) => n.includes("PNG 导出")), "vtex notes png path");

// unknown（透传 + 无 summary）
const un = await inspect("game/dota_addons/" + ADDON + "/x.weird_c");
assert(un.asset_type === "weird", "unknown asset_type");
assert(!un.summary, "unknown has no summary");
assert(un.notes.some((n) => n.includes("未知")), "unknown notes hint");

// include_raw 截断
const raw = await inspect("game/dota_addons/" + ADDON + "/particles/x.vpcf_c", { include_raw: true });
assert(typeof raw.raw_decompiled === "string" && raw.raw_decompiled.length > 0, "raw included");

console.log("PASS");
rmSync(cache, { recursive: true, force: true });
kill();
process.exit(0);

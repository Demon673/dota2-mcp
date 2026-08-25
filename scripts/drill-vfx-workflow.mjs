// 实际使用演练：模拟 agent 用 dota2-mcp 走完整特效制作流程
// 学知识 → 写源 → 编译 → 检查 → 引用验证 → 预览 → 查错 → 停止 → 迭代
import { spawnMcpServer, sleep } from "./lib-mcp.mjs";

const env = { ...process.env, DOTA2_TEST_ADDON: "dota2mcptest" };
const { call, notify, kill } = spawnMcpServer({ timeoutMs: 120000, env });
function text(result) {
  const r = result.result ?? result;
  return (r.content ?? []).map((c) => c.text).join("");
}

await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "drill", version: "0" } });
notify("notifications/initialized");
await sleep(15000);

const ADDON = "dota2mcptest";
const SRC = "content/dota_addons/" + ADDON + "/particles/test_vfx/test_burst.vpcf";

// 1. 学知识：分节读 dota2-vfx 的最小模板
console.log("========== 1. dota2_skill 学知识（分节：最小模板） ==========");
const tpl = await call("tools/call", { name: "dota2_skill", arguments: { name: "dota2-vfx", section: "Minimal template" } });
console.log(text(tpl).slice(0, 500));

// 2. file_write 写新粒子源
console.log("\\n========== 2. file_write 写源 ==========");
const vpcf = `
<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:generic:version{7412167c-06e9-4698-aff2-e63eb59037e7} -->
{
  _class = \"CParticleSystemDefinition\"
  m_nMaxParticles = 48
  m_flConstantRadius = 6.0
  m_Children =
  [
    {
      _class = \"CParticleSystemDefinition\"
      m_Operators =
      [
        { _class = \"C_OP_InstantaneousEmitter\" m_flSpawnRate = 48 },
        { _class = \"C_INIT_RandomLifeTime\" m_fLifetimeMin = 0.5 m_fLifetimeMax = 1.0 },
        { _class = \"C_OP_Decay\" },
        { _class = \"C_OP_BasicMovement\" },
      ]
    },
  ]
}
`;
const w = await call("tools/call", { name: "file_write", arguments: { target: SRC, addon: ADDON, content: vpcf } });
console.log(text(w));

// 3. 编译
console.log("\\n========== 3. dota_compile_asset 编译 ==========");
const comp = await call("tools/call", { name: "dota_compile_asset", arguments: { target: SRC, addon: ADDON } });
console.log(text(comp).slice(0, 400));

// 4. asset_inspect 检查编译产物
console.log("\\n========== 4. asset_inspect 检查编译产物 ==========");
const insp = await call("tools/call", { name: "asset_inspect", arguments: { target: "game/dota_addons/" + ADDON + "/particles/test_vfx/test_burst.vpcf_c", addon: ADDON } });
console.log(text(insp).slice(0, 800));

// 5. asset_check_refs 引用完整性
console.log("\\n========== 5. asset_check_refs 引用完整性 ==========");
const refs = await call("tools/call", { name: "asset_check_refs", arguments: { target: "game/dota_addons/" + ADDON + "/particles/test_vfx/test_burst.vpcf_c", addon: ADDON } });
console.log(text(refs).slice(0, 600));

// 6. 游戏内预览
console.log("\\n========== 6. vfx_preview 游戏内预览 ==========");
const prev = await call("tools/call", { name: "vfx_preview", arguments: { particle_path: "particles/test_vfx/test_burst.vpcf", attach: 8 } });
const prevText = text(prev);
console.log(prevText.slice(0, 300));
const pid = Number((prevText.match(/pid=(\\d+)/) || [])[1] ?? 0);

// 7. 查加载错误
await sleep(3000);
console.log("\\n========== 7. console_output 查加载错误 ==========");
const co = await call("tools/call", { name: "console_output", arguments: { filter: "test_burst" } });
console.log(text(co).slice(0, 400) || "(无匹配输出)");

// 8. 停止预览
console.log("\\n========== 8. vfx_preview_stop 停止 ==========");
const stop = await call("tools/call", { name: "vfx_preview_stop", arguments: { particle_id: pid } });
console.log(text(stop).slice(0, 200));

// 9. 迭代：file_edit 改 max particles + file_read 读回
console.log("\\n========== 9. file_edit 迭代 + file_read 读回 ==========");
const ed = await call("tools/call", { name: "file_edit", arguments: { target: SRC, addon: ADDON, old_string: "m_nMaxParticles = 48", new_string: "m_nMaxParticles = 96" } });
console.log(text(ed));
const rd = await call("tools/call", { name: "file_read", arguments: { target: SRC, addon: ADDON } });
console.log("读回首行含 96:", text(rd).includes("m_nMaxParticles = 96"));

console.log("\\n========== 演练完成 ==========");
kill();
process.exit(0);

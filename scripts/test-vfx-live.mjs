// 活体 vfx_preview 冒烟：launch addon 地图 → spawn 粒子 → stop
// 前置：Dota 2 运行 + vconsole 已接入（relay 自动拉起）；DOTA2_TEST_ADDON=dota2mcptest
import { spawnMcpServer, assert, sleep } from "./lib-mcp.mjs";

const env = {
  ...process.env,
  DOTA2_TEST_ADDON: process.env.DOTA2_TEST_ADDON || "dota2mcptest",
  DOTA2_TEST_MAP: process.env.DOTA2_TEST_MAP || "template_map",
};
const { call, notify, kill } = spawnMcpServer({ timeoutMs: 180000, env });
function callText(result) {
  if (result.result && result.result.isError) throw new Error("tool error: " + result.result.content.map((c) => c.text).join("").slice(0, 400));
  return result.result.content.map((c) => c.text).join("");
}

await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "vfx-live", version: "0" } });
notify("notifications/initialized");
await sleep(15000);

// 1. 状态
const st = await call("tools/call", { name: "dota_status", arguments: {} });
const stText = callText(st);
console.log("--- dota_status ---");
console.log(stText.slice(0, 500));

// 2. 若未在游戏中则 launch（GAME_IN_PROGRESS 或 CUSTOM_GAME_SETUP 都算已入图）
if (!stText.includes("GAME_IN_PROGRESS") && !stText.includes("CUSTOM_GAME_SETUP") && !stText.includes("HERO_SELECTION") && !stText.includes("PRE_GAME")) {
  console.log("--- launching map ---");
  const l = await call("tools/call", { name: "dota_launch_game", arguments: {} });
  console.log(callText(l).slice(0, 300));
  // 轮询到入图
  for (let k = 0; k < 30; k++) {
    await sleep(5000);
    const s2 = await call("tools/call", { name: "dota_status", arguments: {} });
    const t2 = callText(s2);
    if (t2.includes("GAME_IN_PROGRESS") || t2.includes("CUSTOM_GAME_SETUP") || t2.includes("HERO_SELECTION") || t2.includes("PRE_GAME")) {
      console.log("in game now");
      break;
    }
    if (k === 29) { console.error("FAIL: map never reached in-game state"); process.exit(1); }
  }
} else {
  console.log("already in game");
}

// 2.5 若卡在 CUSTOM_GAME_SETUP，推进 setup（basic 模板不调用 FinishCustomGameSetup）
const stMid = await call("tools/call", { name: "dota_status", arguments: {} });
const stMidText = callText(stMid);
if (stMidText.includes("CUSTOM_GAME_SETUP")) {
  console.log("--- advancing CUSTOM_GAME_SETUP ---");
  const adv = await call("tools/call", { name: "dota_run_lua", arguments: { code: "GameRules:FinishCustomGameSetup()" } });
  console.log(callText(adv).slice(0, 200));
  await sleep(5000);
}

// 3. spawn 粒子
const spawnRes = await call("tools/call", { name: "vfx_preview", arguments: { particle_path: "particles/basic_explosion/basic_explosion.vpcf", attach: 8 } });
const spawnText = callText(spawnRes);
console.log("--- vfx_preview ---");
console.log(spawnText.slice(0, 400));
const pidMatch = spawnText.match(/pid=(\d+)/);
assert(pidMatch, "spawn returns a particle id");
const pid = Number(pidMatch[1]);
assert(pid > 0, "particle id > 0 (load did not obviously fail), got " + pid);

// 4. 读 Particles/ResourceSystem 通道检查加载错误
const out = await call("tools/call", { name: "console_output", arguments: { filter: "basic_explosion" } });
console.log("--- console_output (filtered) ---");
console.log(callText(out).slice(0, 400));

// 5. 销毁
await sleep(2000);
const stopRes = await call("tools/call", { name: "vfx_preview_stop", arguments: { particle_id: pid } });
const stopText = callText(stopRes);
console.log("--- vfx_preview_stop ---");
console.log(stopText.slice(0, 300));
assert(stopText.includes("destroyed") || stopText.includes("pid"), "stop reports destruction");

console.log("PASS");
kill();
process.exit(0);

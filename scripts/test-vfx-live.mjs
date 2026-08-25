// 活体 vfx_preview 冒烟：launch addon 地图 → spawn 粒子 → stop
// 前置：Dota 2 运行 + vconsole 已接入（relay 自动拉起）；DOTA2_TEST_ADDON=dota2mcptest
import { spawn } from "node:child_process";

const env = {
  ...process.env,
  DOTA2_TEST_ADDON: process.env.DOTA2_TEST_ADDON || "dota2mcptest",
  DOTA2_TEST_MAP: process.env.DOTA2_TEST_MAP || "template_map",
};
const server = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"], env });
let buf = "";
const responses = new Map();
server.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try { const msg = JSON.parse(line); if (msg.id !== undefined) responses.set(msg.id, msg); } catch {}
  }
});
server.stderr.on("data", () => {});
let nextId = 1;
function call(method, params) {
  const id = nextId++;
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (responses.has(id)) { clearInterval(timer); resolve(responses.get(id)); }
      else if (Date.now() - t0 > 180000) { clearInterval(timer); reject(new Error("timeout: " + method)); }
    }, 100);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("ok -", msg);
}
function callText(result) {
  if (result.result && result.result.isError) throw new Error("tool error: " + result.result.content.map((c) => c.text).join("").slice(0, 400));
  return result.result.content.map((c) => c.text).join("");
}

await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "vfx-live", version: "0" } });
server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
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
server.kill();
process.exit(0);

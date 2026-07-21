// test-launch-phases.mjs — 端到端：launch 相位轮询 + stuck 指引 + dota_run_lua 推进 + 活体名字验证
// 需要：Dota 2 运行（-addon tui12 -tools）+ daemon 已拉起 + vconsole 已接入（契约）
import { spawn, execSync } from "node:child_process";

const server = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const responses = new Map();
server.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try { const msg = JSON.parse(line); if (msg.id !== undefined) responses.set(msg.id, msg); } catch { /* 非 JSON */ }
  }
});
server.stderr.on("data", () => {});

let nextId = 1;
function call(method, params, timeoutMs = 30000) {
  const id = nextId++;
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (responses.has(id)) { clearInterval(timer); resolve(responses.get(id)); }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(timer); reject(new Error("timeout: " + method)); }
    }, 50);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tool = (name, args, t) => call("tools/call", { name, arguments: args }, t);

await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "phase-test", version: "0" } });
server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
await sleep(8000);

console.log("=== 1. dota_launch_game athena_solo（等待相位结果，最长 ~150s）===");
const launch = await tool("dota_launch_game", { map: "athena_solo", timeout: 120 }, 150000);
const launchText = launch.result.content[0].text;
console.log(launchText);

if (launchText.includes("stuck in")) {
  console.log("\n=== 2. 按指引推进：dota_run_lua GameRules:FinishCustomGameSetup() ===");
  const adv = await tool("dota_run_lua", { code: "GameRules:FinishCustomGameSetup()" }, 30000);
  console.log(adv.result.content[0].text);
  await sleep(5000);
  console.log("\n=== 3. dota_status 确认相位变化 ===");
  const st = await tool("dota_status", {}, 30000);
  console.log(st.result.content[0].text);
}

server.kill();
console.log("DONE");
process.exit(0);

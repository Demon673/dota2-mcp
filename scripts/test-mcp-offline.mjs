// 一次性离线 MCP 冒烟：服务器启动 + dota_status 不抛异常 + 契约报错 + 新 skill 可加载
// 端口随机化隔离：不受本机正在运行的 daemon/Dota 影响（env 直达 spawned daemon）
import { spawn } from "node:child_process";

const BASE = 20000 + Math.floor(Math.random() * 20000);
const env = {
  ...process.env,
  DOTA2_VCON_DOTA_PORT: String(BASE),
  DOTA2_VCON_GUI_PORT: String(BASE + 1),
  DOTA2_VCON_CTRL_PORT: String(BASE + 2),
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
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined) responses.set(msg.id, msg);
    } catch { /* 非 JSON 行 */ }
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
      else if (Date.now() - t0 > 45000) { clearInterval(timer); reject(new Error("timeout: " + method)); }
    }, 50);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("ok -", msg);
}

await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
// createRelay 会探测/拉起 daemon，给它点时间
await sleep(12000);

const tools = await call("tools/list", {});
const names = tools.result.tools.map(t => t.name);
assert(!names.includes("project_info"), "project_info removed");
assert(names.includes("dota_open_vconsole"), "dota_open_vconsole registered");
assert(names.length === 22, `22 tools total (got ${names.length})`);

const status = await call("tools/call", { name: "dota_status", arguments: {} });
const statusText = status.result.content[0].text;
assert(!status.result.isError && statusText.includes("not connected"), "dota_status guides without throwing when Dota down");

const send = await call("tools/call", { name: "console_send", arguments: { commands: "echo hi" } });
assert(send.result.isError && send.result.content[0].text.includes("未连接到 Dota 2"), "console_send blocked with actionable text when Dota down");

const skill = await call("tools/call", { name: "dota2_skill", arguments: { name: "dota2-game-phases" } });
assert(skill.result.content[0].text.includes("CUSTOM_GAME_SETUP"), "dota2-game-phases skill loads");

const compileBlocked = await call("tools/call", { name: "dota2_skill", arguments: {} });
assert(compileBlocked.result.content[0].text.includes("dota2-runtime-dev"), "skill list works (non-console tool ungated)");

server.kill();
console.log("PASS");
process.exit(0);

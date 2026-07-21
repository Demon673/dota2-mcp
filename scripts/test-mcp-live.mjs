// 一次性活体 MCP 验证：契约门控 → dota_open_vconsole → 解门控（需要 Dota 2 运行 + daemon 已拉起）
// 自带环境重置：先杀掉已有 vconsole2，保证门控前置条件确定性
import { spawn, execSync } from "node:child_process";

try { execSync("taskkill /F /IM vconsole2.exe", { stdio: "pipe" }); } catch { /* 没有在跑，正常 */ }
await new Promise((r) => setTimeout(r, 1500));

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
      else if (Date.now() - t0 > 60000) { clearInterval(timer); reject(new Error("timeout: " + method)); }
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
await sleep(8000); // 等接入已有 daemon

// 1. Dota 连着但无 vconsole：dota_status 给指引（不抛），console_send 契约报错
const s1 = await call("tools/call", { name: "dota_status", arguments: {} });
assert(!s1.result.isError && s1.result.content[0].text.includes("vconsole is not open"), "dota_status: vconsole guidance (not thrown)");
const c1 = await call("tools/call", { name: "console_send", arguments: { commands: "echo hi" } });
assert(c1.result.isError && c1.result.content[0].text.includes("vconsole 未打开"), "console_send: contract error names the cause");

// 2. dota_open_vconsole 拉起并等待接入
const o1 = await call("tools/call", { name: "dota_open_vconsole", arguments: {} });
console.log("   open result:", o1.result.content[0].text);
assert(!o1.result.isError && o1.result.content[0].text.includes("attached"), "dota_open_vconsole attached");

// 3. 解门控：console_send 通过；dota_status 全量 JSON
const c2 = await call("tools/call", { name: "console_send", arguments: { commands: "echo mcp_live_ok" } });
assert(!c2.result.isError, "console_send passes after vconsole attached");
const s2 = await call("tools/call", { name: "dota_status", arguments: {} });
const txt = s2.result.content[0].text;
assert(!s2.result.isError && txt.includes('"vconsole": true') && txt.includes('"addon": "tui12"'), "dota_status full JSON (vconsole:true, addon detected)");

server.kill();
console.log("PASS");
process.exit(0);

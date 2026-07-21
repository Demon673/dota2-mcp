// test-multi-session.mjs — 多 agent 共享 daemon：A 打开 vconsole，B 同时解门控
// 需要：Dota 2 运行 + daemon 已拉起
import { spawn, execSync } from "node:child_process";

function mcpClient(name) {
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
  const call = (method, params, timeoutMs = 40000) => {
    const id = nextId++;
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const timer = setInterval(() => {
        if (responses.has(id)) { clearInterval(timer); resolve(responses.get(id)); }
        else if (Date.now() - t0 > timeoutMs) { clearInterval(timer); reject(new Error(`timeout: ${name}/${method}`)); }
      }, 50);
    });
  };
  return {
    name,
    call,
    notify: (method, params) => server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"),
    tool: (n, a, t) => call("tools/call", { name: n, arguments: a }, t),
    kill: () => server.kill(),
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("ok -", msg);
}

// 环境重置：无 vconsole
try { execSync("taskkill /F /IM vconsole2.exe", { stdio: "pipe" }); } catch { /* 没在跑 */ }
await sleep(1500);

const A = mcpClient("A");
const B = mcpClient("B");
for (const c of [A, B]) {
  await c.call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: c.name, version: "0" } });
  c.notify("notifications/initialized", {});
}
await sleep(8000);

// A、B 都被门控
const aErr = await A.tool("console_send", { commands: "echo a" });
const bErr = await B.tool("console_send", { commands: "echo b" });
assert(aErr.result.isError && bErr.result.isError, "both sessions gated while vconsole closed");

// A 打开 vconsole
const open = await A.tool("dota_open_vconsole", {}, 60000);
assert(open.result.content[0].text.includes("attached"), "session A opened vconsole");

// B 应同时解门控（guiConnected 经广播同步）
await sleep(1000);
const bOk = await B.tool("console_send", { commands: "echo b_after" });
assert(!bOk.result.isError, "session B unblocked without opening anything");

A.kill();
B.kill();
console.log("PASS");
process.exit(0);

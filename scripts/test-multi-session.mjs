// test-multi-session.mjs — 多 agent 共享 daemon：A 打开 vconsole，B 同时解门控
// 需要：Dota 2 运行 + daemon 已拉起
import { execSync } from "node:child_process";
import { spawnMcpServer, assert, sleep } from "./lib-mcp.mjs";

function mcpClient(name) {
  const mcp = spawnMcpServer({ timeoutMs: 40000 });
  return {
    name,
    call: mcp.call,
    notify: mcp.notify,
    tool: (n, a, t) => mcp.call("tools/call", { name: n, arguments: a }, t),
    kill: mcp.kill,
  };
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

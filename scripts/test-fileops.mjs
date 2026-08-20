// 离线 FileOps 冒烟：file_read/write/edit/delete + 路径边界（不依赖 Dota 进程）
// 用真实 Dota 目录 + DOTA2_TEST_ADDON=dota2mcptest（addon 目录须存在；daemon 不必运行）
import { spawn } from "node:child_process";

const BASE = 20000 + Math.floor(Math.random() * 20000);
const env = {
  ...process.env,
  DOTA2_VCON_DOTA_PORT: String(BASE),
  DOTA2_VCON_GUI_PORT: String(BASE + 1),
  DOTA2_VCON_CTRL_PORT: String(BASE + 2),
  DOTA2_TEST_ADDON: process.env.DOTA2_TEST_ADDON || "dota2mcptest",
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
function callText(result) {
  if (result.error) throw new Error("tool error: " + JSON.stringify(result.error).slice(0, 400));
  return result.result.content.map((c) => c.text).join("");
}
function expectError(result, needle) {
  const isErr = !!(result.result && result.result.isError);
  assert(isErr, "expected error for: " + needle);
  const text = JSON.stringify(result.result);
  assert(text.includes(needle), "error mentions " + needle + " (got " + text.slice(0, 200) + ")");
  console.log("ok - rejected with guidance: " + needle);
}

const ADDON = env.DOTA2_TEST_ADDON;
const TEST_TARGET = "game/dota_addons/" + ADDON + "/_fileops_test.txt";

await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fileops", version: "0" } });
server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
await sleep(12000);

const tools = await call("tools/list", {});
const names = tools.result.tools.map((t) => t.name);
for (const n of ["file_read", "file_write", "file_edit", "file_delete"]) {
  assert(names.includes(n), n + " registered");
}

const w = await call("tools/call", { name: "file_write", arguments: { target: TEST_TARGET, addon: ADDON, content: "hello fileops\nline2\n" } });
assert(callText(w).includes("Wrote"), "file_write works");
const rd = await call("tools/call", { name: "file_read", arguments: { target: TEST_TARGET, addon: ADDON } });
assert(callText(rd) === "hello fileops\nline2\n", "file_read returns written content");
const ed = await call("tools/call", { name: "file_edit", arguments: { target: TEST_TARGET, addon: ADDON, old_string: "hello", new_string: "HELLO" } });
assert(callText(ed).includes("1 replacement"), "file_edit replaces unique match");
const rd2 = await call("tools/call", { name: "file_read", arguments: { target: TEST_TARGET, addon: ADDON } });
assert(callText(rd2) === "HELLO fileops\nline2\n", "file_edit content correct");
const edDup = await call("tools/call", { name: "file_edit", arguments: { target: TEST_TARGET, addon: ADDON, old_string: "\n", new_string: "" } });
expectError(edDup, "appears");
const del = await call("tools/call", { name: "file_delete", arguments: { target: TEST_TARGET, addon: ADDON } });
const delText = callText(del);
assert(delText.includes("Deleted") && delText.includes("HELLO fileops"), "file_delete removes and snapshots");
const rd3 = await call("tools/call", { name: "file_read", arguments: { target: TEST_TARGET, addon: ADDON } });
assert(rd3.result && rd3.result.isError, "file_read after delete errors");
const oob1 = await call("tools/call", { name: "file_write", arguments: { target: "game/dota_addons/not_an_addon/x.txt", addon: ADDON, content: "x" } });
expectError(oob1, "outside addon");
const oob2 = await call("tools/call", { name: "file_write", arguments: { target: "content/dota_addons/" + ADDON + "/../../escape.txt", addon: ADDON, content: "x" } });
expectError(oob2, "outside addon");
const oob3 = await call("tools/call", { name: "file_write", arguments: { target: "game/dota/materials/x.txt", addon: ADDON, content: "x" } });
expectError(oob3, "outside addon");

console.log("PASS");
process.exit(0);

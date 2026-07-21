// test-crash-recovery.mjs — 崩溃恢复全链路：同一 MCP 会话经历 杀 Dota → 检测 → 重启 → 自恢复
// 需要：Dota 2 运行 + daemon 已拉起 + vconsole 已接入
// 不写死机器路径/项目名：Dota 路径自动检测；addon 从 daemon 握手信息推断
// （可用 DOTA2_TEST_ADDON 覆盖；推断不出来时报错提示指定，不默默用默认）
import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { helloOk } from "./lib-ctrl.mjs";

const { detectDotaPath } = await import("../dist/tools/console-bridge.js");
const dotaPath = await detectDotaPath();
if (!dotaPath) { console.error("FAIL: cannot detect Dota 2 path"); process.exit(1); }
const hello = await helloOk();
const ADDON = process.env.DOTA2_TEST_ADDON || hello.addon;
if (!ADDON) { console.error("FAIL: 无法推断测试 addon。请设 DOTA2_TEST_ADDON，或先用目标 addon 启动 Dota 2"); process.exit(1); }
const DOTA_EXE = path.join(dotaPath, "game", "bin", process.platform === "win32" ? "win64" : "linuxsteamrt64", process.platform === "win32" ? "dota2.exe" : "dota2");
// 启动参数因人/项目/地区而异（如 -perfectworld）：默认最小集，DOTA2_TEST_ARGS 传完整参数覆盖
const DOTA_ARGS = process.env.DOTA2_TEST_ARGS ? process.env.DOTA2_TEST_ARGS.split(/\s+/) : ["-addon", ADDON, "-tools"];
console.log("addon:", ADDON, "| dota:", DOTA_EXE);

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
function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("ok -", msg);
}
const vconsoleAlive = () => {
  try { return execSync('tasklist /FI "IMAGENAME eq vconsole2.exe" /NH', { encoding: "utf-8" }).includes("vconsole2.exe"); }
  catch { return false; }
};

await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "crash-test", version: "0" } });
server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
await sleep(8000);

// 1. 前置：游戏在跑，console_send 可用
const pre = await tool("console_send", { commands: "echo before_crash" });
assert(!pre.result.isError, "console_send works before crash");

// 2. 杀掉 Dota 2（模拟闪退）
console.log("=== killing dota2.exe ===");
try { execSync("taskkill /F /IM dota2.exe", { stdio: "pipe" }); } catch { /* 已不在 */ }

// 3. relay 应检测到断线 → 工具报「未连接」（FIN 快路径 ~2s；挂起慢路径 ~35s）
let detected = false;
for (let i = 0; i < 30 && !detected; i++) {
  await sleep(2000);
  const r = await tool("console_send", { commands: "echo after_crash" });
  if (r.result.isError && r.result.content[0].text.includes("未连接到 Dota 2")) detected = true;
}
assert(detected, "crash detected: tools report 未连接到 Dota 2");
assert(vconsoleAlive(), "vconsole2.exe survives dota2 crash");

// 4. 重启 Dota 2（不碰 vconsole、不碰 MCP 会话）
console.log("=== relaunching dota2.exe ===");
const dp = spawn(DOTA_EXE, DOTA_ARGS, { detached: true, stdio: "ignore" });
dp.unref();

// 5. relay 应自动重连 → 同一会话工具恢复（vconsole 全程未动）
let recovered = false;
for (let i = 0; i < 60 && !recovered; i++) {
  await sleep(3000);
  const r = await tool("console_send", { commands: "echo after_relaunch" });
  if (!r.result.isError) recovered = true;
}
assert(recovered, "auto-recovered after Dota relaunch (same MCP session, vconsole untouched)");

// 6. dota_status 全量恢复（addon 重新检测）
const st = await tool("dota_status", {}, 45000);
const txt = st.result.content[0].text;
assert(txt.includes('"vconsole": true') && txt.includes(`"addon": "${ADDON}"`), "dota_status fully recovered (vconsole:true, addon re-detected)");

server.kill();
console.log("PASS");
process.exit(0);

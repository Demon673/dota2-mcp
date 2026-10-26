// scripts/test-relay.mjs — VConRelay 离线冒烟（不需要 Dota 2）
// 严格门控模型场景: 1) 无 GUI 只探测不连接 + auto-open 就绪沿 2) GUI 接入才连+初始化帧
// 3) 活性探针 pong 存活/无 pong 判死(GUI 在才重连) 4) GUI 断开即断 Dota 回探测态
// 5) Dota 消失 ready:false；回来→新就绪沿再 auto-open 6) 进程在/禁用不 auto-open
// 7) RelayClient 断线期间的命令丢弃不补发 8) 异步 MCP 输出过滤 + 定时 GUI 抑制 + SHUTDOWN
// 9) 多会话标记窗口交错 + 未闭合窗口超时
import net from "node:net";
import { freePortBlock } from "./lib-test-ports.mjs";

const BASE = await freePortBlock(4);
process.env.DOTA2_VCON_DOTA_PORT = String(BASE);
process.env.DOTA2_VCON_GUI_PORT = String(BASE + 1);
process.env.DOTA2_VCON_CTRL_PORT = String(BASE + 2);

const { VConRelay } = await import("../dist/tools/vcon-relay.js");

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("ok -", msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (cond()) return;
    await sleep(50);
  }
  console.error("FAIL: timeout waiting for", what);
  process.exit(1);
}

function frame(type, payload = 44) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.alloc(payload);
  const head = Buffer.alloc(12);
  head.write(type, 0, 4, "ascii");
  head.writeUInt16BE(212, 4);
  head.writeUInt32BE(12 + body.length, 6);
  head.writeUInt16BE(0, 10);
  return Buffer.concat([head, body]);
}
function prntFrame(text) {
  const body = Buffer.concat([Buffer.alloc(28), Buffer.from(text, "ascii"), Buffer.from([0])]);
  const head = Buffer.alloc(12);
  head.write("PRNT", 0, 4, "ascii");
  head.writeUInt16BE(212, 4);
  head.writeUInt32BE(12 + body.length, 6);
  head.writeUInt16BE(0, 10);
  return Buffer.concat([head, body]);
}

const INIT = ["AINF", "CHAN", "CVRB", "CFGV", "ADON"];
// 一个真实结构的 CHAN 帧：count(2) + 24 字节固定字段 + 34 字节名称
const chanPayload = Buffer.alloc(60);
chanPayload.writeInt16BE(1, 0);
chanPayload.writeUInt32BE(7, 2);
chanPayload.write("VScript", 26, "utf8");
// fake Dota：可关闭/重启；统计「持有连接」（存活≥400ms）与「探针连接」（秒关）
let replyToProbe = false;
let gotProbe = false;
let server = null;
const stats = { held: new Set(), probes: 0, real: 0 };
function startServer() {
  return new Promise((resolve) => {
    server = net.createServer((sock) => {
      sock.on("error", () => {}); // relay 侧断开/退出时会 reset，属预期
      const t0 = Date.now();
      let held = false;
      sock._heldTimer = setTimeout(() => { held = true; stats.held.add(sock); stats.real++; }, 400);
      for (const t of INIT) sock.write(frame(t, t === "CHAN" ? chanPayload : t === "AINF" ? 128 : 44));
      sock.on("data", (d) => {
        if (d.includes("__mcp_ping__")) {
          gotProbe = true;
          if (replyToProbe) sock.write(prntFrame("__mcp_ping__"));
        }
      });
      sock.on("close", () => {
        clearTimeout(sock._heldTimer);
        if (!held) stats.probes++;
        stats.held.delete(sock);
      });
    });
    server.listen(BASE, "127.0.0.1", resolve);
  });
}
async function stopServer() {
  for (const s of stats.held) s.destroy();
  await new Promise((r) => server.close(r));
}

const mkGui = () => {
  const g = net.connect(BASE + 1, "127.0.0.1");
  g.on("error", () => {});
  return g;
};
function attachCtrl(statusSink) {
  const ctrl = net.connect(BASE + 2, "127.0.0.1");
  ctrl.on("error", () => {}); // relay 关闭时会 reset 客户端连接
  let buf = "";
  ctrl.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const m = JSON.parse(line); if (m.type === "status") statusSink.push(m); } catch { /* 其它行 */ }
    }
  });
  ctrl.write("HELLO\n");
  setTimeout(() => ctrl.write("STREAM\n"), 200);
  return ctrl;
}

await startServer();

// ── 场景 1：无 GUI → 只探测不连接；就绪上升沿 auto-open ─────────────
let spawnCalls = 0;
let procExists = false;
const relay = new VConRelay(
  { probeIntervalMs: 200, silenceMs: 300, pongTimeoutMs: 600, readyProbeIntervalMs: 300, markerWindowMs: 400 },
  { spawnFn: () => { spawnCalls++; return true; }, processRunningFn: () => procExists }
);
relay.setDotaPath("fake");
await relay.start();
await waitFor(() => spawnCalls === 1, 5000, "auto-open on ready rising edge");
assert(true, "auto-open on ready rising edge");
await sleep(1000);
assert(stats.held.size === 0 && stats.real === 0, "no GUI -> probe only, never holds 29000");
assert(stats.probes >= 2, "readiness probe keeps firing");

// ── 场景 2：GUI 接入 → 真连接 + 初始化帧实时流过 + status 广播 ──────
const statusMsgs = [];
const ctrl = attachCtrl(statusMsgs);
await sleep(300);
const gui = mkGui();
let guiBuf = Buffer.alloc(0);
gui.on("data", (d) => { guiBuf = Buffer.concat([guiBuf, d]); });
await waitFor(() => stats.real === 1, 5000, "real Dota connection after GUI attach");
assert(true, "GUI attach -> relay connects to Dota");
await waitFor(() => statusMsgs.some((m) => m.gui === true && m.ready === true), 5000, "status gui:true ready:true");
assert(true, "status broadcast gui:true ready:true");
await sleep(500);
const got = [];
while (guiBuf.length >= 12) {
  const len = guiBuf.readUInt32BE(6);
  if (len < 12 || guiBuf.length < len) break;
  got.push(guiBuf.toString("ascii", 0, 4));
  guiBuf = guiBuf.subarray(len);
}
assert(JSON.stringify(got) === JSON.stringify(INIT), `GUI received init frames: ${got.join(",")}`);

// ── 场景 2b：异步 MCP 输出不得泄漏到 GUI，但 MCP 缓冲仍要收到 ──
const mcpSeen = [];
relay.on("prnt", (m) => mcpSeen.push(String(m.text)));
const pushGui = (text) => { for (const s of stats.held) s.write(prntFrame(text)); };
const asyncMcpLines = [
  "[D2MCP-test:ACK] id started 1",
  "[MCP-LUA] IsServer: true",
  "[MCP-ADV] player 0 team=2",
  "[MCP-VFX] pid=123",
  "[MCP-TEST] pass|1|ok",
  "MCP_BRIDGE_READY test",
  "MCP_ACK_FAIL test",
];
for (const line of asyncMcpLines) pushGui(line);
await sleep(300);
for (const line of asyncMcpLines) {
  assert(!guiBuf.includes(line), `async MCP line filtered from GUI: ${line}`);
  assert(mcpSeen.includes(line), `async MCP line still reaches the MCP buffer: ${line}`);
}
const humanLine = "ordinary addon output " + Date.now();
pushGui(humanLine);
await sleep(200);
assert(guiBuf.includes(humanLine), "ordinary console output still reaches the GUI");
relay.setMcpSuppressEnabled(false);
const visibleMcp = "[MCP-LUA] visible after opt-out " + Date.now();
pushGui(visibleMcp);
await sleep(200);
assert(guiBuf.includes(visibleMcp), "auto:false lets MCP-prefixed output reach the GUI again");
relay.setMcpSuppressEnabled(true);

// echo 收集标记同时是 GUI 屏蔽边界：同步命令输出夹在 begin/end 之间
const beginLine = "__mcp_abcdef01_begin";
const endLine = "__mcp_abcdef01_end";
const insideMarker = "inside-marker-output " + Date.now();
pushGui(beginLine);
pushGui(insideMarker);
pushGui(endLine);
await sleep(200);
assert(!guiBuf.includes(insideMarker), "output between echo markers is filtered from the GUI");
assert(mcpSeen.includes(insideMarker), "output between echo markers still reaches the MCP buffer");
const afterMarker = "after-marker-output " + Date.now();
pushGui(afterMarker);
await sleep(150);
assert(guiBuf.includes(afterMarker), "output after the end marker reaches the GUI again");

// 多会话：两个窗口交错，B 的 end 不能关掉 A 的窗口
pushGui("__mcp_aaaa0001_begin");
const outB = "session-b-output " + Date.now();
pushGui("__mcp_bbbb0002_begin");
pushGui(outB);
pushGui("__mcp_bbbb0002_end");
const outA = "session-a-deferred " + Date.now();
pushGui(outA);
await sleep(150);
assert(!guiBuf.includes(outB), "session B output hidden inside its window");
assert(!guiBuf.includes(outA), "session A window survives B's end marker");
pushGui("__mcp_aaaa0001_end");
const afterBoth = "after-two-windows " + Date.now();
pushGui(afterBoth);
await sleep(150);
assert(guiBuf.includes(afterBoth), "GUI resumes after both windows close");

// 只有 begin 没有 end：窗口在 markerWindowMs 后自动过期
pushGui("__mcp_cccc0003_begin");
const stuck = "stuck-window-line " + Date.now();
pushGui(stuck);
await sleep(150);
assert(!guiBuf.includes(stuck), "unclosed window hides its output");
await sleep(500);
const afterExpiry = "after-window-expiry " + Date.now();
pushGui(afterExpiry);
await sleep(150);
assert(guiBuf.includes(afterExpiry), "unclosed window expires and GUI resumes");

// 定时 GUI 抑制：窗口内所有 PRNT 都不进 GUI（MCP 缓冲照收），到期自动恢复
const holdLine = "held output " + Date.now();
relay.holdGuiSuppression(500);
pushGui(holdLine);
await sleep(150);
assert(!guiBuf.includes(holdLine), "held window suppresses GUI output");
assert(mcpSeen.includes(holdLine), "held output still reaches the MCP buffer");
await sleep(500);
const afterHold = "after hold " + Date.now();
pushGui(afterHold);
await sleep(150);
assert(guiBuf.includes(afterHold), "GUI output resumes after the hold expires");

// 优雅停机：控制口 SHUTDOWN → shutdown-requested（由 daemon 负责 FIN + 排空）
const shutdownSeen = new Promise((resolve) => relay.once("shutdown-requested", resolve));
ctrl.write("SHUTDOWN\n");
const gotShutdown = await Promise.race([shutdownSeen.then(() => true), sleep(2000).then(() => false)]);
assert(gotShutdown, "control SHUTDOWN emits shutdown-requested");


// 晚接入的瘦客户端必须直接从 hello-ok 得到已注册通道，不能等下一次 CHAN
const { RelayClient } = await import("../dist/relay-client.js");
const lateClient = new RelayClient({ port: BASE + 2, token: null });
await lateClient.connect();
assert(lateClient.getChannels().includes("VScript"), "late thin client receives existing channels in hello-ok");
lateClient.destroy();

// ── 场景 3：连接态活性探测：pong 保活 → 无 pong 判死 → GUI 在故重连 ──
replyToProbe = true;
await waitFor(() => gotProbe, 5000, "echo probe after silence");
await sleep(1200);
assert(stats.real === 1, "pong keeps connection alive");
assert(!guiBuf.includes("__mcp_ping__"), "probe echo filtered from GUI");
replyToProbe = false;
await waitFor(() => stats.real === 2, 8000, "no pong -> kill -> reconnect (GUI present)");
assert(true, "no pong -> killed and reconnected");

// ── 场景 4：GUI 断开 → relay 断开 Dota → 回探测态；就绪未变不再 auto-open ──
gui.destroy();
await waitFor(() => statusMsgs.some((m) => m.gui === false), 5000, "status gui:false on detach");
assert(true, "status gui:false on detach");
await waitFor(() => stats.held.size === 0, 5000, "Dota connection dropped on GUI detach");
assert(true, "GUI detach -> relay drops 29000");
const probesBefore = stats.probes;
await waitFor(() => stats.probes > probesBefore, 5000, "back to readiness probing");
assert(true, "back to probing after GUI detach");
await sleep(1000);
assert(spawnCalls === 1, "no respawn (ready never fell, no new rising edge)");

// ── 场景 5：Dota 消失 → ready:false；回来 → 新就绪沿 → 再次 auto-open ──
await stopServer();
await waitFor(() => statusMsgs.some((m) => m.ready === false), 8000, "ready:false when Dota gone");
assert(true, "ready:false broadcast when Dota gone");
await startServer();
await waitFor(() => spawnCalls === 2, 8000, "auto-open again on new rising edge");
assert(true, "auto-open again on new rising edge (Dota returned)");

// ── 场景 6：已有进程 / 禁用 → 不 auto-open ─────────────────────────
relay.close();
ctrl.destroy();
await sleep(300);
procExists = true;
const relay2 = new VConRelay(
  { probeIntervalMs: 200, silenceMs: 300, pongTimeoutMs: 600, readyProbeIntervalMs: 300 },
  { spawnFn: () => { spawnCalls++; return true; }, processRunningFn: () => procExists }
);
relay2.setDotaPath("fake");
await relay2.start();
await sleep(1200);
assert(spawnCalls === 2, "no spawn while vconsole2 process exists");
const relay3 = new VConRelay(
  { probeIntervalMs: 200, silenceMs: 300, pongTimeoutMs: 600, readyProbeIntervalMs: 300 },
  { enabled: false, spawnFn: () => { spawnCalls++; return true; }, processRunningFn: () => false }
);
relay3.setDotaPath("fake");
await relay3.start();
await sleep(1200);
assert(spawnCalls === 2, "auto-open disabled -> no spawn");

// 7) RelayClient 断线期间的命令直接丢弃，重连后不补发（补发过期的 restart 比丢掉更糟）
{
  const { RelayClient } = await import("../dist/relay-client.js");
  const lines = [];
  const socks = [];
  const ctrl = net.createServer((s) => {
    socks.push(s);
    let buf = "";
    s.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        lines.push(line);
        if (line.startsWith("HELLO")) s.write(JSON.stringify({ type: "hello-ok" }) + "\n");
      }
    });
    s.on("error", () => {});
  });
  await new Promise((r) => ctrl.listen(BASE + 3, "127.0.0.1", r));
  const client = new RelayClient({ port: BASE + 3, token: null });
  await client.connect();
  socks[0].destroy();
  await sleep(100);
  client.sendCommand("echo dropped");
  await waitFor(() => socks.length >= 2 && lines.filter((l) => l.startsWith("HELLO")).length >= 2, 5000, "client re-handshake");
  client.sendCommand("echo live");
  await waitFor(() => lines.includes("CMD:echo live"), 2000, "command after reconnect delivered");
  assert(!lines.includes("CMD:echo dropped"), "command sent while disconnected is not replayed after reconnect");
  client.destroy();
  ctrl.close();
}

relay2.close();
relay3.close();
await stopServer();
console.log("PASS");
process.exit(0);

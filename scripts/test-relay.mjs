// scripts/test-relay.mjs — VConRelay 离线冒烟（不需要 Dota 2）
// 场景: 1) 僵尸(收不到AINF)判死重连 2) 初始化帧重放 3) echo 探针 pong 存活+过滤 4) 无 pong 判死
import net from "node:net";

const BASE = 20000 + Math.floor(Math.random() * 20000);
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

function frame(type, payloadLen = 44) {
  const head = Buffer.alloc(12);
  head.write(type, 0, 4, "ascii");
  head.writeUInt16BE(212, 4);
  head.writeUInt32BE(12 + payloadLen, 6);
  head.writeUInt16BE(0, 10);
  return Buffer.concat([head, Buffer.alloc(payloadLen)]);
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

// AINF 解析会读到 offset 80+，payload 必须 ≥85，否则 parseAinfPayload 抛越界
const INIT = ["AINF", "CHAN", "CVRB", "CFGV", "ADON"];
let phase = "zombie";        // zombie: 连接后一言不发 | init: 连接后发初始化序列
let replyToProbe = false;    // 是否回应 echo 探针
let connections = 0;
let gotProbe = false;
const server = net.createServer((sock) => {
  connections++;
  if (phase === "init") for (const t of INIT) sock.write(frame(t, t === "AINF" ? 128 : 44));
  sock.on("data", (d) => {
    if (d.includes("__mcp_ping__")) {
      gotProbe = true;
      if (replyToProbe) sock.write(prntFrame("__mcp_ping__"));
    }
  });
});
await new Promise((r) => server.listen(BASE, "127.0.0.1", r));

const relay = new VConRelay({ probeIntervalMs: 200, silenceMs: 300, pongTimeoutMs: 600, ainfTimeoutMs: 400 });
await relay.start();

// 场景 1：僵尸连接（accept 但无 AINF）→ 判死并重连
await waitFor(() => connections >= 2, 8000, "zombie kill + reconnect");
assert(true, "zombie connection killed and reconnected");

// 场景 2：下个连接发初始化帧 → 晚到 GUI 收到重放
phase = "init";
await waitFor(() => connections >= 3, 8000, "connect #3 with init frames");
await sleep(300);
const gui = net.connect(BASE + 1, "127.0.0.1");
let buf = Buffer.alloc(0);
gui.on("data", (d) => { buf = Buffer.concat([buf, d]); });
await sleep(800);
const got = [];
while (buf.length >= 12) {
  const len = buf.readUInt32BE(6);
  if (len < 12 || buf.length < len) break;
  got.push(buf.toString("ascii", 0, 4));
  buf = buf.subarray(len);
}
assert(JSON.stringify(got) === JSON.stringify(INIT), `late GUI received init replay in order: ${got.join(",")}`);

// 场景 3：场景 2 静默期发出的探针（replyToProbe=false）必然把 #3 杀死重连；
// 在全新连接 #4 上开启 pong 回复，干净地验证 pong 保活 + ping 行不转发 GUI
await waitFor(() => connections >= 4, 8000, "stale probe kills #3");
gotProbe = false;
replyToProbe = true;
await waitFor(() => gotProbe, 5000, "probe sent after silence");
await sleep(1200); // > pongTimeoutMs(600)：pong 若未生效连接必死
assert(connections === 4, "pong keeps connection alive (no kill)");
assert(!buf.includes("__mcp_ping__"), "probe echo filtered from GUI");

// 场景 4：不再回应探针 → pong 超时判死重连
replyToProbe = false;
await waitFor(() => connections >= 5, 8000, "probe timeout kill + reconnect");
assert(true, "no pong -> killed and reconnected");

relay.close();
server.close();
console.log("PASS");
process.exit(0);

// scripts/test-relay.mjs — VConRelay 离线冒烟（不需要 Dota 2）
// 用法: node scripts/test-relay.mjs
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

// fake Dota: 每个连接到来立刻发完整初始化序列
// （AINF 解析会读到 offset 80+，payload 必须 ≥85，否则 parseAinfPayload 抛越界）
const INIT = ["AINF", "CHAN", "CVRB", "CFGV", "ADON"];
const server = net.createServer((sock) => {
  for (const t of INIT) sock.write(frame(t, t === "AINF" ? 128 : 44));
});
await new Promise((r) => server.listen(BASE, "127.0.0.1", r));

const relay = new VConRelay();
await relay.start();
await sleep(500); // 等 relay 连上 fake Dota 并吃完初始化帧

// 晚到的 GUI：连上 relay 的 GUI 口，应收到完整重放
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

relay.close();
server.close();
console.log("PASS");
process.exit(0);

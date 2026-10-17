// 离线冒烟：控制台类工具只收本命令边界标记之间的输出（collectOutput 的 begin/end 回显）。
// 假 Dota 只替换引擎边界：解析 CMND、回显 echo、应答 help，并在标记外插入噪声行；
// 假 GUI 接入 :GUI 打开契约门控。relay/daemon/MCP server 全走真实实现。无需 Dota。
import * as net from "node:net";
import { spawnMcpServer, assert, sleep } from "./lib-mcp.mjs";

const BASE = 20000 + Math.floor(Math.random() * 20000);
const env = {
  ...process.env,
  DOTA2_VCON_DOTA_PORT: String(BASE),
  DOTA2_VCON_GUI_PORT: String(BASE + 1),
  DOTA2_VCON_CTRL_PORT: String(BASE + 2),
  DOTA2_VCON_AUTO_OPEN_VCONSOLE: "0",
};

function frame(type, payload) {
  const h = Buffer.alloc(12);
  h.write(type, 0, 4, "ascii");
  h.writeUInt16BE(212, 4);
  h.writeUInt32BE(12 + payload.length, 6);
  return Buffer.concat([h, payload]);
}
const prnt = (text) => frame("PRNT", Buffer.concat([Buffer.alloc(28), Buffer.from(text + "\0", "utf-8")]));

// 假 Dota：每条 CMND 按 ; 拆分执行；begin 之前和 end 之后各插一行噪声，模拟游戏自身/其他会话的打印；其余命令回一行中文
const received = []; // 假 Dota 收到的 CMND 原文（UTF-8 解码），用于断言出站编码
const dota = net.createServer((sock) => {
  let buf = Buffer.alloc(0);
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 12 && buf.length >= buf.readUInt32BE(6)) {
      const len = buf.readUInt32BE(6);
      const cmd = buf.subarray(12, len).toString("utf-8").replace(/\0/g, "");
      received.push(cmd);
      buf = buf.subarray(len);
      for (const part of cmd.split(";").map((s) => s.trim()).filter(Boolean)) {
        if (part.startsWith("echo ")) {
          const text = part.slice(5);
          if (text.endsWith("_begin")) sock.write(prnt("noise_outside_window"));
          sock.write(prnt(text));
          if (text.endsWith("_end")) sock.write(prnt("noise_outside_window"));
        } else if (part !== "ai_disabled") {
          sock.write(prnt(`${part} - 中文帮助行`));
        }
      }
    }
  });
  sock.on("error", () => {});
});
await new Promise((r) => dota.listen(BASE, "127.0.0.1", r));

const { call, notify, kill } = spawnMcpServer({ timeoutMs: 45000, env });
await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "collect", version: "0" } });
notify("notifications/initialized");
await sleep(12000);

// 假 GUI 接入 → relay 才连假 Dota（契约门控）
const gui = net.connect(BASE + 1, "127.0.0.1");
gui.on("data", () => {});
gui.on("error", () => {});
await sleep(3000);

const r = await call("tools/call", { name: "dota_api_css", arguments: { prop: "wash-color" } });
assert(!r.result.isError, "dota_api_css ok: " + JSON.stringify(r.result).slice(0, 300));
const text = r.result.content[0].text;
assert(text.includes("中文帮助行"), "UTF-8 output decoded: " + text);
assert(!text.includes("noise_outside_window"), "noise outside markers excluded: " + text);
assert(!/__mcp_[0-9a-f]+_/.test(text), "markers stripped: " + text);

const log = await call("tools/call", { name: "console_output", arguments: { lines: 50 } });
assert(!/__mcp_[0-9a-f]+_/.test(log.result.content[0].text), "markers kept out of console_output");

// 出站：中文命令按 UTF-8 编码到达引擎（ascii 编码会截掉高位字节）
const sent = await call("tools/call", { name: "console_send", arguments: { commands: "echo 中文出站" } });
assert(!sent.result.isError, "console_send ok");
await sleep(500);
assert(received.some((c) => c.includes("echo 中文出站")), "outbound command UTF-8 intact: " + JSON.stringify(received.slice(-2)));

gui.destroy();
dota.close();
kill();
console.log("PASS");
process.exit(0);

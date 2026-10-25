// scripts/test-console-send.mjs — console_send 原子回显的离线验证（不需要 Dota 2）
// 真实 MCP stdio server + 真实 relay（daemon 或本地退化）+ 假 VCon 引擎 + 假 GUI：
// 1) 门控：无 Dota → dota_down；Dota 就绪但无 vconsole → vconsole_closed（且不发命令）；
// 2) 一次调用只返回自己标记窗口内的行，annotations 与五段式描述齐全；
// 3) 紧随的 console_output 不重复该窗口；
// 4) 结束标记之后同块到达的延迟输出仍留在游标之后，后续读取可见；
// 5) 多行 commands 仍按换行分条执行；空命令列表 → invalid_arg。
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnMcpServer, callJson, assert, sleep } from "./lib-mcp.mjs";
import { freePortBlock } from "./lib-test-ports.mjs";

const BASE = await freePortBlock(3);
const stateDir = mkdtempSync(path.join(tmpdir(), "mcp-console-send-"));
const env = {
  ...process.env,
  DOTA2_VCON_DOTA_PORT: String(BASE),
  DOTA2_VCON_GUI_PORT: String(BASE + 1),
  DOTA2_VCON_CTRL_PORT: String(BASE + 2),
  DOTA2_VCON_STATE_DIR: stateDir,
  DOTA2_VCON_AUTO_OPEN_VCONSOLE: "0",
  DOTA2_CAPTURE_DISABLE_WATCHER: "1",
};

function frame(type, payload = 44) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.alloc(payload);
  const head = Buffer.alloc(12);
  head.write(type, 0, 4, "ascii");
  head.writeUInt16BE(212, 4);
  head.writeUInt32BE(12 + body.length, 6);
  head.writeUInt16BE(0, 10);
  return Buffer.concat([head, body]);
}
// PRNT 前缀 28B：channel id 7 对应下方 CHAN 注册的 VScript，verbosity 0
function prntFrame(text) {
  const prefix = Buffer.alloc(28);
  prefix.writeUInt32BE(7, 0);
  const body = Buffer.concat([prefix, Buffer.from(text, "utf-8"), Buffer.from([0])]);
  const head = Buffer.alloc(12);
  head.write("PRNT", 0, 4, "ascii");
  head.writeUInt16BE(212, 4);
  head.writeUInt32BE(12 + body.length, 6);
  head.writeUInt16BE(0, 10);
  return Buffer.concat([head, body]);
}
const chanPayload = Buffer.alloc(60);
chanPayload.writeInt16BE(1, 0);
chanPayload.writeUInt32BE(7, 2);
chanPayload.write("VScript", 26, "utf8");

/** 假引擎按标记窗口回复：窗口内的每条 `echo X` 打印 X，结束标记后同一 TCP 块再送一条延迟行 */
let commandsSeen = 0;
function answerCommand(sock, raw) {
  const cmd = raw.replace(/\0/g, "").trim();
  if (cmd.includes("__mcp_ping__")) { sock.write(prntFrame("__mcp_ping__")); return; }
  const begin = cmd.match(/__mcp_[0-9a-f]{8}_begin/)?.[0];
  const end = cmd.match(/__mcp_[0-9a-f]{8}_end/)?.[0];
  if (!begin || !end) return;
  commandsSeen++;
  const inner = cmd.slice(cmd.indexOf(begin) + begin.length, cmd.indexOf(end));
  const echoes = [...inner.matchAll(/(?:^|;)\s*echo\s+([^;]+?)\s*(?=;|$)/g)].map((m) => m[1].trim());
  const frames = [prntFrame(begin), ...echoes.map((e) => prntFrame(e)), prntFrame(end), prntFrame("delayed-after-window")];
  // 一个 write = relay 一次 data 事件：结束标记后、响应构造前，延迟行已经被分配 seq
  sock.write(Buffer.concat(frames));
}

// 假 VCon 引擎：就绪探针连上即断；GUI 接入后 relay 持有连接（400ms 未断）即为可写 socket
let engine = null;
let held = null;
function startEngine() {
  engine = net.createServer((sock) => {
    sock.on("error", () => {});
    for (const t of ["AINF", "CHAN", "CVRB", "CFGV", "ADON"]) {
      sock.write(frame(t, t === "CHAN" ? chanPayload : t === "AINF" ? 128 : 44));
    }
    const heldTimer = setTimeout(() => { held = sock; }, 400);
    sock.on("data", (d) => answerCommand(sock, d.toString("utf8")));
    sock.on("close", () => clearTimeout(heldTimer));
  });
  return new Promise((r) => engine.listen(BASE, "127.0.0.1", r));
}

const { call, notify, kill } = spawnMcpServer({ timeoutMs: 60000, env, cleanupDaemon: true });
const out = (r) => callJson(r);
const consoleOutput = async (args = {}) =>
  out(await call("tools/call", { name: "console_output", arguments: args }));
const consoleSend = async (commands) =>
  out(await call("tools/call", { name: "console_send", arguments: { commands } }));

async function waitFor(fn, timeoutMs, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fn();
    if (r) return r;
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${what}`);
}

try {
  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "send", version: "0" } });
  notify("notifications/initialized");

  const sendTool = (await call("tools/list", {})).result.tools.find((t) => t.name === "console_send");
  assert(sendTool?.annotations?.readOnlyHint === false && sendTool.annotations.destructiveHint === true
    && sendTool.annotations.idempotentHint === false && sendTool.annotations.openWorldHint === false,
    "console_send advertises executable annotations (not read-only, destructive, non-idempotent, closed world)");
  assert(["Use when", "Returns", "Limits:", "Related tools:"].every((part) => sendTool.description.includes(part))
    && sendTool.description.includes("console_output"),
    "console_send description covers use/behavior/returns/limits/related tools and names console_output");

  // ── 门控：先无 Dota，再 Dota 就绪但无 vconsole ──────────────
  const down = await consoleSend("echo gate");
  assert(down.ok === false && down.code === "dota_down", "console_send without Dota returns {ok:false,code:'dota_down'}");
  const downRaw = await call("tools/call", { name: "console_send", arguments: { commands: "echo gate" } });
  assert(downRaw.result.isError === true, "gated console_send sets isError");

  await startEngine();
  const noGui = await waitFor(async () => {
    const r = await consoleSend("echo gate");
    return r.code === "vconsole_closed" ? r : null;
  }, 30000, "vconsole_closed gate");
  assert(noGui.ok === false && noGui.code === "vconsole_closed" && noGui.message.includes("vconsole"),
    "console_send with Dota ready but no vconsole returns {ok:false,code:'vconsole_closed'}");
  assert(commandsSeen === 0, "gated console_send never reaches the engine");

  // ── 打开 vconsole 门控 ─────────────────────────────────────
  const gui = net.connect(BASE + 1, "127.0.0.1");
  gui.on("error", () => {});
  gui.on("data", () => {}); // 读掉转发帧，避免回压
  await waitFor(async () => {
    const r = out(await call("tools/call", { name: "console_channels", arguments: {} }));
    return r.ok ? r : null;
  }, 30000, "vconsole gate open");
  await waitFor(() => held !== null, 10000, "relay holds fake engine");

  // 窗口外的旧行：不能被这次回显带回来
  held.write(prntFrame("before-send"));

  // ── 1. 一次调用返回自己窗口内的行，并推进游标 ──────────────
  const first = await consoleSend("echo one");
  assert(first.ok === true && first.count === 1 && first.next_seq === 2 && first.dropped === 0,
    "console_send returns {ok,count,next_seq,dropped} for its own window: " + JSON.stringify(first));
  assert(first.lines === "[VScript][L0] one", "console_send lines hold only the command's own output");
  assert(!first.lines.includes("before-send") && !first.lines.includes("delayed-after-window"),
    "console_send window excludes output before the start and after the end marker");

  // ── 2. 紧随的 console_output 不重复该窗口，延迟行仍可见 ─────
  const afterSend = await consoleOutput();
  assert(afterSend.ok && afterSend.count === 1 && afterSend.next_seq === 3
    && afterSend.lines === "[VScript][L0] delayed-after-window",
    "following console_output skips the echoed window and still sees output emitted after the end marker: " + JSON.stringify(afterSend));

  // ── 3. 多行 commands 仍按换行分条执行 ───────────────────────
  const multi = await consoleSend("echo two\necho three");
  assert(multi.ok && multi.count === 2 && multi.next_seq === 5
    && multi.lines === "[VScript][L0] two\n[VScript][L0] three",
    "newline-separated commands run in order inside one echoed window: " + JSON.stringify(multi));
  const afterMulti = await consoleOutput();
  assert(afterMulti.ok && afterMulti.count === 1 && afterMulti.lines === "[VScript][L0] delayed-after-window",
    "the cursor after a multi-line send sits just past its window");

  // 真正晚到的输出（响应已返回之后才发出）同样可读
  held.write(prntFrame("late-tail"));
  const late = await waitFor(async () => {
    const r = await consoleOutput();
    return r.ok && r.lines.includes("late-tail") ? r : null;
  }, 10000, "late-tail visible");
  assert(late.ok && late.lines === "[VScript][L0] late-tail", "output emitted after console_send returned stays readable");

  // ── 4. 参数错误走统一失败壳 ─────────────────────────────────
  const empty = await consoleSend("\n   \n");
  assert(empty.ok === false && empty.code === "invalid_arg", "empty commands returns {ok:false,code:'invalid_arg'}");

  console.log("PASS");
} finally {
  kill();
  await sleep(300);
  rmSync(stateDir, { recursive: true, force: true });
  try { engine?.close(); } catch { /* ignore */ }
}
process.exit(0);

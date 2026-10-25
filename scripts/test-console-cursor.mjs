// scripts/test-console-cursor.mjs — console_output 游标读取的离线验证（不需要 Dota 2）
// 真实 MCP stdio server + 真实 relay（daemon 或本地退化）+ 假 VCon 引擎 + 假 GUI：
// 1) 首次无游标返回最近 50 行；2) 默认增量只含新增行；3) since_seq 重放；
// 4) tail/lines/from_start 三种回放语义；5) 过滤器不吞未匹配行且 next_seq 推进；
// 6) 10000 行环形缓冲溢出后 dropped 如实 > 0；7) 无效参数返回 {ok:false,code}。
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnMcpServer, callJson, assert, sleep } from "./lib-mcp.mjs";
import { freePortBlock } from "./lib-test-ports.mjs";

const BASE = await freePortBlock(3);
const stateDir = mkdtempSync(path.join(tmpdir(), "mcp-console-cursor-"));
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

// 假 VCon 引擎：就绪探针连上即断；GUI 接入后 relay 持有连接（400ms 未断）即为可写 socket
let engine = null;
let held = null;
engine = net.createServer((sock) => {
  sock.on("error", () => {});
  for (const t of ["AINF", "CHAN", "CVRB", "CFGV", "ADON"]) {
    sock.write(frame(t, t === "CHAN" ? chanPayload : t === "AINF" ? 128 : 44));
  }
  const heldTimer = setTimeout(() => { held = sock; }, 400);
  sock.on("data", (d) => {
    if (d.includes("__mcp_ping__")) sock.write(prntFrame("__mcp_ping__")); // 活性探针回声
  });
  sock.on("close", () => clearTimeout(heldTimer));
});
await new Promise((r) => engine.listen(BASE, "127.0.0.1", r));

const { call, notify, kill } = spawnMcpServer({ timeoutMs: 60000, env, cleanupDaemon: true });
const out = (r) => callJson(r);
const consoleOutput = async (args = {}) =>
  out(await call("tools/call", { name: "console_output", arguments: args }));

async function waitFor(fn, timeoutMs, what) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await fn();
    if (last) return last;
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${what}`);
}
/** 发完 N 条后等 MCP 会话缓冲追平：显式 since_seq 读取不推进默认游标 */
async function waitSeq(target, since = 0) {
  return waitFor(async () => {
    const r = await consoleOutput({ since_seq: since });
    return r.ok && r.next_seq >= target ? r : null;
  }, 60000, `next_seq >= ${target}`);
}

try {
  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "cursor", version: "0" } });
  notify("notifications/initialized");

  const consoleTool = (await call("tools/list", {})).result.tools.find((t) => t.name === "console_output");
  assert(consoleTool?.annotations?.readOnlyHint === true && consoleTool.annotations.idempotentHint === true
    && consoleTool.annotations.destructiveHint === false && consoleTool.annotations.openWorldHint === false,
    "console_output advertises all four read-only annotations");
  assert(["Use when", "Returns", "Limits:", "Related tools:"].every((part) => consoleTool.description.includes(part)),
    "console_output description covers use/behavior/returns/limits/related tools in English");

  // GUI 接入才放行 vconsole 门控；console_channels 与游标无关，用作就绪探针
  const gui = net.connect(BASE + 1, "127.0.0.1");
  gui.on("error", () => {});
  gui.on("data", () => {}); // 读掉转发帧，避免回压
  await waitFor(async () => {
    const r = out(await call("tools/call", { name: "console_channels", arguments: {} }));
    return r.ok ? r : null;
  }, 30000, "vconsole gate open");
  await waitFor(() => held !== null, 10000, "relay holds fake engine");
  assert(true, "fake GUI passes the vconsole gate and relay holds the fake engine");

  // ── 1. 首次无游标 = 最近 50 行 ──────────────────────────────
  for (let i = 0; i < 60; i++) held.write(prntFrame(`line-${String(i).padStart(3, "0")}`));
  await waitSeq(60);
  const first = await consoleOutput();
  assert(first.ok === true && first.count === 50 && first.next_seq === 60 && first.dropped === 0,
    "first call without cursor returns the most recent 50 lines: " + JSON.stringify({ count: first.count, next_seq: first.next_seq, dropped: first.dropped }));
  const firstLines = first.lines.split("\n");
  assert(firstLines.length === 50 && firstLines[0].includes("line-010") && firstLines[49].includes("line-059"),
    "tail-50 window starts at the 11th line and ends at the newest");
  assert(firstLines[0] === "[VScript][L0] line-010", "lines keep the '[channel][Llevel] text' human-readable format");

  // ── 2. 默认增量：第二次只含新增行 ───────────────────────────
  for (let i = 60; i < 65; i++) held.write(prntFrame(`line-${String(i).padStart(3, "0")}`));
  await waitSeq(65, 60);
  const second = await consoleOutput();
  assert(second.ok === true && second.count === 5 && second.next_seq === 65 && second.dropped === 0,
    "second default call returns only the 5 new lines");
  assert(second.lines.split("\n").map((l) => l.replace(/^\[[^\]]*\]\[L\d+\] /, "")).join("|")
    === "line-060|line-061|line-062|line-063|line-064",
    "second call contains no duplicate of the first 50 lines");

  // ── 3. since_seq 重放 / tail / lines 别名 / from_start ──────
  const replay = await consoleOutput({ since_seq: 55 });
  assert(replay.ok && replay.count === 10 && replay.next_seq === 65
    && replay.lines.includes("line-055") && replay.lines.includes("line-064"),
    "since_seq is inclusive and replays the requested history");
  const tail3 = await consoleOutput({ tail: 3 });
  assert(tail3.ok && tail3.count === 3 && tail3.next_seq === 65
    && tail3.lines === "[VScript][L0] line-062\n[VScript][L0] line-063\n[VScript][L0] line-064",
    "tail: N always means the last N lines");
  const alias = await consoleOutput({ lines: 2 });
  assert(alias.ok && alias.count === 2 && alias.lines.includes("line-064"), "lines stays an alias for tail for one version");
  // format:'text' 是逃生舱：唯一内容就是按行拼接的正文，没有 JSON 信封
  const textModeRaw = await call("tools/call", { name: "console_output", arguments: { lines: 2, format: "text" } });
  const textModeItems = textModeRaw.result.content.filter((c) => c.type === "text");
  assert(!textModeRaw.result.isError && textModeItems.length === 1 && textModeItems[0].text === alias.lines,
    "format:'text' returns the plain lines as the sole content: " + JSON.stringify(textModeItems).slice(0, 200));
  const all = await consoleOutput({ from_start: true });
  assert(all.ok && all.count === 65 && all.next_seq === 65 && all.dropped === 0
    && all.lines.includes("line-000") && all.lines.includes("line-064"),
    "from_start returns the whole buffered session history");
  const tailAfterPeek = await consoleOutput();
  assert(tailAfterPeek.ok && tailAfterPeek.count === 0,
    "explicit tail/lines/from_start peeks leave the default cursor untouched (no lines lost)");

  // ── 4. 过滤器只影响返回内容，next_seq 仍推进 ─────────────────
  const mixed = ["noise-00", "MATCH-a", "noise-01", "MATCH-b", "noise-02", "MATCH-c", "noise-03", "MATCH-d", "noise-04", "MATCH-e"];
  for (const t of mixed) held.write(prntFrame(t));
  await waitSeq(75, 65);
  const filtered = await consoleOutput({ filter: "MATCH" });
  assert(filtered.ok && filtered.count === 5 && filtered.next_seq === 75 && !filtered.lines.includes("noise"),
    "filter selects within the window and next_seq advances over everything scanned");
  const unmatchedKept = await consoleOutput({ since_seq: 65 });
  assert(unmatchedKept.ok && unmatchedKept.count === 10 && unmatchedKept.lines.includes("noise-00"),
    "unmatched lines are still buffered after a filtered read (filter consumes nothing)");
  const afterFiltered = await consoleOutput();
  assert(afterFiltered.ok && afterFiltered.count === 0 && afterFiltered.next_seq === 75,
    "the filtered default read advanced the cursor (no replay of the same window)");

  // ── 5. 环形缓冲溢出：dropped 如实 > 0 ───────────────────────
  const BULK = 10005;
  for (let i = 0; i < BULK; i++) held.write(prntFrame(`bulk-${String(i).padStart(5, "0")}`));
  await waitSeq(75 + BULK, 0);
  const overflowAll = await consoleOutput({ from_start: true });
  assert(overflowAll.ok && overflowAll.count === 10000 && overflowAll.dropped === 80 && overflowAll.next_seq === 10080,
    "10000-line ring buffer reports exactly the evicted lines as dropped: " + JSON.stringify({ count: overflowAll.count, dropped: overflowAll.dropped }));
  const overflowIncremental = await consoleOutput();
  assert(overflowIncremental.ok && overflowIncremental.count === 10000 && overflowIncremental.dropped === 5
    && overflowIncremental.next_seq === 10080 && overflowIncremental.lines.includes("bulk-00005"),
    "a cursor left behind eviction reports the gap as dropped instead of silently skipping");
  assert(!overflowIncremental.lines.includes("bulk-00000") && !overflowIncremental.lines.includes("bulk-00004"),
    "evicted lines are gone from the window, and dropped counts them");

  // ── 6. 参数错误走统一失败壳 ─────────────────────────────────
  const badSeq = await consoleOutput({ since_seq: -1 });
  assert(badSeq.ok === false && badSeq.code === "invalid_arg", "invalid since_seq returns {ok:false,code:'invalid_arg'}");
  const twoWindows = await consoleOutput({ since_seq: 0, tail: 5 });
  assert(twoWindows.ok === false && twoWindows.code === "invalid_arg", "two window params are rejected instead of silently ignored");
  const badRegex = await consoleOutput({ filter: "(" });
  assert(badRegex.ok === false && badRegex.code === "invalid_arg", "invalid regex returns {ok:false,code:'invalid_arg'}");

  console.log("PASS");
} finally {
  kill();
  await sleep(300);
  rmSync(stateDir, { recursive: true, force: true });
  try { engine.close(); } catch { /* ignore */ }
}
process.exit(0);

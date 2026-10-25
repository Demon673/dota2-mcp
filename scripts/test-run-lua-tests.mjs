// 离线冒烟：dota_test_run 游戏内断言（真实 MCP stdio server + 真实 relay + 假 VCon 引擎 + 假 GUI）：
// 1) 工具带 annotations 与五段式英文描述；
// 2) 成功返回 {ok:true,data:{file,passed,failed,timed_out,results},text}，format:'text' 只回摘要正文；
// 3) 单条失败不中断后续测试；
// 4) 单条挂起按 per_test_timeout_ms 报 timeout，后续测试照常执行；
// 5) 整体 timeout_ms 生效，未跑的测试以 timeout 返回；
// 6) 测试文件加载失败 → test_harness_error；路径/文件错误 → invalid_arg；
// 7) 加载器早退（无 [MCP-TEST] 行）报 settle 窗口，不冒充整体预算耗尽；
// 8) 大测试文件不受 510 字节控制台语句上限约束（引擎内 require，语句只含加载器）；
// 9) 工具是动作而非读取：不移动 console_output 会话游标。
import net from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnMcpServer, callJson, assert, sleep } from "./lib-mcp.mjs";
import { freePortBlock } from "./lib-test-ports.mjs";
import { detectDotaPath } from "../dist/tools/console-bridge.js";

const BASE = await freePortBlock(3);
const stateDir = mkdtempSync(path.join(tmpdir(), "mcp-run-lua-tests-"));
const env = {
  ...process.env,
  DOTA2_VCON_DOTA_PORT: String(BASE),
  DOTA2_VCON_GUI_PORT: String(BASE + 1),
  DOTA2_VCON_CTRL_PORT: String(BASE + 2),
  DOTA2_VCON_STATE_DIR: stateDir,
  DOTA2_VCON_AUTO_OPEN_VCONSOLE: "0",
  DOTA2_CAPTURE_DISABLE_WATCHER: "1",
};

const ADDON = "mcp21fix" + process.pid; // PID 隔离：并行工作树的清理不会互删夹具
const TEST_DIR = "scripts/vscripts/tests";
const LARGE_PAYLOAD = "LARGE_FILE_PAYLOAD_9f3c";
const fakeSteam = mkdtempSync(path.join(tmpdir(), "run-lua-tests-steam-"));
mkdirSync(path.join(fakeSteam, "steamapps", "common", "dota 2 beta", "game", "dota"), { recursive: true });
env.STEAM_PATH = process.env.STEAM_PATH || fakeSteam;
env.DOTA2_TEST_ADDON = ADDON;
process.env.STEAM_PATH = env.STEAM_PATH;
const dotaPath = await detectDotaPath();
if (!dotaPath) throw new Error("cannot detect a Dota 2 path for the test-run fixture");
const addonGame = path.join(dotaPath, "game", "dota_addons", ADDON);
const testsDir = path.join(addonGame, ...TEST_DIR.split("/"));
mkdirSync(testsDir, { recursive: true });
for (const name of ["smoke", "hang", "hangall", "broken", "empty", "silent"]) {
  writeFileSync(path.join(testsDir, `${name}.lua`), `-- fixture ${name}\n`);
}
const largeBody = `-- fixture large\n-- ${LARGE_PAYLOAD.repeat(120)}\n`;
writeFileSync(path.join(testsDir, "large.lua"), largeBody);
const removeFixture = () => {
  try { rmSync(addonGame, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(fakeSteam, { recursive: true, force: true }); } catch { /* ignore */ }
};
process.on("exit", removeFixture);

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

// 假引擎的测试模块清单：模块名 → 逐条结果。hang 的条目只声明不返回结果。
// 约定列到引擎侧，工具只信引擎打印的 [MCP-TEST] 行。
const MODULES = {
  "tests.smoke": {
    names: ["two_plus_two", "always_fails", "runs_after_failure"],
    outcomes: [
      { status: "pass" },
      { status: "fail", detail: "boom: expected 2 got 3" },
      { status: "pass", noise: "[Lua Memory] 12345" },
    ],
  },
  "tests.hang": {
    names: ["hangs_forever", "runs_after_hang"],
    outcomes: [{ hang: true }, { status: "pass" }],
  },
  "tests.hangall": {
    names: ["first_hang", "second_hang"],
    outcomes: [{ hang: true }, { hang: true }],
  },
  "tests.broken": { loadError: "tests/broken.lua:1: attempt to index a nil value (global 'Broken')" },
  "tests.empty": { names: [], outcomes: [] },
  "tests.silent": { names: [], outcomes: [], silent: true },
  "tests.large": { names: ["module_loaded_whole"], outcomes: [{ status: "pass" }] },
};

let held = null;
let cheatsOff = false;
let engineText = "";

/** 从包装语句里取本次调用的结束标记（collectLuaOutput 在 Lua 收尾时打印它）。 */
function endMarkerOf(part) {
  const m = part.match(/print\('(__mcp_[0-9a-f]+_end)'\)/);
  return m ? m[1] : null;
}

function moduleOf(part) {
  const m = part.match(/require\('([^']+)'\)/);
  return m ? m[1] : null;
}

/** 假引擎执行 RunScriptCode：列表语句打印 test|…/end|N，单条语句打印 pass/fail 或保持沉默。 */
function emitLua(sock, part) {
  const endMarker = endMarkerOf(part);
  const mod = moduleOf(part);
  const spec = mod ? MODULES[mod] : null;
  if (part.includes("[MCP-TEST] test|")) {
    if (!spec || spec.loadError) {
      sock.write(prntFrame(spec?.loadError ?? `unknown test module ${String(mod)}`));
    } else if (!spec.silent) {
      spec.names.forEach((name, i) => sock.write(prntFrame(`[MCP-TEST] test|${i + 1}|${name}`)));
      sock.write(prntFrame(`[MCP-TEST] end|${spec.names.length}`));
    }
    if (endMarker) sock.write(prntFrame(endMarker));
    return;
  }
  const idx = part.match(/T\[(\d+)\]/);
  if (idx && spec) {
    const outcome = spec.outcomes[Number(idx[1]) - 1];
    if (!outcome || outcome.hang) return; // 挂起：不打印结果也不打印结束标记
    if (outcome.noise) sock.write(prntFrame(outcome.noise)); // 系统噪音前缀不影响解析
    sock.write(prntFrame(`[MCP-TEST] ${outcome.status}|${idx[1]}|${outcome.detail ?? ""}`));
    if (endMarker) sock.write(prntFrame(endMarker));
    return;
  }
  // 兜底：按 print 字面量回显（覆盖 ai_disabled 等开关行）
  for (const m of part.matchAll(/print\('([^']*)'/g)) sock.write(prntFrame(m[1]));
  if (endMarker) sock.write(prntFrame(endMarker));
}

const engine = net.createServer((sock) => {
  sock.on("error", () => {});
  for (const t of ["AINF", "CHAN", "CVRB", "CFGV", "ADON"]) {
    sock.write(frame(t, t === "CHAN" ? chanPayload : t === "AINF" ? 128 : 44));
  }
  const heldTimer = setTimeout(() => { held = sock; }, 400);
  sock.on("close", () => clearTimeout(heldTimer));
  let buf = Buffer.alloc(0);
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 12 && buf.length >= buf.readUInt32BE(6)) {
      const len = buf.readUInt32BE(6);
      const cmd = buf.subarray(12, len).toString("utf-8").replace(/\0/g, "");
      buf = buf.subarray(len);
      engineText += cmd + "\n";
      for (const part of cmd.split(";").map((s) => s.trim()).filter(Boolean)) {
        if (part.includes("__mcp_ping__")) {
          sock.write(prntFrame("__mcp_ping__")); // 活性探针回声
        } else if (part === "ai_disabled") {
          sock.write(prntFrame("ai_disabled = true")); // 引擎回显 cvar；relay 按标记行吞掉
        } else if (part.startsWith("echo ")) {
          sock.write(prntFrame(part.slice(5))); // echo 立即执行（begin/end 标记）
        } else if (part.startsWith("ent_fire 0 RunScriptCode")) {
          setTimeout(() => {
            if (cheatsOff) { sock.write(prntFrame("Cheat command 'ent_fire' ignored")); return; }
            emitLua(sock, part);
          }, 50);
        }
      }
    }
  });
});
await new Promise((r) => engine.listen(BASE, "127.0.0.1", r));

const { call, notify, kill } = spawnMcpServer({ timeoutMs: 60000, env, cleanupDaemon: true });
const out = (r) => callJson(r);
const tool = (name, args) => call("tools/call", { name, arguments: args });
const runTests = async (args) => out(await tool("dota_test_run", args));

async function waitFor(fn, timeoutMs, what) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await fn();
    if (last) return last;
    await sleep(150);
  }
  throw new Error("timeout waiting for " + what);
}

const SMOKE = `${TEST_DIR}/smoke.lua`;

try {
  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "run-lua-tests", version: "0" } });
  notify("notifications/initialized");

  // ── 1. annotations 与五段式描述 ──────────────────────────────
  const tools = (await call("tools/list", {})).result.tools;
  const testTool = tools.find((t) => t.name === "dota_test_run");
  assert(testTool, "dota_test_run is registered");
  assert(testTool.annotations?.readOnlyHint === false && testTool.annotations?.destructiveHint === false
    && testTool.annotations?.idempotentHint === false && testTool.annotations?.openWorldHint === false,
    "dota_test_run is an action: not read-only, not destructive, not idempotent: " + JSON.stringify(testTool.annotations));
  assert(["Use when", "Returns", "Limits:", "Related tools:"].every((part) => testTool.description.includes(part)),
    "dota_test_run description covers use/behavior/returns/limits/related tools in English");

  // ── 2. 门控失败走统一壳（vconsole 未接入但 Dota 就绪）────────
  await waitFor(async () => {
    const s = out(await tool("dota_status", {}));
    return s.ok && s.data?.dota === false && s.text.includes("vconsole is not open") ? s : null;
  }, 20000, "relay ready probe to see the fake engine");
  const gated = await runTests({ file: SMOKE });
  assert(gated.ok === false && gated.code === "vconsole_closed" && typeof gated.message === "string",
    "dota_test_run is gated by consoleGate() with code vconsole_closed: " + JSON.stringify(gated).slice(0, 200));

  // 假 GUI 接入 → relay 才连假引擎；console_channels 作为门控打开探针
  const gui = net.connect(BASE + 1, "127.0.0.1");
  gui.on("error", () => {});
  gui.on("data", () => {});
  await waitFor(async () => {
    const r = await call("tools/call", { name: "console_channels", arguments: {} });
    return r.result && !r.result.isError ? r : null;
  }, 30000, "vconsole gate open");
  await waitFor(() => held !== null, 10000, "relay holds fake engine");
  assert(true, "fake GUI passes the vconsole gate and relay holds the fake engine");

  // ── 3. 成功壳 + 逐条结果 + 单条失败不中断后续 ────────────────
  const before = out(await tool("console_output", {}));
  assert(before.ok === true && before.count === 0, "session cursor starts empty before any test output");
  const smoke = await runTests({ file: SMOKE });
  assert(smoke.ok === true && smoke.data && Array.isArray(smoke.data.results),
    "dota_test_run returns the {ok:true,data} envelope: " + JSON.stringify(smoke).slice(0, 300));
  assert(smoke.data.file === SMOKE && smoke.data.passed === 2 && smoke.data.failed === 1 && smoke.data.timed_out === 0,
    "summary counts match the three tests (2 pass, 1 fail, 0 timeout): " + JSON.stringify({ passed: smoke.data.passed, failed: smoke.data.failed, timed_out: smoke.data.timed_out }));
  assert(smoke.data.results.map((r) => `${r.name}:${r.status}`).join("|")
    === "two_plus_two:pass|always_fails:fail|runs_after_failure:pass",
    "results keep declaration order and a failing test does not stop later tests: " + JSON.stringify(smoke.data.results));
  assert(smoke.data.results[1].detail.includes("boom"), "a failed test carries its error detail: " + JSON.stringify(smoke.data.results[1]));
  assert(typeof smoke.text === "string" && smoke.text.includes(SMOKE) && smoke.text.includes("failed"),
    "text is a human-readable summary naming the file and failure count: " + JSON.stringify(smoke.text));
  assert(Number.isInteger(smoke.data.next_seq) && smoke.data.next_seq > 0 && Number.isInteger(smoke.data.dropped),
    "the run reports the shared console window as next_seq/dropped: " + JSON.stringify({ next_seq: smoke.data.next_seq, dropped: smoke.data.dropped }));

  // ── 3b. format:'text'：只回摘要正文，不套信封 ───────────────
  const smokeTextRaw = await tool("dota_test_run", { file: SMOKE, format: "text" });
  const smokeTextItems = smokeTextRaw.result.content.filter((c) => c.type === "text");
  assert(!smokeTextRaw.result.isError && smokeTextItems.length === 1
    && smokeTextItems[0].text === smoke.text && !smokeTextItems[0].text.trim().startsWith("{"),
    "format:'text' returns the plain summary as the sole content (no envelope): " + JSON.stringify(smokeTextItems).slice(0, 200));

  // ── 4. 工具不移动 console_output 会话游标 ────────────────────
  const after = out(await tool("console_output", {}));
  assert(after.ok === true && after.count > 0 && after.next_seq >= smoke.data.next_seq
    && after.lines.includes("[MCP-TEST]"),
    "test output stays readable incrementally (the action consumed no cursor): " + JSON.stringify({ count: after.count, next_seq: after.next_seq }));

  // ── 5. 单条挂起：按 per_test_timeout_ms 报 timeout，后续测试仍执行 ──
  const t0 = Date.now();
  const hang = await runTests({ file: `${TEST_DIR}/hang.lua`, per_test_timeout_ms: 400, timeout_ms: 15000 });
  const hangMs = Date.now() - t0;
  assert(hang.ok === true && hang.data.results.map((r) => r.status).join("|") === "timeout|pass"
    && hang.data.timed_out === 1 && hang.data.passed === 1,
    "a hanging test is reported as timeout and the next test still runs: " + JSON.stringify(hang.data?.results));
  assert(hangMs < 5000, "a hanging test does not hang the MCP call (returned in " + hangMs + " ms)");

  // ── 6. 整体超时：未跑的测试以 timeout 返回，调用被整体预算限制 ──
  const t1 = Date.now();
  const overall = await runTests({ file: `${TEST_DIR}/hangall.lua`, per_test_timeout_ms: 5000, timeout_ms: 300 });
  const overallMs = Date.now() - t1;
  assert(overall.ok === true && overall.data.timed_out === overall.data.results.length
    && overall.data.results.every((r) => r.status === "timeout"),
    "overall timeout marks the whole unfinished run as timeout: " + JSON.stringify(overall.data?.results));
  assert(overallMs < 3000, "the overall budget bounds the MCP call (returned in " + overallMs + " ms)");
  assert(overall.data.results.some((r) => r.detail.includes("overall")),
    "a test skipped by the overall budget says so in its detail: " + JSON.stringify(overall.data.results));

  // ── 7. 测试文件加载失败 → test_harness_error ────────────────
  const brokenRaw = await tool("dota_test_run", { file: `${TEST_DIR}/broken.lua` });
  const broken = out(brokenRaw);
  assert(broken.ok === false && broken.code === "test_harness_error" && brokenRaw.result.isError === true,
    "a test file that fails to load returns {ok:false,code:'test_harness_error'}: " + JSON.stringify(broken).slice(0, 300));
  assert(broken.message.includes("attempt to index"), "test_harness_error carries the engine's load error");

  // ── 8. 空测试模块是成功，不是错误 ───────────────────────────
  const empty = await runTests({ file: `${TEST_DIR}/empty.lua` });
  assert(empty.ok === true && empty.data.results.length === 0 && empty.data.passed === 0
    && empty.data.failed === 0 && empty.data.timed_out === 0,
    "an empty test module succeeds with zero counts: " + JSON.stringify(empty).slice(0, 200));

  // ── 8b. 加载器早退：报 settle 窗口，不冒充整体预算耗尽 ───────
  const silent = await runTests({ file: `${TEST_DIR}/silent.lua`, timeout_ms: 60000 });
  assert(silent.ok === false && silent.code === "timeout" && /settle window/.test(silent.message)
    && !/overall budget/.test(silent.message),
    "a loader that never lists reports the settle window, not an exhausted overall budget: " + JSON.stringify(silent).slice(0, 300));

  // ── 9. 大测试文件不受 510 字节语句上限约束 ──────────────────
  assert(Buffer.byteLength(largeBody, "utf8") > 2000, "fixture test file is larger than the 510-byte console cap");
  const large = await runTests({ file: `${TEST_DIR}/large.lua` });
  assert(large.ok === true && large.data.passed === 1 && large.data.results[0].name === "module_loaded_whole",
    "a >2 KB test file runs because the engine loads it with require: " + JSON.stringify(large).slice(0, 300));
  assert(!engineText.includes(LARGE_PAYLOAD), "the file content is never inlined into a console statement");
  const luaStatements = engineText.split(";").map((s) => s.trim()).filter((s) => s.includes("RunScriptCode"));
  assert(luaStatements.length > 0 && luaStatements.every((s) => Buffer.byteLength(s, "utf8") <= 510),
    "every wrapped console statement stays within the 510-byte cap (max "
    + Math.max(...luaStatements.map((s) => Buffer.byteLength(s, "utf8"))) + " bytes)");

  // ── 10. 路径与文件错误 → invalid_arg ────────────────────────
  const outside = await runTests({ file: "scripts/vscripts/addon_game_mode.lua" });
  assert(outside.ok === false && outside.code === "invalid_arg" && outside.message.includes(TEST_DIR),
    "a path outside the tests convention returns invalid_arg with the convention: " + JSON.stringify(outside).slice(0, 200));
  const missing = await runTests({ file: `${TEST_DIR}/missing.lua` });
  assert(missing.ok === false && missing.code === "invalid_arg" && missing.message.includes("not found"),
    "a missing test file returns invalid_arg: " + JSON.stringify(missing).slice(0, 200));
  const quoted = await runTests({ file: `${TEST_DIR}/bad'name.lua` });
  assert(quoted.ok === false && quoted.code === "invalid_arg",
    "a file name that could escape the generated Lua string is rejected: " + JSON.stringify(quoted).slice(0, 200));

  // ── 11. sv_cheats 关闭 → cheats_off（与 dota_run_lua 同一通道）──
  cheatsOff = true;
  const cheats = await runTests({ file: SMOKE, per_test_timeout_ms: 500, timeout_ms: 2000 });
  cheatsOff = false;
  assert(cheats.ok === false && cheats.code === "cheats_off",
    "sv_cheats off returns {ok:false,code:'cheats_off'}: " + JSON.stringify(cheats).slice(0, 200));

  console.log("PASS");
} finally {
  kill();
  await sleep(300);
  rmSync(stateDir, { recursive: true, force: true });
  removeFixture();
  try { engine.close(); } catch { /* ignore */ }
}
process.exit(0);

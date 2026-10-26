// Offline contract for the daemon-owned Panorama bridge manager.
// A fake deps object owns the console: DynamicHud_Create only succeeds when the
// transient source exists, the bridge answers ping/pong, and exec acks are
// printed exactly like the installed Lua listener. No Dota/vconsole required.
import { mkdtempSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const work = mkdtempSync(path.join(os.tmpdir(), "d2mcp-bridge-test-"));
const stateDir = path.join(work, "state");
const dotaPath = path.join(work, "dota");
const addon = "test_addon";
process.env.DOTA2_VCON_STATE_DIR = stateDir;
mkdirSync(stateDir, { recursive: true });
mkdirSync(path.join(dotaPath, "content", "dota_addons", addon), { recursive: true });
mkdirSync(path.join(dotaPath, "game", "dota_addons", addon), { recursive: true });

const { PanoramaBridge } = await import("../dist/tools/panorama-bridge.js");

let passed = 0;
function assert(cond, message) {
  if (!cond) {
    console.error(`[test] FAIL ${message}`);
    process.exit(1);
  }
  passed++;
  console.log(`[test] PASS ${message}`);
}

const listeners = new Set();
let hudAlive = false;
let listenerInstalled = false;
let ackPrefix = "";
let execMode = "ok";
let failCompile = false;

function emit(text) {
  for (const fn of [...listeners]) fn({ text, verbosity: 0, channel: "test" });
}

function hasSource() {
  const dir = path.join(dotaPath, "content", "dota_addons", addon, "panorama", "layout", "custom_game");
  try {
    return readdirSync(dir).some((name) => name.startsWith("d2mcp_"));
  } catch { return false; }
}
function noBridgeFiles() {
  for (const root of [path.join(dotaPath, "content"), path.join(dotaPath, "game")]) {
    const dir = path.join(root, "dota_addons", addon, "panorama", "layout", "custom_game");
    if (!existsSync(dir)) continue;
    if (readdirSync(dir).some((name) => name.startsWith("d2mcp_"))) return false;
  }
  return true;
}
function ack(id, phase, ok, payload = "") {
  emit(`${ackPrefix}${id} ${phase} ${ok ? 1 : 0} ${payload}`);
}

function processCommand(middle) {
  const prefix = middle.match(/print\('(\[D2MCP-[^']*\] )'/);
  if (prefix) ackPrefix = prefix[1];
  if (middle.includes("DynamicHud_Destroy")) {
    hudAlive = false;
    return;
  }
  if (middle.includes("DynamicHud_Create")) {
    if (failCompile || !hasSource()) {
      emit("[ResourceCompilerSystem][L3] RESOURCE COMPILE ERROR: simulated compile failure");
      hudAlive = false;
      return;
    }
    hudAlive = true;
    return;
  }
  const reg = middle.match(/RegisterListener\('([^']+)'/);
  if (reg) {
    listenerInstalled = true;
    emit(`CCustomGameEventManager::Script_RegisterListener - Registered ${reg[1]}`);
    return;
  }
  const event = middle.match(/Send_ServerToAllClients\('([^']+)'/);
  const id = middle.match(/id='([^']+)'/);
  if (!event || !id) return;
  if (event[1].endsWith("_ping")) {
    if (hudAlive && listenerInstalled) ack(id[1], "pong", true, "gen");
    return;
  }
  if (!event[1].endsWith("_exec")) return;
  if (!hudAlive || !listenerInstalled) return;
  ack(id[1], "started", true);
  if (execMode === "incomplete") return;
  if (execMode === "js_error") {
    ack(id[1], "done", false, JSON.stringify({ value: { message: "boom" }, logs: ["bad"] }));
    return;
  }
  ack(id[1], "done", true, JSON.stringify({ value: { echo: "ok" }, logs: ["log1"] }));
}

function handleCommand(cmd) {
  const m = cmd.match(/^echo (\S+); ([\s\S]*); echo (\S+)$/);
  if (!m) return;
  setImmediate(() => {
    emit(m[1]);
    processCommand(m[2]);
    emit(m[3]);
  });
}

const bridge = new PanoramaBridge({
  addonName: () => addon,
  dotaPath: () => dotaPath,
  consoleReady: () => true,
  sendCommand: handleCommand,
  onPrnt: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
});

try {
  // 1. First exec: cache miss, write source, engine "compiles", ping, exec, cleanup.
  const first = await bridge.handle({ id: "r1", op: "exec", code: "return 1", timeoutMs: 1000 });
  assert(first.ok && first.rebuilt === true, "first exec provisions and reports rebuilt: " + JSON.stringify(first));
  assert(first.result && first.result.echo === "ok" && first.logs.includes("log1"), "first exec carries the structured result and logs");
  assert(noBridgeFiles(), "successful exec leaves no bridge files");

  // 2. Second exec: ping reuse, no source copy.
  const second = await bridge.handle({ id: "r2", op: "exec", code: "return 2", timeoutMs: 1000 });
  assert(second.ok && second.rebuilt === false, "second exec reuses the live bridge");
  assert(second.result && second.result.echo === "ok", "second exec returns the result");
  assert(noBridgeFiles(), "second exec leaves no bridge files");

  // 3. HUD destroyed: cache create fails without source, so the manager reprovisions.
  hudAlive = false;
  const rebuilt = await bridge.handle({ id: "r3", op: "exec", code: "return 3", timeoutMs: 1000 });
  assert(rebuilt.ok && rebuilt.rebuilt === true, "lost HUD is rebuilt from a transient source copy");
  assert(noBridgeFiles(), "rebuild deletes its files");

  // 4. Compile failure: returns bridge_compile_failed and cleans up.
  hudAlive = false;
  failCompile = true;
  const broken = await bridge.handle({ id: "r4", op: "exec", code: "return 4", timeoutMs: 1000 });
  assert(broken.ok === false && broken.code === "bridge_compile_failed", "compile failure is reported: " + JSON.stringify(broken));
  assert(noBridgeFiles(), "compile failure leaves no bridge files");
  failCompile = false;

  // 5. JS error: done(ok=0) becomes js_error; the bridge stays alive and is not rebuilt.
  hudAlive = true;
  execMode = "js_error";
  const jsErr = await bridge.handle({ id: "r5", op: "exec", code: "throw 1", timeoutMs: 1000 });
  assert(jsErr.ok === false && jsErr.code === "js_error" && /boom/.test(jsErr.message), "JS errors surface as js_error: " + JSON.stringify(jsErr));
  assert(jsErr.rebuilt === false, "a JS error does not rebuild the bridge");
  execMode = "ok";

  // 6. started without done: exec_incomplete, no blind retry.
  execMode = "incomplete";
  const incomplete = await bridge.handle({ id: "r6", op: "exec", code: "return 6", timeoutMs: 200 });
  assert(incomplete.ok === false && incomplete.code === "exec_incomplete", "missing done becomes exec_incomplete");
  assert(incomplete.rebuilt === false, "exec_incomplete does not rebuild");
  execMode = "ok";

  // 7. The token is stable across manager instances (daemon restart).
  const tokenPath = path.join(stateDir, "bridge.token");
  assert(existsSync(tokenPath) && readdirSync(stateDir).includes("bridge.token"), "bridge token is persisted in the daemon state dir");
  const bridge2 = new PanoramaBridge({
    addonName: () => addon,
    dotaPath: () => dotaPath,
    consoleReady: () => true,
    sendCommand: handleCommand,
    onPrnt: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  });
  const reused = await bridge2.handle({ id: "r7", op: "exec", code: "return 7", timeoutMs: 1000 });
  assert(reused.ok && reused.rebuilt === false, "a new manager instance reuses the same token and bridge");
  assert(noBridgeFiles(), "manager reuse leaves no bridge files");
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`[test] all ${passed} checks passed`);

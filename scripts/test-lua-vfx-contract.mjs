// scripts/test-lua-vfx-contract.mjs — #17：dota_run_lua / vfx_preview / vfx_preview_stop 的统一契约
// 真实 MCP stdio server + 真实 relay（daemon 或本地退化）+ 假 VCon 引擎 + 假 GUI：
// 1) 三个工具带 annotations 与五段式英文描述；2) 输出走 {ok:true,lines,count,next_seq,dropped}，
//    且不移动 console_output 的会话游标；3) 失败用稳定错误码：
//    lua_too_long / cheats_off / precache_missing / vconsole_closed。
import net from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnMcpServer, callJson, assert, sleep } from "./lib-mcp.mjs";
import { freePortBlock } from "./lib-test-ports.mjs";
import { detectDotaPath } from "../dist/tools/console-bridge.js";

const BASE = await freePortBlock(3);
const stateDir = mkdtempSync(path.join(tmpdir(), "mcp-lua-vfx-"));
const env = {
  ...process.env,
  DOTA2_VCON_DOTA_PORT: String(BASE),
  DOTA2_VCON_GUI_PORT: String(BASE + 1),
  DOTA2_VCON_CTRL_PORT: String(BASE + 2),
  DOTA2_VCON_STATE_DIR: stateDir,
  DOTA2_VCON_AUTO_OPEN_VCONSOLE: "0",
  DOTA2_CAPTURE_DISABLE_WATCHER: "1",
};

// precache_missing 需要一个真实 addon 目录：沿用 test-fileops 的做法——本机有 Steam 时用注册表
// 找到的真实 Dota 目录，没有 Steam 的 CI 经 STEAM_PATH 落到临时搭的最小 Steam 库。
const ADDON = "mcp17fixture";
const fakeSteam = mkdtempSync(path.join(tmpdir(), "lua-vfx-steam-"));
mkdirSync(path.join(fakeSteam, "steamapps", "common", "dota 2 beta", "game", "dota"), { recursive: true });
env.STEAM_PATH = process.env.STEAM_PATH || fakeSteam;
env.DOTA2_TEST_ADDON = ADDON;
process.env.STEAM_PATH = env.STEAM_PATH;
const dotaPath = await detectDotaPath();
if (!dotaPath) throw new Error("cannot detect a Dota 2 path for the precache fixture");
const addonContent = path.join(dotaPath, "content", "dota_addons", ADDON);
const addonGame = path.join(dotaPath, "game", "dota_addons", ADDON);
mkdirSync(path.join(addonContent, "particles", "fixture"), { recursive: true });
writeFileSync(path.join(addonContent, "particles", "fixture", "declared.vpcf"), "");
writeFileSync(path.join(addonContent, "particles", "fixture", "silent.vpcf"), "");
mkdirSync(path.join(addonGame, "scripts", "vscripts"), { recursive: true });
writeFileSync(path.join(addonGame, "scripts", "vscripts", "addon_game_mode.lua"),
  'function Precache(context)\n  PrecacheResource("particle", "particles/fixture/declared.vpcf", context)\nend\n');
const removeFixture = () => {
  try { rmSync(addonContent, { recursive: true, force: true }); } catch { /* ignore */ }
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

let held = null;
let cheatsOff = false;
let engineText = "";

/** 假引擎的执行结果：next-frame 才跑 RunScriptCode，这里按命令内容模拟真实输出。 */
function luaBody(part) {
  if (cheatsOff) return null; // sv_cheats 关闭：ent_fire 被忽略，连结束标记都不会打印
  if (part.includes("ParticleManager:CreateParticle")) {
    return ["[MCP-VFX] IsServer: true", "[MCP-VFX] pid=7 attach=PATTACH_WORLDORIGIN"];
  }
  if (part.includes("ParticleManager:DestroyParticle")) {
    return ["[MCP-VFX] destroy pid=7", "[MCP-VFX] destroyed pid=7"];
  }
  // 通用 Lua：按顺序执行 print 字面量（足够覆盖 [MCP-LUA] 输出与结束标记）
  return [...part.matchAll(/print\('([^']*)'/g)].map((m) => m[1]);
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
          const body = luaBody(part);
          setTimeout(() => {
            if (body === null) { sock.write(prntFrame("Cheat command 'ent_fire' ignored")); return; }
            for (const line of body) sock.write(prntFrame(line));
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

try {
  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "lua-vfx", version: "0" } });
  notify("notifications/initialized");

  // ── 1. annotations 与五段式描述 ──────────────────────────────
  const tools = (await call("tools/list", {})).result.tools;
  const byName = (n) => tools.find((t) => t.name === n);
  const luaTool = byName("dota_run_lua");
  const vfxTool = byName("vfx_preview");
  const stopTool = byName("vfx_preview_stop");
  assert(luaTool && vfxTool && stopTool, "the three Lua/VFX tools are registered");
  assert(luaTool.annotations?.readOnlyHint === false && luaTool.annotations?.destructiveHint === true
    && luaTool.annotations?.idempotentHint === false && luaTool.annotations?.openWorldHint === false,
    "dota_run_lua is destructive and non-idempotent (arbitrary code): " + JSON.stringify(luaTool.annotations));
  for (const t of [vfxTool, stopTool]) {
    assert(t.annotations?.readOnlyHint === false && t.annotations?.destructiveHint === false
      && t.annotations?.openWorldHint === false, `${t.name} is neither read-only nor destructive: ` + JSON.stringify(t.annotations));
  }
  for (const t of [luaTool, vfxTool, stopTool]) {
    assert(["Use when", "Returns", "Limits:", "Related tools:"].every((part) => t.description.includes(part)),
      `${t.name} description covers use/behavior/returns/limits/related tools`);
  }

  // ── 2. 门控失败走统一壳（vconsole 未接入但 Dota 就绪）────────
  await waitFor(async () => {
    const s = out(await tool("dota_status", {}));
    return s.ok && s.data?.dota === false && s.text.includes("vconsole is not open") ? s : null;
  }, 20000, "relay ready probe to see the fake engine");
  const gated = out(await tool("dota_run_lua", { code: "print('never')" }));
  assert(gated.ok === false && gated.code === "vconsole_closed" && typeof gated.message === "string",
    "dota_run_lua is gated by consoleGate() with code vconsole_closed: " + JSON.stringify(gated).slice(0, 200));
  assert((await tool("dota_run_lua", { code: "print('never')" })).result.isError === true,
    "contract failure sets isError on the MCP result");

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

  // ── 3. dota_run_lua 成功：lines 载荷与游标字段 ─────────────────
  const before = out(await tool("console_output", {}));
  assert(before.ok === true && before.count === 0 && before.next_seq === 0,
    "session cursor starts empty before any Lua output");
  const lua = out(await tool("dota_run_lua", { code: "print('lua_envelope_line')" }));
  assert(lua.ok === true && typeof lua.lines === "string" && lua.lines.includes("lua_envelope_line"),
    "dota_run_lua returns {ok:true,lines} carrying the Lua output: " + JSON.stringify(lua).slice(0, 200));
  assert(lua.count === lua.lines.split("\n").length, "count equals the number of returned lines");
  assert(Number.isInteger(lua.next_seq) && lua.next_seq > 0 && lua.dropped === 0,
    "next_seq/dropped are honest console-window fields: " + JSON.stringify({ next_seq: lua.next_seq, dropped: lua.dropped }));
  const after = out(await tool("console_output", {}));
  assert(after.ok === true && after.count === 2 && after.lines.includes("lua_envelope_line")
    && after.next_seq === lua.next_seq,
    "the Lua tool does not move the session cursor: its output is still readable incrementally");

  // ── 4. vfx_preview / vfx_preview_stop 成功：同样的 lines 载荷 ──
  const vfx = out(await tool("vfx_preview", { particle_path: "particles/basic_explosion/basic_explosion.vpcf", attach: 8 }));
  assert(vfx.ok === true && vfx.lines.includes("[MCP-VFX]") && vfx.count === vfx.lines.split("\n").length
    && Number.isInteger(vfx.next_seq) && vfx.dropped === 0,
    "vfx_preview returns {ok:true,lines,count,next_seq,dropped}: " + JSON.stringify(vfx).slice(0, 200));
  const stop = out(await tool("vfx_preview_stop", { particle_id: 7 }));
  assert(stop.ok === true && stop.lines.includes("destroyed pid=7") && stop.count === stop.lines.split("\n").length,
    "vfx_preview_stop returns the same lines envelope: " + JSON.stringify(stop).slice(0, 200));
  assert(!JSON.stringify(stop).includes("ok=nil"),
    "DestroyParticle's void return is never reported as ok=nil");

  // ── 5. 超长 Lua → lua_too_long，且消息保留可用字节提示 ────────
  const longCode = "print('" + "x".repeat(600) + "')";
  const tooLongRaw = await tool("dota_run_lua", { code: longCode });
  const tooLong = out(tooLongRaw);
  assert(tooLong.ok === false && tooLong.code === "lua_too_long" && tooLongRaw.result.isError === true,
    "over-long Lua returns {ok:false,code:'lua_too_long'} with isError: " + JSON.stringify(tooLong).slice(0, 200));
  assert(/bytes are available/.test(tooLong.message), "lua_too_long keeps the available-bytes hint");
  assert(!engineText.includes("x".repeat(600)), "over-long Lua is rejected before it reaches the engine");

  // ── 6. sv_cheats 关闭 → cheats_off（引擎只打印 ignored 行）────
  cheatsOff = true;
  const cheatsRaw = await tool("dota_run_lua", { code: "print('never_runs')" });
  cheatsOff = false;
  const cheats = out(cheatsRaw);
  assert(cheats.ok === false && cheats.code === "cheats_off" && cheatsRaw.result.isError === true,
    "sv_cheats off returns {ok:false,code:'cheats_off'}: " + JSON.stringify(cheats).slice(0, 200));
  assert(cheats.message.includes("sv_cheats"), "cheats_off explains how to turn sv_cheats on");

  // ── 7. addon 粒子未 precache → precache_missing（同一 addon 里已声明者成功）──
  const declared = out(await tool("vfx_preview", { particle_path: "particles/fixture/declared.vpcf", attach: 8 }));
  assert(declared.ok === true && declared.lines.includes("precache: declared in"),
    "a declared addon particle succeeds and reports its Precache site: " + JSON.stringify(declared).slice(0, 300));
  const missingRaw = await tool("vfx_preview", { particle_path: "particles/fixture/silent.vpcf", attach: 8 });
  const missing = out(missingRaw);
  assert(missing.ok === false && missing.code === "precache_missing" && missingRaw.result.isError === true,
    "an undeclared addon particle returns {ok:false,code:'precache_missing'}: " + JSON.stringify(missing).slice(0, 300));
  assert(missing.message.includes("PrecacheResource"), "precache_missing carries the exact PrecacheResource remedy");

  console.log("PASS");
} finally {
  kill();
  await sleep(300);
  rmSync(stateDir, { recursive: true, force: true });
  removeFixture();
  try { engine.close(); } catch { /* ignore */ }
}
process.exit(0);

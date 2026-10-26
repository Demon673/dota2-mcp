// 一次性离线 MCP 冒烟：服务器启动 + dota_status 不抛异常 + 契约报错 + 新 skill 可加载
// 端口与 daemon 状态目录隔离：不受本机正在运行的 daemon/Dota 影响（env 直达 spawned daemon）
import { spawnMcpServer, assert, sleep, callJson } from "./lib-mcp.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { scrubbedEnv } from "../dist/tools/process-env.js";
import { particlePrecacheNote } from "../dist/tools/particle-precache.js";
import { ok, fail, ERROR_CODES, READ_ONLY_ANNOTATIONS } from "../dist/tools/tool-result.js";
import { freePortBlock } from "./lib-test-ports.mjs";

const stateDir = mkdtempSync(path.join(tmpdir(), "mcp-offline-state-"));
const BASE = await freePortBlock(3);
const env = {
  ...process.env,
  DOTA2_VCON_DOTA_PORT: String(BASE),
  DOTA2_VCON_GUI_PORT: String(BASE + 1),
  DOTA2_VCON_CTRL_PORT: String(BASE + 2),
  DOTA2_VCON_STATE_DIR: stateDir,
};
process.env.TEST_MCP_SCRUB_TOKEN = "must-not-pass";
const cleanEnv = scrubbedEnv({ EXTRA_CHECK: "kept" });
delete process.env.TEST_MCP_SCRUB_TOKEN;
assert(cleanEnv.TEST_MCP_SCRUB_TOKEN === undefined && cleanEnv.EXTRA_CHECK === "kept", "subprocess env drops credentials but keeps explicit config");

// 返回契约助手：三种成功载荷、失败壳与错误码表（MCP 层断言在下方 console_channels）
const okText = JSON.parse(ok({ text: "hello" }).content[0].text);
assert(okText.ok === true && okText.text === "hello", "ok() wraps a text payload as {ok:true,text}");
const okLines = JSON.parse(ok({ lines: "a\nb", count: 2, next_seq: 7, dropped: 1 }).content[0].text);
assert(okLines.ok && okLines.lines === "a\nb" && okLines.count === 2 && okLines.next_seq === 7 && okLines.dropped === 1, "ok() keeps console-window cursor fields");
const okData = JSON.parse(ok({ data: { a: 1 }, text: "summary" }).content[0].text);
assert(okData.ok && okData.data.a === 1 && okData.text === "summary", "ok() accepts a data payload with optional summary");
const failed = fail("invalid_arg", "bad input");
assert(failed.isError === true && JSON.parse(failed.content[0].text).code === "invalid_arg", "fail() sets isError and carries the code");
const specCodes = ["dota_down", "vconsole_closed", "cheats_off", "phase_wrong", "lua_too_long", "timeout", "precache_missing", "invalid_arg", "internal"];
assert(specCodes.every((c) => ERROR_CODES.includes(c)), "error-code vocabulary from the spec is exported");
assert(READ_ONLY_ANNOTATIONS.readOnlyHint === true && READ_ONLY_ANNOTATIONS.destructiveHint === false
  && READ_ONLY_ANNOTATIONS.idempotentHint === true && READ_ONLY_ANNOTATIONS.openWorldHint === false,
  "read-only annotations table covers all four hints");

// vfx_preview 的 precache 判定：客户端只绘制加载期声明过的粒子，三种结论都要可区分
const fakeDota = mkdtempSync(path.join(tmpdir(), "precache-fixture-"));
const fx = path.join(fakeDota, "content", "dota_addons", "fake", "particles", "fx");
mkdirSync(fx, { recursive: true });
writeFileSync(path.join(fx, "declared.vpcf"), "");
writeFileSync(path.join(fx, "silent.vpcf"), "");
const vscripts = path.join(fakeDota, "game", "dota_addons", "fake", "scripts", "vscripts");
mkdirSync(vscripts, { recursive: true });
writeFileSync(path.join(vscripts, "addon_game_mode.lua"),
  'function Precache(context)\n  PrecacheResource("particle", "particles/fx/declared.vpcf", context)\nend\n');
const declared = particlePrecacheNote(fakeDota, "fake", "particles/fx/declared.vpcf");
assert(declared.includes("declared in") && declared.includes("addon_game_mode.lua"), "declared particle names its Precache site: " + declared);
const missing = particlePrecacheNote(fakeDota, "fake", "particles/fx/silent.vpcf");
assert(missing.includes("MISSING") && missing.includes('PrecacheResource("particle", "particles/fx/silent.vpcf", context)'), "undeclared addon particle reports the exact remedy: " + missing);
assert(particlePrecacheNote(fakeDota, "fake", "particles/items_fx/black_king_bar_avatar.vpcf").includes("not an addon asset"), "engine asset is not reported as an addon precache miss");
assert(particlePrecacheNote(fakeDota, null, "particles/fx/silent.vpcf") === "", "unknown addon yields no verdict");
rmSync(fakeDota, { recursive: true, force: true });
const { call, notify, kill } = spawnMcpServer({ timeoutMs: 45000, env, cleanupDaemon: true });
await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
notify("notifications/initialized");
// createRelay 会探测/拉起 daemon，给它点时间
await sleep(12000);

const tools = await call("tools/list", {});
const names = tools.result.tools.map(t => t.name);
assert(!names.includes("project_info"), "project_info removed");
assert(names.includes("dota_open_vconsole"), "dota_open_vconsole registered");
assert(names.includes("panorama_exec_js"), "panorama_exec_js registered");
assert(names.includes("dota_input"), "dota_input registered");
assert(names.length === 38, `38 tools total (got ${names.length})`);
const panoramaTool = tools.result.tools.find(t => t.name === "panorama_exec_js");
assert(panoramaTool?.annotations?.readOnlyHint === false && panoramaTool.annotations.destructiveHint === true
  && panoramaTool.annotations.idempotentHint === false && panoramaTool.annotations.openWorldHint === false,
  "panorama_exec_js is destructive and non-idempotent");

// 工具 2.0 全局契约：每个工具都要带四类 annotations，描述遵循五段式
const HINTS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];
const missingHints = tools.result.tools
  .filter(t => !t.annotations || HINTS.some(k => typeof t.annotations[k] !== "boolean"))
  .map(t => t.name);
assert(missingHints.length === 0, "all tools carry four annotation hints (missing: " + missingHints.join(", ") + ")");
const DESCRIPTION_PARTS = ["Use when", "Returns", "Limits:", "Related tools:"];
const badDescriptions = tools.result.tools
  .filter(t => DESCRIPTION_PARTS.some(p => !(t.description || "").includes(p)))
  .map(t => t.name);
assert(badDescriptions.length === 0, "all tool descriptions carry Use when/Returns/Limits:/Related tools: (missing: " + badDescriptions.join(", ") + ")");

// 工具 2.0：首个迁移工具 console_channels 的五段式描述、annotations 与失败壳
const channelsTool = tools.result.tools.find((t) => t.name === "console_channels");
assert(channelsTool?.description.includes("Use when") && channelsTool.description.includes("Returns")
  && channelsTool.description.includes("Limits:") && channelsTool.description.includes("Related tools:"),
  "console_channels description covers use/behavior/returns/limits/related tools");
assert(channelsTool?.annotations?.readOnlyHint === true && channelsTool.annotations.idempotentHint === true
  && channelsTool.annotations.destructiveHint === false && channelsTool.annotations.openWorldHint === false,
  "console_channels advertises all four read-only annotations");
const channelsRaw = await call("tools/call", { name: "console_channels", arguments: {} });
const channelsFail = callJson(channelsRaw);
assert(channelsFail.ok === false && channelsFail.code === "dota_down" && channelsFail.message.includes("未连接到 Dota 2"),
  "console_channels failure is a parseable {ok:false,code,message} envelope: " + JSON.stringify(channelsFail));
assert(channelsRaw.result.isError === true, "contract failure sets isError on the MCP result");

const status = await call("tools/call", { name: "dota_status", arguments: {} });
const statusText = status.result.content[0].text;
assert(!status.result.isError && statusText.includes("not connected"), "dota_status guides without throwing when Dota down");

const send = await call("tools/call", { name: "console_send", arguments: { commands: "echo hi" } });
assert(send.result.isError && send.result.content[0].text.includes("未连接到 Dota 2"), "console_send blocked with actionable text when Dota down");

const skill = await call("tools/call", { name: "dota2_skill", arguments: { name: "dota2-game-phases" } });
assert(skill.result.content[0].text.includes("CUSTOM_GAME_SETUP"), "dota2-game-phases skill loads");

const compileBlocked = await call("tools/call", { name: "dota2_skill", arguments: {} });
assert(compileBlocked.result.content[0].text.includes("dota2-runtime-dev"), "skill list works (non-console tool ungated)");

const skillOutline = await call("tools/call", { name: "dota2_skill", arguments: { name: "dota2-vfx", outline: true } });
assert(skillOutline.result.content[0].text.includes("Official recipe library"), "skill outline exposes nested sections");
const recipe = await call("tools/call", { name: "dota2_skill", arguments: { name: "dota2-vfx", section: "Official recipe library" } });
assert(recipe.result.content[0].text.includes("ContinuousEmitter") && !recipe.result.content[0].text.includes("Full class field reference"), "nested section retrieval stops at the next sibling heading");
const ambiguous = await call("tools/call", { name: "dota2_skill", arguments: { name: "dota2-vfx", section: "Common" } });
assert(ambiguous.result.content[0].text.includes("Ambiguous section"), "ambiguous section prefixes fail clearly");
const stats = await call("tools/call", { name: "dota2_skill", arguments: { name: "dota2-vfx", data: "vpcf-stats.json", data_path: "e_combos.top10.0" } });
const statsEnvelope = JSON.parse(stats.result.content[0].text);
const firstRecipe = JSON.parse(statsEnvelope.text);
assert(Array.isArray(firstRecipe) && firstRecipe.length > 0 && !statsEnvelope.text.includes("filesAnalyzed"), "JSON data_path returns only the requested array entry");
const dataSection = await call("tools/call", { name: "dota2_skill", arguments: { name: "dota2-vfx", data: "vpcf-official-findings.md", section: "Sources" } });
assert(dataSection.result.content[0].text.includes("## Sources") && !dataSection.result.content[0].text.includes("TL;DR"), "Markdown data files support focused section retrieval");
const badPath = await call("tools/call", { name: "dota2_skill", arguments: { name: "dota2-vfx", data: "vpcf-stats.json", data_path: "e_combos.top10.999" } });
assert(badPath.result.content[0].text.includes("Unknown data_path"), "out-of-range JSON array index fails clearly");

kill();
await sleep(300);
rmSync(stateDir, { recursive: true, force: true });
console.log("PASS");
process.exit(0);

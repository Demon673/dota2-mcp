// 离线断言：只读族工具迁移到统一契约——tools/list 的四类 annotations 与五段式描述，
// 以及代表性失败路径的 {ok:false,code,message} 壳。隔离端口 + 独立状态目录，不需要 Dota。
// console_gui_filter 只是 relay 内存状态开关，没有可达失败路径，这里只断言成功壳。
import { spawnMcpServer, assert, sleep, callJson } from "./lib-mcp.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ERROR_CODES, READ_ONLY_ANNOTATIONS } from "../dist/tools/tool-result.js";
import { DEFAULT_VERSION } from "../dist/tools/vrf-ensure.js";
import { freePortBlock } from "./lib-test-ports.mjs";

const stateDir = mkdtempSync(path.join(tmpdir(), "migrate-read-state-"));
const vrfCache = mkdtempSync(path.join(tmpdir(), "migrate-read-vrf-"));
const BASE = await freePortBlock(3);
const VRF_API_PORT = await freePortBlock(1); // 不监听 → vrf_ensure 的失败路径无需联网

// vrf_ensure 成功路径：缓存命中直接返回；失败路径：API 指向未监听端口
const vrfExe = process.platform === "win32" ? "Source2Viewer-CLI.exe" : "Source2Viewer-CLI";
mkdirSync(path.join(vrfCache, "v" + DEFAULT_VERSION), { recursive: true });
writeFileSync(path.join(vrfCache, "v" + DEFAULT_VERSION, vrfExe), "");

const env = {
  ...process.env,
  DOTA2_VCON_DOTA_PORT: String(BASE),
  DOTA2_VCON_GUI_PORT: String(BASE + 1),
  DOTA2_VCON_CTRL_PORT: String(BASE + 2),
  DOTA2_VCON_STATE_DIR: stateDir,
  VRF_CACHE_DIR: vrfCache,
  VRF_API_BASE: `http://127.0.0.1:${VRF_API_PORT}`,
};
const { call, notify, kill } = spawnMcpServer({ timeoutMs: 45000, env, cleanupDaemon: true });
await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "migrate-read", version: "0" } });
notify("notifications/initialized");
await sleep(12000); // createRelay 探测/拉起 daemon

const tools = (await call("tools/list", {})).result.tools;
const byName = new Map(tools.map((t) => [t.name, t]));

const READ_TOOLS = [
  "console_find", "console_help", "dota_dump_entities", "dota_dump_modifiers", "dota_entity_inspect",
  "dota_api_lua", "dota_api_panorama_js", "dota_api_css", "dota_api_events", "dota_api_help",
  "asset_inspect", "asset_check_refs", "file_read", "dota2_skill",
];
const MIGRATED = [...READ_TOOLS, "console_gui_filter", "vrf_ensure"];
const HINTS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];

for (const name of MIGRATED) {
  const tool = byName.get(name);
  assert(!!tool, name + " is registered");
  const a = tool.annotations;
  assert(a && HINTS.every((k) => typeof a[k] === "boolean"),
    name + " advertises all four annotation hints: " + JSON.stringify(a));
  assert(["Use when", "Returns", "Limits:", "Related tools:"].every((s) => tool.description.includes(s)),
    name + " description carries the five-part contract");
}
for (const name of READ_TOOLS) {
  const a = byName.get(name).annotations;
  assert(HINTS.every((k) => a[k] === READ_ONLY_ANNOTATIONS[k]), name + " is annotated read-only");
}
assert(byName.get("console_gui_filter").annotations.readOnlyHint === false,
  "console_gui_filter is not advertised read-only (it toggles relay state)");
assert(byName.get("vrf_ensure").annotations.openWorldHint === true && byName.get("vrf_ensure").annotations.readOnlyHint === false,
  "vrf_ensure declares its external/network side effect");

async function expectFail(name, args, code) {
  const raw = await call("tools/call", { name, arguments: args });
  const env = callJson(raw);
  assert(env.ok === false && typeof env.code === "string" && typeof env.message === "string" && env.message.length > 0,
    name + " failure is a {ok:false,code,message} envelope: " + JSON.stringify(env).slice(0, 300));
  assert(ERROR_CODES.includes(env.code), name + " failure code is from the contract vocabulary: " + env.code);
  assert(raw.result.isError === true, name + " failure sets isError");
  if (code) assert(env.code === code, name + " failure code is " + code + " (got " + env.code + ")");
}

// 门控：隔离环境没有 Dota 连接 → dota_down，而不是自由文本
for (const [name, args] of [
  ["console_find", { query: "dota" }],
  ["console_help", { command: "dota_launch_custom_game" }],
  ["dota_dump_entities", {}],
  ["dota_dump_modifiers", {}],
  ["dota_entity_inspect", { entity: "world" }],
  ["dota_api_lua", {}],
  ["dota_api_panorama_js", {}],
  ["dota_api_css", {}],
  ["dota_api_events", {}],
  ["dota_api_help", {}],
]) await expectFail(name, args, "dota_down");

await expectFail("dota2_skill", { name: "no-such-skill" }, "invalid_arg");
const skillList = callJson(await call("tools/call", { name: "dota2_skill", arguments: {} }));
assert(skillList.ok === true && typeof skillList.text === "string" && skillList.text.includes("dota2-runtime-dev"),
  "dota2_skill success is a {ok:true,text} envelope");

// 非法 addon 在触碰 VRF/文件系统前被拒绝（没有 Dota 路径时同样以契约壳失败）
for (const name of ["file_read", "asset_inspect", "asset_check_refs"]) {
  await expectFail(name, { target: "x.txt", addon: ".." });
}

const vrfHit = callJson(await call("tools/call", { name: "vrf_ensure", arguments: {} }));
assert(vrfHit.ok === true && typeof vrfHit.text === "string" && vrfHit.text.includes("cached"),
  "vrf_ensure cache hit returns {ok:true,text}");
await expectFail("vrf_ensure", { version: "0.0.0-test" }, "internal");

const gui = callJson(await call("tools/call", { name: "console_gui_filter", arguments: { auto: false } }));
assert(gui.ok === true && gui.data && gui.data.mcpSuppressEnabled === false,
  "console_gui_filter returns {ok:true,data} with the effective relay state");
await call("tools/call", { name: "console_gui_filter", arguments: { auto: true } });

kill();
await sleep(300);
rmSync(stateDir, { recursive: true, force: true });
rmSync(vrfCache, { recursive: true, force: true });
console.log("PASS");
process.exit(0);

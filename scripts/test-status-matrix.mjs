// 离线验收 dota_status 能力矩阵：{ok:true,data:{daemon,vconsole,dota,phase,cheats,addon,map,available_actions},text}
// 形状、八个事实键、available_actions 数组、Dota 缺席时不抛异常，以及 tools/list 的 annotations/五段式描述。
// 需要 dist 已构建；隔离端口与 DOTA2_VCON_STATE_DIR，无需 Dota 2 / vconsole。
import { spawnMcpServer, assert, sleep, callJson } from "./lib-mcp.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { freePortBlock } from "./lib-test-ports.mjs";

const FACT_KEYS = ["daemon", "vconsole", "dota", "phase", "cheats", "addon", "map", "available_actions"];
const stateDir = mkdtempSync(path.join(tmpdir(), "mcp-status-matrix-"));
const BASE = await freePortBlock(3);
const env = {
  ...process.env,
  DOTA2_VCON_DOTA_PORT: String(BASE),
  DOTA2_VCON_GUI_PORT: String(BASE + 1),
  DOTA2_VCON_CTRL_PORT: String(BASE + 2),
  DOTA2_VCON_STATE_DIR: stateDir,
};
const { call, notify, kill } = spawnMcpServer({ timeoutMs: 45000, env, cleanupDaemon: true });
await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "status-matrix", version: "0" } });
notify("notifications/initialized");
await sleep(12000); // createRelay 会探测/拉起 daemon

const tools = await call("tools/list", {});
const statusTool = tools.result.tools.find((t) => t.name === "dota_status");
assert(statusTool, "dota_status is registered");
assert(statusTool.annotations?.readOnlyHint === true && statusTool.annotations.idempotentHint === true
  && statusTool.annotations.destructiveHint === false && statusTool.annotations.openWorldHint === false,
  "dota_status advertises all four read-only annotations");
assert(statusTool.description.includes("Use when") && statusTool.description.includes("Returns")
  && statusTool.description.includes("Limits:") && statusTool.description.includes("Related tools:"),
  "dota_status description covers use/behavior/returns/limits/related tools");

const raw = await call("tools/call", { name: "dota_status", arguments: {} });
assert(!raw.result.isError, "dota_status never throws with Dota absent");
const envelope = callJson(raw);
assert(envelope.ok === true, "dota_status returns the {ok:true,...} envelope: " + JSON.stringify(envelope).slice(0, 300));
assert(envelope.data && typeof envelope.data === "object" && !Array.isArray(envelope.data), "envelope carries a data object");
const missing = FACT_KEYS.filter((k) => !(k in envelope.data));
assert(missing.length === 0, "data carries all eight capability facts (missing: " + missing.join(", ") + ")");
assert(Array.isArray(envelope.data.available_actions), "available_actions is an array");
assert(envelope.data.available_actions.every((a) => typeof a === "string"), "available_actions holds action names");
assert(typeof envelope.text === "string" && envelope.text.includes("not connected"),
  "text summary keeps the offline compatibility phrase 'not connected'");

kill();
await sleep(300);
rmSync(stateDir, { recursive: true, force: true });
console.log("PASS");
process.exit(0);

#!/usr/bin/env node
/**
 * 活体冒烟：11 个 API/dump/console 工具的 live 覆盖（需要 Dota 2 + daemon + vconsole 已接入——
 * 先跑 test-mcp-live.mjs 打开门控）。工具枚举（31 个、无 project_info）已由 test-mcp-offline.mjs 负责；
 * 这里是唯一覆盖这 11 个工具（五个 dota_api_*、dota_dump_entities/modifiers、dota_entity_inspect、
 * console_find/help/gui_filter）的 live 冒烟。
 */
import { spawnMcpServer, sleep } from "./lib-mcp.mjs";

function truncate(text, max = 500) {
  if (!text) return "";
  const s = typeof text === "string" ? text : JSON.stringify(text);
  return s.length > max ? s.slice(0, max) + `\n... (${s.length - max} chars truncated)` : s;
}

const { call, notify, kill } = spawnMcpServer({ timeoutMs: 20000 });

await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "dota2-mcp-smoke-test", version: "0.1.0" } });
notify("notifications/initialized");
await sleep(8000); // 等接入已有 daemon

const results = [];

async function smoke(name, args = {}, timeoutMs = 20000) {
  try {
    const res = await call("tools/call", { name, arguments: args }, timeoutMs);
    const text = res.result.content?.map((c) => c.text).join("\n") ?? "";
    const ok = !res.result.isError;
    results.push({ name, ok, text });
    console.log(`[${ok ? "PASS" : "FAIL"}] ${name}: ${truncate(text, 200).replace(/\n/g, " ")}`);
    return text;
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.log(`[ERROR] ${name}: ${err.message}`);
    return "";
  }
}

console.log("\n=== Tool smoke tests ===");

// API / runtime query tools
await smoke("dota_api_lua", { func: "print", side: "server" });
await smoke("dota_api_panorama_js", { name: "GameEvents" });
await smoke("dota_api_css", { prop: "wash-color" });
await smoke("dota_api_events", { event: "SetPanelSelected" });
await smoke("dota_api_help", { query: "CreateUnitByName" });
await smoke("dota_dump_entities");
await smoke("dota_dump_modifiers", { side: "client" });
await smoke("dota_entity_inspect", { entity: "world", side: "server" });

// Console discovery / help
await smoke("console_find", { query: "dota_launch_custom_game" });
await smoke("console_help", { command: "dota_launch_custom_game" });

// GUI filter toggle
await smoke("console_gui_filter", { auto: false });
await smoke("console_gui_filter", { auto: true });

kill();

console.log("\n=== Summary ===");
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log(`Total: ${results.length}, Passed: ${passed}, Failed: ${failed}`);
for (const r of results) {
  if (!r.ok) {
    console.log(`\n- ${r.name}: ${r.error || "tool returned isError"}`);
    if (r.text) console.log(truncate(r.text, 400));
  }
}
process.exit(failed > 0 ? 1 : 0);

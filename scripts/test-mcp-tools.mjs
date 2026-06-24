#!/usr/bin/env node
/**
 * Smoke-test all MCP tools exposed by dota2-mcp.
 *
 * Spawns the server, waits for the Dota 2 VCon connection, exercises every tool,
 * and prints a compact pass/fail summary.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EXPECTED_TOOLS = new Set([
  "console_output",
  "console_channels",
  "console_send",
  "project_info",
  "dota_launch_game",
  "dota_disconnect",
  "dota_restart",
  "dota_dump_entities",
  "dota_dump_modifiers",
  "dota_entity_inspect",
  "dota_api_lua",
  "dota_api_panorama_js",
  "dota_api_css",
  "dota_api_events",
  "console_find",
  "console_help",
  "console_gui_filter",
  "dota_api_help",
  "dota_run_lua",
  "dota_compile_asset",
]);

const MCP_MARKER = "ai_disabled = false";

function truncate(text, max = 500) {
  if (!text) return "";
  const s = typeof text === "string" ? text : JSON.stringify(text);
  return s.length > max ? s.slice(0, max) + `\n... (${s.length - max} chars truncated)` : s;
}

function waitForServer(stderrStream, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout waiting for server to connect to Dota 2"));
    }, timeoutMs);

    const onData = (d) => {
      const text = d.toString();
      process.stderr.write(text);
      if (text.includes("[relay] Dota 2 connected")) {
        cleanup();
        resolve();
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      stderrStream.off("data", onData);
    };

    stderrStream.on("data", onData);
  });
}

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    stderr: "pipe",
  });

  transport.stderr.on("data", (d) => process.stderr.write(d));
  const readyPromise = waitForServer(transport.stderr);

  const client = new Client({ name: "dota2-mcp-smoke-test", version: "0.1.0" });
  await client.connect(transport);
  await readyPromise;

  const { tools } = await client.listTools();
  const found = new Set(tools.map((t) => t.name));
  const missing = [...EXPECTED_TOOLS].filter((n) => !found.has(n));
  const extra = [...found].filter((n) => !EXPECTED_TOOLS.has(n));

  console.log("\n=== Registered tools ===");
  console.log(`Found ${tools.length} tools`);
  if (missing.length) console.log("Missing expected:", missing);
  if (extra.length) console.log("Unexpected extra:", extra);

  const results = [];

  async function call(name, args = {}, { timeoutMs = 20000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await client.callTool({ name, arguments: args }, undefined, { signal: controller.signal });
      clearTimeout(timer);
      const text = res.content?.map((c) => c.text).join("\n") ?? "";
      results.push({ name, ok: !res.isError, text });
      const status = !res.isError ? "PASS" : "FAIL";
      console.log(`[${status}] ${name}: ${truncate(text, 200).replace(/\n/g, " ")}`);
      return text;
    } catch (err) {
      clearTimeout(timer);
      results.push({ name, ok: false, error: err.message });
      console.log(`[ERROR] ${name}: ${err.message}`);
      return "";
    }
  }

  console.log("\n=== Tool smoke tests ===");

  // 1. Basic read-only tools
  await call("project_info");
  await call("console_channels");

  // 2. Marker suppression: default should be ON and status_json output still reaches MCP
  await call("console_send", { commands: "status_json" });
  const markerLines = await call("console_output", { lines: 50, filter: `^${MCP_MARKER}$` });
  const hasMarkerInMcpOutput = markerLines.includes(MCP_MARKER);
  if (hasMarkerInMcpOutput) {
    results.push({ name: "marker_suppression_default", ok: false, error: "marker leaked into MCP console_output" });
    console.log("[FAIL] marker_suppression_default: marker leaked into MCP console_output");
  } else {
    results.push({ name: "marker_suppression_default", ok: true, text: "marker hidden from MCP output" });
    console.log("[PASS] marker_suppression_default: marker hidden from MCP output");
  }

  // 3. Console discovery / help
  await call("console_find", { query: "dota_launch_custom_game" });
  await call("console_help", { command: "dota_launch_custom_game" });

  // 4. Load a map so API/dump tests have a runtime context
  await call("dota_launch_game", { timeout: 45 }, { timeoutMs: 65000 });
  await call("project_info");

  // 5. API / runtime query tools
  await call("dota_api_lua", { func: "print", side: "server" });
  await call("dota_api_panorama_js", { name: "GameEvents" });
  await call("dota_api_css", { prop: "wash-color" });
  await call("dota_api_events", { event: "SetPanelSelected" });
  await call("dota_api_help", { query: "CreateUnitByName" });
  await call("dota_run_lua", { code: "print('mcp_test_hello')" }, { timeoutMs: 25000 });
  await call("dota_dump_entities");
  await call("dota_dump_modifiers", { side: "client" });
  await call("dota_entity_inspect", { entity: "world", side: "server" });

  // 6. GUI filter toggle
  await call("console_gui_filter", { auto: false });
  await call("console_gui_filter", { auto: true });

  // 7. Destructive / build tools (called late to minimize disruption)
  await call("dota_restart");
  await call("dota_disconnect");
  await call("dota_compile_asset", { target: "__mcp_test_nonexistent__.vmap" });

  await client.close();

  console.log("\n=== Summary ===");
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`Total: ${results.length}, Passed: ${passed}, Failed: ${failed}`);
  if (missing.length) console.log("Missing tools:", missing);
  for (const r of results) {
    if (!r.ok) {
      console.log(`\n- ${r.name}: ${r.error || "tool returned isError"}`);
      if (r.text) console.log(truncate(r.text, 400));
    }
  }
  process.exit(failed > 0 || missing.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});

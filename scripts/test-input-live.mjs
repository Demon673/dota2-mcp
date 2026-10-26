// Live checks for dota_input: real OS input must activate a Panorama button,
// produce hover enter/leave, and type into the native chat TextEntry. Requires
// Dota 2 in a loaded custom game with vconsole attached and sv_cheats=1. The
// test creates one probe button at a HUD-safe position and removes it in a
// finally block; chat text is cleared and chat is closed with Escape.
import { spawnMcpServer, callJson, assert, sleep } from "./lib-mcp.mjs";

const { call, notify, kill } = spawnMcpServer({ timeoutMs: 300000 });
await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "input-live", version: "0" } });
notify("notifications/initialized");

async function tool(name, args = {}, timeout = 290000) {
  return callJson(await call("tools/call", { name, arguments: args }, timeout));
}

async function exec(code, timeout = 30000) {
  const r = await tool("panorama_exec_js", { code, timeout_ms: timeout }, timeout + 10000);
  if (!r.ok) throw new Error("panorama_exec_js failed: " + JSON.stringify(r));
  return r.data?.result;
}

let probeId = "";
try {
  const status = await tool("dota_status", {}, 30000);
  assert(status.ok && status.data?.dota && status.data?.vconsole && status.data?.phase === "playing" && status.data?.cheats === true,
    "live Dota + vconsole + cheats + a loaded map are required: " + JSON.stringify(status));
  console.log(`[test] using live addon=${status.data.addon} map=${status.data.map}`);

  const info = await tool("dota_input", { action: "window_info" });
  assert(info.ok && info.data?.window?.title === "Dota 2" && info.data.window.client?.width > 0,
    "dota_input window_info finds the game client: " + JSON.stringify(info));
  const out = await tool("dota_input", { action: "click", x: 5000, y: 5000, button: "left" });
  assert(out.ok === false && out.code === "invalid_arg", "coordinates outside the client fail before input: " + JSON.stringify(out));
  console.log("[test] PASS window info and bounds");

  const tag = "d2mcp_input_probe_" + Date.now().toString(36);
  probeId = tag + "_btn";
  await exec([
    `var b=$.CreatePanel('Button',MCP.top(),'${probeId}');`,
    "b.style.position='400px 400px 0px 0px';b.style.width='200px';b.style.height='80px';b.style.backgroundColor='#c33';b.hittest=true;",
    "MCP._probe={id:b.id,activate:0,over:0,out:0};",
    "MCP.on(b,'onactivate',function(){MCP._probe.activate++;});",
    "MCP.on(b,'onmouseover',function(){MCP._probe.over++;});",
    "MCP.on(b,'onmouseout',function(){MCP._probe.out++;});",
    "return b.id;",
  ].join(""));
  await sleep(800);
  const rect = await exec(`return MCP.rect('#${probeId}');`);
  assert(rect?.w >= 190 && rect?.h >= 70, "probe button is laid out: " + JSON.stringify(rect));
  const bx = Math.round(rect.x + rect.w / 2);
  const by = Math.round(rect.y + rect.h / 2);

  const clicked = await tool("dota_input", { action: "click", x: bx, y: by, button: "left" });
  assert(clicked.ok && clicked.data?.focused === true && clicked.data?.restored_cursor === true,
    "dota_input click sends input and restores the cursor: " + JSON.stringify(clicked));
  const afterClick = await exec("return MCP._probe;");
  assert(afterClick?.activate >= 1, "a real click fires onactivate: " + JSON.stringify(afterClick));
  console.log("[test] PASS real click activation");

  const hovered = await tool("dota_input", { action: "move", x: bx, y: by });
  assert(hovered.ok, "dota_input move sends a cursor move: " + JSON.stringify(hovered));
  await sleep(300);
  const afterHover = await exec("return MCP._probe;");
  assert(afterHover?.over >= 1, "a real cursor move fires onmouseover: " + JSON.stringify(afterHover));
  const left = await tool("dota_input", { action: "move", x: 10, y: 10 });
  assert(left.ok, "dota_input move leaves the button: " + JSON.stringify(left));
  await sleep(300);
  const afterLeave = await exec("return MCP._probe;");
  assert(afterLeave?.out >= 1, "leaving the button fires onmouseout: " + JSON.stringify(afterLeave));
  console.log("[test] PASS real hover enter/leave");

  const opened = await tool("dota_input", { action: "key_press", key: "ENTER" });
  assert(opened.ok, "dota_input opens chat with a real Enter key: " + JSON.stringify(opened));
  await sleep(300);
  const chat = await exec("var p=MCP.select('#ChatInput');return {present:!!p,visible:p?MCP.isVisible(p):false,rect:(function(){try{return MCP.rect(p);}catch(e){return null;}})()};");
  assert(chat?.present && chat.visible && chat.rect?.w > 0, "the native chat TextEntry is available: " + JSON.stringify(chat));
  const typed = await tool("dota_input", { action: "text", text: "hello 世界" });
  assert(typed.ok, "dota_input types Unicode text: " + JSON.stringify(typed));
  await sleep(300);
  const afterText = await exec("var t=MCP.select('#ChatInput');return t?String(t.text):null;");
  assert(afterText === "hello 世界", "typed text reaches the native TextEntry: " + JSON.stringify(afterText));
  console.log("[test] PASS native TextEntry typing");

  const keyed = await tool("dota_input", { action: "key_press", key: "A" });
  assert(keyed.ok, "dota_input presses a key: " + JSON.stringify(keyed));
  await sleep(200);
  const afterKey = await exec("var t=MCP.select('#ChatInput');return t?String(t.text):null;");
  assert(afterKey === "hello 世界a", "a key press reaches the focused TextEntry: " + JSON.stringify(afterKey));
  console.log("[test] PASS key press");

  await tool("dota_input", { action: "key_press", key: "ESC" });
  await exec("var t=MCP.select('#ChatInput');if(t)t.text='';return true;");
  const after = await tool("dota_input", { action: "window_info" });
  assert(after.ok && after.data?.window?.title === "Dota 2", "the game window remains available after input: " + JSON.stringify(after));
  console.log("[test] PASS window remains available");
  console.log("[test] done");
} finally {
  if (probeId) {
    try {
      await exec(`var p=MCP.select('#${probeId}');if(p)p.DeleteAsync(0);MCP._handlers={};MCP._probe=null;return true;`, 10000);
    } catch (e) {
      console.log("[test] cleanup warning: " + e.message);
    }
  }
  kill();
}

// Live smoke for background Panorama panel events. Requires Dota 2 running with
// an addon/map loaded, vconsole attached to 127.0.0.1:29001, sv_cheats=1, and a
// relay daemon. Creates probe widgets under DotaHud, drives them through the
// bridge helpers without OS input, and removes them in a finally block.
import { spawnMcpServer, callJson } from "./lib-mcp.mjs";

const { call, notify, kill } = spawnMcpServer({ timeoutMs: 300000 });
await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "panorama-events", version: "0" } });
notify("notifications/initialized");

const IDS = ["McpEvtButton", "McpEvtToggle", "McpEvtSlider", "McpEvtEntry"];
let failed = false;

async function tool(name, args = {}, timeout = 290000) {
  return callJson(await call("tools/call", { name, arguments: args }, timeout));
}

function check(cond, msg) {
  if (cond) { console.log("ok -", msg); return; }
  throw new Error(msg);
}

function has(list, value) {
  return Array.isArray(list) && list.includes(value);
}

async function cleanup() {
  try { await tool("console_send", { commands: "r_always_render_all_windows 1" }, 30000); } catch { /* console may be gone */ }
  try {
    await tool("panorama_exec_js", {
      code: "var ids=" + JSON.stringify(IDS) + ";var n=0;for(var i=0;i<ids.length;i++){var p=MCP.select('#'+ids[i]);if(p){p.DeleteAsync(0);n++;}}MCP._handlers={};return {deleted:n};",
    });
    await new Promise((r) => setTimeout(r, 800));
  } catch { /* bridge may be gone */ }
  try { await tool("console_send", { commands: "r_always_render_all_windows 0" }, 30000); } catch { /* ignore */ }
  try {
    const left = await tool("panorama_exec_js", {
      code: "var ids=" + JSON.stringify(IDS) + ";var left=[];for(var i=0;i<ids.length;i++){if(MCP.select('#'+ids[i]))left.push(ids[i]);}return {left:left};",
    });
    if (left.data?.result?.left?.length) console.error("WARN: probe panels left:", JSON.stringify(left.data.result.left));
  } catch { /* ignore */ }
}

try {
  const status = await tool("dota_status", {}, 30000);
  check(status.ok && status.data?.dota && status.data?.vconsole, "live Dota + vconsole are required: " + JSON.stringify(status));
  check(status.data?.cheats === true, "sv_cheats must be on; run console_send 'sv_cheats 1' first");
  console.log(`[test] using live addon=${status.data.addon} map=${status.data.map}`);

  const created = await tool("panorama_exec_js", {
    code: [
      "MCP._testFired={button:[],toggle:[],slider:[],entry:[]};",
      "var root=MCP.top();",
      "function mk(t,id,x){var p=$.CreatePanel(t,root,id);p.style.x=x+'px';p.style.y='10px';p.style.width='150px';p.style.height='40px';p.style.backgroundColor='#333333';p.text=t;return p;}",
      "var b=mk('Button','McpEvtButton',10);",
      "var t=mk('ToggleButton','McpEvtToggle',180);",
      "var s=mk('SlottedSlider','McpEvtSlider',350);",
      "var e=mk('TextEntry','McpEvtEntry',520);",
      "MCP.on(b,'onactivate',function(){MCP._testFired.button.push('onactivate');});",
      "MCP.on(b,'onselect',function(){MCP._testFired.button.push('onselect');});",
      "MCP.on(t,'onfocus',function(){MCP._testFired.toggle.push('onfocus');});",
      "MCP.on(t,'onblur',function(){MCP._testFired.toggle.push('onblur');});",
      "MCP.on(t,'onselect',function(){MCP._testFired.toggle.push('onselect');});",
      "MCP.on(s,'onvaluechanged',function(){MCP._testFired.slider.push('onvaluechanged');});",
      "MCP.on(e,'ontextentrychange',function(){MCP._testFired.entry.push('ontextentrychange');});",
      "return {created:[b.id,t.id,s.id,e.id],types:[b.paneltype,t.paneltype,s.paneltype,e.paneltype]};",
    ].join(""),
  });
  check(created.ok && created.data?.result?.created?.length === 4, "probe widgets created: " + JSON.stringify(created));
  console.log("[test] PASS probe widgets created");

  const triggered = await tool("panorama_exec_js", {
    code: [
      "MCP.focus('#McpEvtToggle');",
      "MCP.blur('#McpEvtToggle');",
      "MCP.selectPanel('#McpEvtToggle');",
      "MCP.setValue('#McpEvtSlider',0.5);",
      "MCP.setText('#McpEvtEntry','abc');",
      "var em=MCP.emit('#McpEvtButton','onactivate');",
      "return {fired:MCP._testFired,emitted:em};",
    ].join(""),
  });
  const f = triggered.data?.result?.fired;
  check(triggered.ok, "helper triggers executed: " + JSON.stringify(triggered));
  check(has(f?.toggle, "onfocus") && has(f?.toggle, "onblur") && has(f?.toggle, "onselect"), "focus/blur/selectPanel raise onfocus/onblur/onselect: " + JSON.stringify(f));
  check(has(f?.slider, "onvaluechanged"), "setValue raises onvaluechanged: " + JSON.stringify(f));
  check(has(f?.entry, "ontextentrychange"), "setText raises ontextentrychange: " + JSON.stringify(f));
  check(has(f?.button, "onactivate") && triggered.data?.result?.emitted?.fired === 1, "emit invokes an MCP.on handler directly: " + JSON.stringify(triggered));
  console.log("[test] PASS background helpers raise events");

  const raw = await tool("panorama_exec_js", {
    code: [
      "MCP._testFired.toggle=[];MCP._testFired.button=[];",
      "MCP.dispatch('SetInputFocus','#McpEvtToggle');",
      "MCP.dispatch('DropInputFocus','#McpEvtToggle');",
      "MCP.dispatch('TogglePanelSelected','#McpEvtButton');",
      "return {toggle:MCP._testFired.toggle,button:MCP._testFired.button};",
    ].join(""),
  });
  check(raw.ok && has(raw.data?.result?.toggle, "onfocus") && has(raw.data?.result?.toggle, "onblur") && has(raw.data?.result?.button, "onselect"),
    "MCP.dispatch forwards engine events to panel handlers: " + JSON.stringify(raw));
  console.log("[test] PASS engine event dispatch");

  const limits = await tool("panorama_exec_js", {
    code: [
      "var err='';try{MCP.dispatch('onactivate','#McpEvtButton');}catch(e){err=String(e&&e.message||e);}",
      "var no=MCP.emit('#McpEvtButton','onmouseover');",
      "return {err:err,noHandler:no};",
    ].join(""),
  });
  const lim = limits.data?.result;
  check(limits.ok && /Invalid event name/.test(lim?.err || ""), "onactivate is not a dispatchable engine event: " + JSON.stringify(limits));
  check(lim?.noHandler?.fired === 0 && /no handler/.test(lim?.noHandler?.note || ""), "emit without an MCP.on handler reports zero: " + JSON.stringify(limits));
  console.log("[test] PASS dispatch limits are explicit");

  console.log("[test] done");
} catch (e) {
  failed = true;
  console.error("FAIL:", e.message);
} finally {
  await cleanup();
  kill();
}

process.exit(failed ? 1 : 0);

// Live smoke for panorama_exec_js. Requires Dota 2 running with an addon/map
// loaded, vconsole attached to 127.0.0.1:29001, sv_cheats=1, and a relay daemon
// (the MCP server attaches to it). The test uses the running addon dynamically;
// it never hardcodes a project or path. It leaves the bridge alive with no files.
import { spawnMcpServer, callJson, assert, sleep } from "./lib-mcp.mjs";

const { call, notify, kill } = spawnMcpServer({ timeoutMs: 300000 });
await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "panorama-live", version: "0" } });
notify("notifications/initialized");

async function tool(name, args = {}, timeout = 290000) {
  return callJson(await call("tools/call", { name, arguments: args }, timeout));
}

try {
  const status = await tool("dota_status", {}, 30000);
  assert(status.ok && status.data?.dota && status.data?.vconsole, "live Dota + vconsole are required: " + JSON.stringify(status));
  assert(status.data?.cheats === true, "sv_cheats must be on; run console_send 'sv_cheats 1' first");
  const addon = status.data.addon;
  const map = status.data.map;
  console.log(`[test] using live addon=${addon} map=${map}`);

  const first = await tool("panorama_exec_js", { code: "return 6 * 7" });
  assert(first.ok && first.data?.result === 42, "simple return value is 42: " + JSON.stringify(first));
  assert(typeof first.data?.generation === "string" && first.data.generation.length > 0, "bridge reports a generation");
  console.log(`[test] PASS first exec (rebuilt=${first.data.rebuilt})`);

  let stale = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const cleanup = await tool("panorama_exec_js", {
      code: "var kids=MCP.children('#CustomHudElements');var self=MCP.root().id;var prefix=self.replace(/_[0-9a-f]{8}$/,'_');var old=[];for(var i=0;i<kids.length;i++){if(kids[i].id&&kids[i].id!==self&&kids[i].id.indexOf(prefix)===0)old.push(kids[i].id);}return {self:self,old:old}",
    });
    stale = cleanup.data?.result?.old || [];
    if (!cleanup.ok || stale.length === 0) break;
    await sleep(400);
  }
  assert(stale.length === 0, "a rebuilt bridge removes older bridge HUD elements: " + JSON.stringify(stale));
  console.log("[test] PASS stale bridge cleanup");

  const context = await tool("panorama_exec_js", { code: "return MCP.context()" });
  const ctx = context.data?.result;
  assert(context.ok && ctx && ctx.addon_globals === false, "MCP.context reports the bridge context boundary: " + JSON.stringify(context));
  assert(ctx.top_id === "DotaHud" && ctx.top_is_root === true && Array.isArray(ctx.parents) && ctx.parents.length > 0 && ctx.parents[0].FindChildTraverse === "function",
    "MCP.context reports the top panel, root boundary and ancestor panel API");
  assert(ctx.parents.every(p => typeof p.type === "string" && p.type.length > 0),
    "MCP.context reports a panel type for every ancestor: " + JSON.stringify(ctx));
  assert(ctx.parents.some(p => p.type === "DOTAHud") && ctx.parents.some(p => p.type === "DOTACustomUIRoot"),
    "MCP.context ancestor types come from Panel.paneltype: " + JSON.stringify(ctx));
  assert(typeof ctx.note === "string" && ctx.note.includes("sibling top-level windows"), "MCP.context states the top-level window boundary");
  console.log("[test] PASS context boundary probe");

  const selectors = await tool("panorama_exec_js", {
    code: "var top=MCP.top(); var hud=MCP.select('#Hud'); var cui=MCP.select('#CustomUIRoot', top); var local=MCP.select('#'+MCP.root().id); var missing=MCP.select('#D2McpNoSuchPanel'); var scoped=MCP.select('#Hud', MCP.root()); return {top:top&&top.id,hud:hud&&hud.id,cui:cui&&cui.id,local:local&&local.id,bridge:MCP.root().id,missing:missing===null,scoped:scoped===null}",
  });
  const sel = selectors.data?.result;
  assert(selectors.ok && sel?.top === "DotaHud", "MCP.top reaches the outermost panel: " + JSON.stringify(selectors));
  assert(sel?.hud === "Hud" && sel?.cui === "CustomUIRoot", "MCP.select searches engine HUD and custom UI panels by id: " + JSON.stringify(selectors));
  assert(sel?.local === sel?.bridge && sel?.missing && sel?.scoped, "selectors are global by default, scoped by the second argument, and null when absent: " + JSON.stringify(selectors));
  console.log("[test] PASS global selectors and outermost root");

  const uiMap = await tool("panorama_exec_js", {
    code: "var m=MCP.map();var cui=MCP.customUi('#CustomHudElements');var outside=MCP.customUi('#HUDElements');var hudEl=MCP.hudElements('#minimap_container');var kids=MCP.children('#CustomUIRoot');var hudKids=MCP.children('#HUDElements');var bad=[];var hasContainer=false;for(var i=0;i<kids.length;i++){if(typeof kids[i].type!=='string'||!kids[i].type)bad.push('cui:'+kids[i].id);if(kids[i].type==='DOTACustomUITypeContainer')hasContainer=true;}for(var j=0;j<hudKids.length;j++){if(typeof hudKids[j].type!=='string'||!hudKids[j].type)bad.push('hud:'+hudKids[j].id);}return {top:m.top,path:m.path,customUi:m.anchors.customUi,hudElements:m.anchors.hudElements,customAreas:m.customUiAreas,hudWidgets:m.hudWidgets,labels:m.labels,cui:cui&&cui.id,outside:outside===null,hudEl:hudEl&&hudEl.id,kidCount:kids.length,firstKid:kids[0]&&kids[0].id,badTypes:bad,hasContainer:hasContainer}",
  });
  const m = uiMap.data?.result;
  assert(uiMap.ok && m?.top === "DotaHud" && m?.customUi?.present === true && m?.hudElements?.present === true,
    "MCP.map reports the HUD anchors: " + JSON.stringify(uiMap));
  assert(Array.isArray(m?.customAreas) && m.customAreas.includes("CustomUIContainer_Hud") && Array.isArray(m?.hudWidgets) && m.hudWidgets.includes("minimap_container"),
    "MCP.map classifies custom UI areas and engine HUD widgets: " + JSON.stringify(uiMap));
  assert(m?.cui === "CustomHudElements" && m?.outside === true && m?.hudEl === "minimap_container" && m?.kidCount >= 9,
    "customUi/hudElements/children are anchored and scoped: " + JSON.stringify(uiMap));
  assert(Array.isArray(m?.badTypes) && m.badTypes.length === 0 && m?.hasContainer === true,
    "MCP.children reports a non-empty panel type for every child: " + JSON.stringify(uiMap));
  assert(typeof m?.labels?.["CustomUIContainer_Hud"] === "string", "MCP.map labels the custom UI containers: " + JSON.stringify(uiMap));
  console.log("[test] PASS UI map and custom UI anchors");

  const helpers = await tool("panorama_exec_js", {
    code: "var p=MCP.root(),ot=p.text,ov=p.visible,ow=p.style.width;var t,v,w;try{MCP.text(p,'hello');t=p.text;MCP.visible(p,false);v=p.visible;MCP.style(p,'width','10px');w=MCP.style(p,'width');}finally{p.text=ot;p.visible=ov;p.style.width=ow;}return {t:t,v:v,w:w}",
  });
  assert(helpers.ok && helpers.data?.result?.t === "hello" && helpers.data?.result?.v === false && helpers.data?.result?.w === "10.0px",
    "MCP text/visible/style round-trip: " + JSON.stringify(helpers));
  console.log("[test] PASS MCP helper round-trip");

  const big = await tool("panorama_exec_js", { code: "var s='x';while(s.length<16000)s+=s;return s;" });
  assert(big.ok && big.data?.result?.truncated === true && /too large/.test(big.data.result.error || "") && big.data.result.head.length === 11000,
    "a result over the console line budget returns a structured truncation: " + JSON.stringify({ ok: big.ok, truncated: big.data?.result?.truncated, head: big.data?.result?.head?.length }));
  const huge = await tool("panorama_exec_js", { code: "var s='x';while(s.length<40000)s+=s;return s;" });
  assert(huge.ok && huge.data?.result?.truncated === true && /too large/.test(huge.data.result.error || ""),
    "a much larger result uses the same truncation instead of breaking the bridge: " + JSON.stringify(huge.data?.result));
  console.log("[test] PASS large result truncation");

  const syntax = await tool("panorama_exec_js", { code: "return (", timeout_ms: 2000 });
  assert(syntax.ok === false && syntax.code === "js_error", "syntax errors surface as js_error: " + JSON.stringify(syntax));
  console.log("[test] PASS syntax error is js_error");

  console.log("[test] done");
} finally {
  kill();
}

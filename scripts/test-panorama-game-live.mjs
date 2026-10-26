// Live checks for the geometry/game-state helpers added to panorama_exec_js.
// Requires Dota 2 in a loaded custom game with vconsole attached, sv_cheats=1,
// and a relay daemon. The addon/map come from dota_status; the test selects the
// local hero, issues a harmless stop order, and restores the camera look-at.
import { spawnMcpServer, callJson, assert } from "./lib-mcp.mjs";

const { call, notify, kill } = spawnMcpServer({ timeoutMs: 300000 });
await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "panorama-game-live", version: "0" } });
notify("notifications/initialized");

async function tool(name, args = {}, timeout = 290000) {
  return callJson(await call("tools/call", { name, arguments: args }, timeout));
}

async function exec(code, timeout = 30000) {
  const r = await tool("panorama_exec_js", { code, timeout_ms: timeout }, timeout + 10000);
  if (!r.ok) throw new Error("panorama_exec_js failed: " + JSON.stringify(r));
  return r.data?.result;
}

let hiddenId = "";
try {
  const status = await tool("dota_status", {}, 30000);
  assert(status.ok && status.data?.dota && status.data?.vconsole, "live Dota + vconsole are required: " + JSON.stringify(status));
  assert(status.data?.phase === "playing", "a loaded map in a playable phase is required: " + JSON.stringify(status));
  assert(status.data?.cheats === true, "sv_cheats must be on");
  console.log(`[test] using live addon=${status.data.addon} map=${status.data.map}`);

  const geom = await exec("var r=MCP.rect(MCP.hudElements('#minimap_container'));var c=MCP.center(MCP.hudElements('#minimap_container'));var p=MCP.panelAt(c.x,c.y);return {r:r,c:c,p:p,visible:MCP.isVisible('#minimap_container'),inside:p? c.x>=p.rect.x&&c.x<=p.rect.x+p.rect.w&&c.y>=p.rect.y&&c.y<=p.rect.y+p.rect.h : false}");
  assert(geom?.r && Number.isFinite(geom.r.x) && Number.isFinite(geom.r.y) && geom.r.w > 0 && geom.r.h > 0,
    "MCP.rect returns finite position and layout size: " + JSON.stringify(geom));
  assert(geom?.r?.type && geom?.r?.visible === true && geom?.visible === true,
    "MCP.rect/isVisible report a visible typed panel: " + JSON.stringify(geom));
  assert(geom?.c?.x === Math.round(geom.r.x + geom.r.w / 2) && geom?.c?.y === Math.round(geom.r.y + geom.r.h / 2),
    "MCP.center returns the rounded center of the rect: " + JSON.stringify(geom));
  assert(geom?.p && geom.p.id && geom.inside === true,
    "MCP.panelAt returns the panel containing the point: " + JSON.stringify(geom));
  console.log("[test] PASS rect/center/isVisible/panelAt");

  hiddenId = "d2mcp_test_hidden_" + Date.now().toString(36);
  const hidden = await exec(`var p=$.CreatePanel('Panel', MCP.root(), '${hiddenId}');p.visible=false;var v=MCP.isVisible(p);return {visible:v}`);
  assert(hidden?.visible === false, "MCP.isVisible reflects a hidden panel: " + JSON.stringify(hidden));
  console.log("[test] PASS hidden visibility");

  const geo = await exec("var s=MCP.selection();var e=s.selected&&s.selected.length?s.selected[0]:null;var u=MCP.units();var hero=null;for(var i=0;i<u.length;i++){if(u[i].hero){hero=u[i];break;}}if(!hero&&e==null)throw new Error('no controllable hero');if(hero){var w=MCP.worldToScreen(hero.position);var sw=MCP.screenToWorld([w.x,w.y]);var hit=MCP.entitiesAt([w.x,w.y]);return {selection:s,units:u.length,hero:hero,world:w,screenWorld:sw,hit:hit};}return {selection:s,units:u.length,hero:null};");
  assert(geo?.selection && Array.isArray(geo.selection.selected) && Number.isFinite(geo.selection.player),
    "MCP.selection reports the local player and selection: " + JSON.stringify(geo));
  assert(Number.isFinite(geo?.units) && geo.units >= 1, "MCP.units returns a list: " + JSON.stringify(geo));
  assert(geo?.hero && geo.hero.hero === true && geo.hero.controllable === true && typeof geo.hero.name === "string" && geo.hero.name.length > 0,
    "MCP.units/unitInfo describe the local hero: " + JSON.stringify(geo));
  assert(Array.isArray(geo.hero.position) && geo.hero.position.length >= 3,
    "MCP.unitInfo reports the hero origin: " + JSON.stringify(geo));
  assert(Number.isFinite(geo?.world?.x) && Number.isFinite(geo?.world?.y),
    "MCP.worldToScreen returns finite screen coordinates: " + JSON.stringify(geo));
  assert(Array.isArray(geo?.screenWorld) && geo.screenWorld.length >= 3,
    "MCP.screenToWorld returns a world position: " + JSON.stringify(geo));
  assert(Array.isArray(geo?.hit), "MCP.entitiesAt returns a list: " + JSON.stringify(geo));
  console.log("[test] PASS selection/units/world conversions");

  const cursor = await exec("var c=MCP.cursor();return c;");
  assert(cursor && Array.isArray(cursor.screen) && cursor.screen.length === 2 && cursor.screen.every(Number.isFinite),
    "MCP.cursor reports a screen position: " + JSON.stringify(cursor));
  assert(Array.isArray(cursor.entities), "MCP.cursor reports entities under the cursor: " + JSON.stringify(cursor));
  console.log("[test] PASS cursor");

  const select = await exec("var u=MCP.units();var hero=null;for(var i=0;i<u.length;i++){if(u[i].hero){hero=u[i];break;}}if(!hero)throw new Error('no hero');var one=MCP.selectUnit(hero.index,false);var all=MCP.selectAllUnits();var byName=MCP.selectUnit(hero.name,false);return {one:one.selected,all:all.selected,byName:byName.selected,hero:hero.index};");
  assert(Array.isArray(select?.one) && select.one.length === 1 && select.one[0] === select.hero,
    "MCP.selectUnit selects one entity: " + JSON.stringify(select));
  assert(Array.isArray(select?.all) && select.all.length >= 1 && select.all.indexOf(select.hero) !== -1,
    "MCP.selectAllUnits selects controlled units: " + JSON.stringify(select));
  assert(Array.isArray(select?.byName) && select.byName.length === 1 && select.byName[0] === select.hero,
    "MCP.selectUnit resolves a unit name: " + JSON.stringify(select));
  console.log("[test] PASS selectUnit/selectAllUnits");

  const cam = await exec("var s=MCP.camera();var after=MCP.camera({lookAt:s.lookAt||null,lerp:0});return {before:s,after:after};");
  assert(cam?.before && (Array.isArray(cam.before.position) || cam.before.position == null),
    "MCP.camera reports camera state: " + JSON.stringify(cam));
  assert(cam?.after && typeof cam.after === "object", "MCP.camera applies a look-at target: " + JSON.stringify(cam));
  console.log("[test] PASS camera state");

  const ordered = await exec("var u=MCP.units();var hero=null;for(var i=0;i<u.length;i++){if(u[i].hero){hero=u[i];break;}}if(!hero)throw new Error('no hero');return MCP.order({order:'stop',unit:hero.index,showEffects:false});");
  assert(ordered?.sent === true && ordered?.request?.OrderType !== undefined,
    "MCP.order sends a unit order: " + JSON.stringify(ordered));
  console.log("[test] PASS order");

  console.log("[test] done");
} finally {
  if (hiddenId) {
    try {
      await exec(`var p=MCP.select('#${hiddenId}');if(p)p.DeleteAsync(0);return true;`, 10000);
    } catch (e) {
      console.log("[test] cleanup warning: " + e.message);
    }
  }
  kill();
}

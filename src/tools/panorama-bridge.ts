/**
 * Panorama bridge manager — owned by the relay daemon.
 *
 * The bridge is a tiny dynamic HUD layout whose JavaScript subscribes to a
 * token-scoped custom event and runs the supplied code through
 * `RunScriptInPanelContext`. Provisioning is transient: copy the two source
 * files into the addon content, let the engine compile them on demand, load
 * the HUD, wait for a ping, then delete the source and compiled outputs.
 *
 * The server Lua listener prints every client ack as a token-prefixed console
 * line; the manager correlates `started`/`done` acks by request id. This is the
 * feedback path that lets the tool distinguish "sent" from "executed".
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { pidPath } from "../daemon-utils.js";

export interface BridgeConsoleLine {
  text: string;
  verbosity?: number;
  channel?: string;
}

/** The relay supplies console access; tests supply a fake. */
export interface BridgeDeps {
  addonName: () => string;
  dotaPath: () => string | null;
  consoleReady: () => boolean;
  sendCommand: (cmd: string) => void;
  onPrnt: (fn: (line: BridgeConsoleLine) => void) => () => void;
}

export type BridgeOp = "exec" | "status" | "reset";

export interface BridgeRequest {
  id: string;
  op: BridgeOp;
  code?: string;
  timeoutMs?: number;
}

export interface BridgeResult {
  ok: boolean;
  code?: string;
  message?: string;
  result?: unknown;
  logs?: string[];
  output?: string;
  requestId?: string;
  generation?: string;
  elementId?: string;
  rebuilt?: boolean;
  durationMs?: number;
  cleanupWarning?: string;
}

interface EnsureResult {
  ok: boolean;
  code?: string;
  message?: string;
  rebuilt?: boolean;
  output?: string;
  cleanupWarning?: string;
}

interface Ack {
  phase: string;
  ok: number;
  payload: string;
}

const PROTOCOL_VERSION = 1;
const HELPER_VERSION = 10;
const MAX_LUA_BYTES = 510;
const MAX_RESULT_LINES = 80;

const XML_TEMPLATE = (element: string): string =>
  `<root><scripts><include src="file://{resources}/layout/custom_game/${element}/bridge.js" /></scripts><Panel /></root>`;

/**
 * Injected bridge. Placeholders are replaced with JSON-quoted strings at
 * write time. The wrapper runs the submitted code inside a function, so the
 * caller can use `return <value>` and the bridge reports the value in `done`.
 */
const JS_TEMPLATE = `$.p = $.GetContextPanel();
var __EXEC = __D2MCP_EXEC__, __ACK = __D2MCP_ACK__, __PING = __D2MCP_PING__, __GEN = __D2MCP_GEN__;
var MCP = {
  _logs: {}, _seen: {}, _order: [], _cur: "",
  root: function () { return $.p; },
  top: function () {
    var p = $.p;
    for (var i = 0; i < 32 && p && p.GetParent && p.GetParent(); i++) p = p.GetParent();
    return p;
  },
  select: function (sel, from) {
    if (typeof sel !== "string") return sel || null;
    var key = sel.charAt(0) === "#" ? sel.slice(1) : sel;
    if (!key) return null;
    var p = from || MCP.top();
    if (typeof p === "string") p = MCP.select(p);
    if (!p) return null;
    if (p.id === key) return p;
    try {
      if (typeof p.FindChildTraverse === "function") {
        var hit = p.FindChildTraverse(key);
        if (hit) return hit;
      }
    } catch (e) { }
    var stack = [p], n = 0;
    while (stack.length > 0 && n < 20000) {
      var cur = stack.pop(); n++;
      if (cur.id === key) return cur;
      var count = 0;
      try { count = cur.GetChildCount ? cur.GetChildCount() : 0; } catch (e) { count = 0; }
      for (var i = count - 1; i >= 0; i--) {
        try { var ch = cur.GetChild(i); if (ch) stack.push(ch); } catch (e) { }
      }
    }
    return null;
  },
  $: function (sel, from) { return MCP.select(sel, from); },
  hudElements: function (sel) {
    var root = MCP.select("#HUDElements");
    if (!sel) return root;
    if (!root) return null;
    return MCP.select(sel, root);
  },
  customUi: function (sel) {
    var root = MCP.select("#CustomUIRoot");
    if (!sel) return root;
    if (!root) return null;
    return MCP.select(sel, root);
  },
  children: function (sel) {
    var p = MCP._need(sel), out = [], n = 0;
    try { n = p.GetChildCount ? p.GetChildCount() : 0; } catch (e) { n = 0; }
    for (var i = 0; i < n && out.length < 200; i++) {
      var c = null;
      try { c = p.GetChild(i); } catch (e) { c = null; }
      if (!c) continue;
      var count = 0;
      try { count = c.GetChildCount ? c.GetChildCount() : 0; } catch (e) { count = 0; }
      out.push({ id: c.id || "", type: c.paneltype || c.type || "", visible: !!c.visible, children: count });
    }
    return out;
  },
  _handlers: {},
  dispatch: function (event, sel) {
    var p = MCP._need(sel);
    var args = [event, p].concat(Array.prototype.slice.call(arguments, 2));
    try {
      $.DispatchEvent.apply($, args);
    } catch (e) {
      throw new Error("DispatchEvent '" + event + "' failed: " + (e && e.message ? e.message : e));
    }
    return { id: p.id || "", event: event };
  },
  focus: function (sel) { return MCP.dispatch("SetInputFocus", sel); },
  blur: function (sel) { return MCP.dispatch("DropInputFocus", sel); },
  selectPanel: function (sel, selected) {
    if (arguments.length < 2) return MCP.dispatch("TogglePanelSelected", sel);
    return MCP.dispatch("SetPanelSelected", sel, !!selected);
  },
  setValue: function (sel, value) {
    var p = MCP._need(sel);
    p.value = value;
    return { id: p.id || "", value: p.value };
  },
  setText: function (sel, value) {
    var p = MCP._need(sel);
    p.text = String(value);
    return { id: p.id || "", text: p.text };
  },
  on: function (sel, event, fn) {
    var p = MCP._need(sel);
    if (typeof fn !== "function") throw new Error("MCP.on needs a function handler");
    var key = (p.id || "") + "|" + event;
    var slot = MCP._handlers[key];
    if (!slot) slot = MCP._handlers[key] = { handlers: [], wrapper: null };
    if (!slot.wrapper) {
      var wrapper = function () {
        var hs = slot.handlers.slice();
        for (var i = 0; i < hs.length; i++) {
          try { hs[i].apply(p, arguments); }
          catch (e) { MCP.log("MCP.on handler error (" + event + "): " + e); }
        }
      };
      p.SetPanelEvent(event, wrapper);
      slot.wrapper = wrapper;
    }
    slot.handlers.push(fn);
    return { id: p.id || "", event: event, handlers: slot.handlers.length };
  },
  emit: function (sel, event) {
    var p = MCP._need(sel);
    var slot = MCP._handlers[(p.id || "") + "|" + event];
    if (!slot || slot.handlers.length === 0) {
      return { id: p.id || "", event: event, fired: 0, note: "no handler registered through MCP.on" };
    }
    var args = [p, event].concat(Array.prototype.slice.call(arguments, 2));
    var fired = 0, errors = [];
    var hs = slot.handlers.slice();
    for (var i = 0; i < hs.length; i++) {
      try { hs[i].apply(p, args); fired++; }
      catch (e) { errors.push(String(e && e.message ? e.message : e)); }
    }
    return { id: p.id || "", event: event, fired: fired, errors: errors };
  },
  _prop: function (o, name) {
    try {
      var v = o[name];
      return typeof v === "function" ? v.call(o) : v;
    } catch (e) { return undefined; }
  },
  rect: function (sel) {
    var p = MCP._need(sel);
    var pos = MCP._prop(p, "GetPositionWithinWindow");
    if (!pos || (typeof pos.x !== "number" && typeof pos[0] !== "number")) pos = MCP._prop(p, "GetPosition");
    if (!pos || (typeof pos.x !== "number" && typeof pos[0] !== "number")) {
      throw new Error("panel has no screen position: " + sel);
    }
    var x = Number(typeof pos.x === "number" ? pos.x : pos[0]);
    var y = Number(typeof pos.y === "number" ? pos.y : pos[1]);
    var w = Number(MCP._prop(p, "actuallayoutwidth")) || 0;
    var h = Number(MCP._prop(p, "actuallayoutheight")) || 0;
    var cw = Number(MCP._prop(p, "contentwidth")) || 0;
    var ch = Number(MCP._prop(p, "contentheight")) || 0;
    return {
      id: p.id || "", type: String(p.paneltype || p.type || ""),
      x: x, y: y, w: w, h: h, cw: cw, ch: ch,
      visible: MCP.isVisible(p)
    };
  },
  center: function (sel) {
    var r = MCP.rect(sel);
    return { id: r.id, x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2), rect: r };
  },
  isVisible: function (sel) {
    var p = MCP._need(sel);
    for (var i = 0; i < 64 && p; i++) {
      if (MCP._prop(p, "visible") === false) return false;
      p = MCP._prop(p, "GetParent");
    }
    return true;
  },
  panelAt: function (x, y) {
    var pt = Array.isArray(x) ? x : [x, y];
    var px = Number(pt[0]), py = Number(pt[1]);
    if (!isFinite(px) || !isFinite(py)) throw new Error("panelAt needs numeric x,y");
    var budget = { n: 0 };
    function hit(p, depth) {
      if (!p || depth > 64 || budget.n++ > 6000) return null;
      var r;
      try { r = MCP.rect(p); } catch (e) { return null; }
      if (!r.visible || px < r.x || px > r.x + r.w || py < r.y || py > r.y + r.h) return null;
      var n = 0;
      try { n = p.GetChildCount ? p.GetChildCount() : 0; } catch (e) { n = 0; }
      for (var i = n - 1; i >= 0; i--) {
        var c = null;
        try { c = p.GetChild(i); } catch (e) { c = null; }
        var found = hit(c, depth + 1);
        if (found) return found;
      }
      return p;
    }
    var top = MCP.top();
    var found = hit(top, 0);
    if (!found) return null;
    var rr = MCP.rect(found);
    return { id: rr.id, type: rr.type, rect: rr };
  },
  cursor: function () {
    var cp = GameUI.GetCursorPosition();
    if (!cp) throw new Error("cursor position unavailable");
    var screen = [Number(cp[0]), Number(cp[1])];
    var world = null, entities = [];
    try { world = GameUI.GetScreenWorldPosition(screen); } catch (e) { world = null; }
    try { entities = GameUI.FindScreenEntities(screen) || []; } catch (e) { entities = []; }
    return { screen: screen, world: world, entities: entities };
  },
  entitiesAt: function (x, y) {
    var pt = Array.isArray(x) ? x : [x, y];
    return GameUI.FindScreenEntities([Number(pt[0]), Number(pt[1])]) || [];
  },
  worldToScreen: function (v) {
    var p = Array.isArray(v) ? v : (v && [v.x, v.y, v.z]);
    if (!p || p.length < 3) throw new Error("worldToScreen needs [x,y,z]");
    return {
      x: Game.WorldToScreenX(Number(p[0]), Number(p[1]), Number(p[2])),
      y: Game.WorldToScreenY(Number(p[0]), Number(p[1]), Number(p[2]))
    };
  },
  screenToWorld: function (x, y) {
    var pt = Array.isArray(x) ? x : [x, y];
    if (typeof Game.ScreenXYToWorld === "function") return Game.ScreenXYToWorld(Number(pt[0]), Number(pt[1]));
    return GameUI.GetScreenWorldPosition([Number(pt[0]), Number(pt[1])]);
  },
  unitInfo: function (index) {
    var e = Number(index);
    var out = {
      index: e,
      name: String(MCP._try(function () { return Entities.GetUnitName(e); }, "") || ""),
      hero: !!MCP._try(function () { return Entities.IsHero(e); }, false),
      owner: MCP._try(function () { return Entities.GetPlayerOwnerID(e); }, null),
      controllable: !!MCP._try(function () { return Entities.IsControllableByPlayer(e, Players.GetLocalPlayer()); }, false),
      position: MCP._try(function () { return Entities.GetAbsOrigin(e); }, null)
    };
    out.team = MCP._try(function () { return Entities.GetTeamNumber(e); }, null);
    out.health = MCP._try(function () { return Entities.GetHealth(e); }, null);
    out.maxHealth = MCP._try(function () { return Entities.GetMaxHealth(e); }, null);
    return out;
  },
  units: function (filter) {
    var me = Players.GetLocalPlayer();
    var q = filter == null ? "" : String(filter).toLowerCase();
    var all = Entities.GetAllEntities() || [];
    var out = [];
    for (var i = 0; i < all.length && out.length < 200; i++) {
      var e = all[i];
      if (!MCP._try(function () { return Entities.IsControllableByPlayer(e, me); }, false)) continue;
      if (q) {
        var name = String(MCP._try(function () { return Entities.GetUnitName(e); }, "") || "").toLowerCase();
        if (name.indexOf(q) === -1 && String(e) !== q) continue;
      }
      out.push(MCP.unitInfo(e));
    }
    return out;
  },
  selection: function () {
    var me = Players.GetLocalPlayer();
    var selected = MCP._try(function () { return Players.GetSelectedEntities(me); }, []) || [];
    var units = [];
    for (var i = 0; i < selected.length; i++) {
      try { units.push(MCP.unitInfo(selected[i])); } catch (e) { }
    }
    return {
      player: me,
      selected: selected,
      heroID: MCP._try(function () { return Players.GetSelectedHeroID(me); }, null),
      units: units
    };
  },
  selectUnit: function (ent, add) {
    var e = ent;
    if (typeof ent === "string") {
      var all = Entities.GetAllEntities() || [], wanted = ent.toLowerCase();
      e = null;
      for (var i = 0; i < all.length && i < 20000; i++) {
        var name = String(MCP._try(function () { return Entities.GetUnitName(all[i]); }, "") || "").toLowerCase();
        if (name === wanted) { e = all[i]; break; }
      }
      if (e == null) throw new Error("no unit named: " + ent);
    }
    var n = Number(e);
    if (!isFinite(n)) throw new Error("select needs an entity index or unit name");
    GameUI.SelectUnit(n, !!add);
    return MCP.selection();
  },
  selectAllUnits: function () {
    var me = Players.GetLocalPlayer();
    var all = Entities.GetAllEntities() || [];
    var first = true, count = 0;
    for (var i = 0; i < all.length && count < 200; i++) {
      if (!MCP._try(function () { return Entities.IsControllableByPlayer(all[i], me); }, false)) continue;
      GameUI.SelectUnit(all[i], !first);
      first = false;
      count++;
    }
    if (first) GameUI.SelectUnit(-1, false);
    return MCP.selection();
  },
  _cameraState: function () {
    var out = {};
    var keys = [
      ["position", "GetCameraPosition"],
      ["lookAt", "GetCameraLookAtPosition"],
      ["yaw", "GetCameraYaw"],
      ["distance", "GetCameraDistance"]
    ];
    for (var i = 0; i < keys.length; i++) {
      var v = MCP._try(function () { return GameUI[keys[i][1]](); }, undefined);
      if (v !== undefined) out[keys[i][0]] = v;
    }
    return out;
  },
  camera: function (opts) {
    if (!opts) return MCP._cameraState();
    var lerp = typeof opts.lerp === "number" ? opts.lerp : 0;
    if (opts.lookAt) GameUI.SetCameraTargetPosition(opts.lookAt, lerp);
    if (opts.follow !== undefined) GameUI.SetCameraTarget(Number(opts.follow));
    if (opts.toEntity !== undefined) GameUI.MoveCameraToEntity(Number(opts.toEntity));
    if (typeof opts.yaw === "number") GameUI.SetCameraYaw(Number(opts.yaw));
    if (typeof opts.distance === "number") GameUI.SetCameraDistance(Number(opts.distance));
    return MCP._cameraState();
  },
  order: function (args) {
    if (!args || typeof args !== "object") throw new Error("order needs an arguments object");
    if (typeof dotaunitorder_t === "undefined") throw new Error("dotaunitorder_t is unavailable");
    var map = {
      move: "DOTA_UNIT_ORDER_MOVE_TO_POSITION",
      attack: "DOTA_UNIT_ORDER_ATTACK_TARGET",
      attack_move: "DOTA_UNIT_ORDER_ATTACK_MOVE",
      stop: "DOTA_UNIT_ORDER_STOP",
      hold: "DOTA_UNIT_ORDER_HOLD_POSITION",
      patrol: "DOTA_UNIT_ORDER_PATROL",
      cast_target: "DOTA_UNIT_ORDER_CAST_TARGET",
      cast_position: "DOTA_UNIT_ORDER_CAST_POSITION",
      cast_no_target: "DOTA_UNIT_ORDER_CAST_NO_TARGET",
      cast_toggle: "DOTA_UNIT_ORDER_CAST_TOGGLE"
    };
    var name = String(args.order || "");
    if (map[name]) name = map[name];
    var orderType = dotaunitorder_t[name];
    if (orderType === undefined) throw new Error("unknown order: " + args.order);
    var issuer = args.issuer || "DOTA_ORDER_ISSUER_SELECTED_UNITS";
    var queue = args.queue || "DOTA_ORDER_QUEUE_DEFAULT";
    var issuerMap = {
      selected: "DOTA_ORDER_ISSUER_SELECTED_UNITS",
      passed: "DOTA_ORDER_ISSUER_PASSED_UNIT_ONLY",
      current: "DOTA_ORDER_ISSUER_CURRENT_UNIT_ONLY",
      hero: "DOTA_ORDER_ISSUER_HERO_ONLY"
    };
    var queueMap = { default: "DOTA_ORDER_QUEUE_DEFAULT", always: "DOTA_ORDER_QUEUE_ALWAYS", never: "DOTA_ORDER_QUEUE_NEVER" };
    if (issuerMap[issuer]) issuer = issuerMap[issuer];
    if (queueMap[queue]) queue = queueMap[queue];
    var req = {
      OrderType: orderType,
      OrderIssuer: typeof PlayerOrderIssuer_t !== "undefined" && PlayerOrderIssuer_t[issuer] !== undefined ? PlayerOrderIssuer_t[issuer] : issuer,
      QueueBehavior: typeof OrderQueueBehavior_t !== "undefined" && OrderQueueBehavior_t[queue] !== undefined ? OrderQueueBehavior_t[queue] : queue,
      ShowEffects: args.showEffects === true
    };
    if (args.target !== undefined) req.TargetIndex = Number(args.target);
    if (args.position !== undefined) req.Position = args.position;
    if (args.ability !== undefined) req.AbilityIndex = Number(args.ability);
    if (args.unit !== undefined) req.UnitIndex = Number(args.unit);
    Game.PrepareUnitOrders(req);
    return { sent: true, order: name, request: req };
  },
  _try: function (fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  },
  map: function () {
    var top = MCP.top();
    var hud = top ? MCP.select("#Hud", top) : null;
    var hudEl = hud ? hud.FindChildTraverse("HUDElements") : null;
    var cui = hud ? hud.FindChildTraverse("CustomUIRoot") : null;
    var che = cui ? cui.FindChildTraverse("CustomHudElements") : null;
    return {
      top: top ? (top.id || "") : "",
      path: "DotaHud > Hud > { HUDElements | CustomUIRoot > CustomHudElements }",
      hint: "START HERE for addon UI: MCP.customUi('#id'). Engine HUD: MCP.hudElements('#id'). One-level browse: MCP.children(sel).",
      anchors: {
        hud: { id: "Hud", present: !!hud },
        hudElements: { id: "HUDElements", present: !!hudEl, use: "MCP.hudElements('#id')" },
        customUi: { id: "CustomUIRoot", present: !!cui, use: "MCP.customUi('#id')" },
        customHudElements: { id: "CustomHudElements", present: !!che, use: "MCP.customUi('#CustomHudElements')" },
        bridge: { id: $.p.id || "", present: true }
      },
      labels: {
        "Hud": "engine HUD root",
        "HUDElements": "engine HUD widgets",
        "CustomUIRoot": "addon custom UI root — START HERE for addon UI",
        "CustomHudElements": "dynamic HUD/bridge container",
        "CustomUI": "addon custom UI manifest root",
        "CustomUIContainer_Hud": "in-game HUD custom UI",
        "CustomUIContainer_HeroSelection": "hero selection custom UI",
        "CustomUIContainer_PregameStrategy": "pre-game strategy custom UI",
        "CustomUIContainer_GameInfo": "game info custom UI",
        "CustomUIContainer_GameSetup": "game setup custom UI",
        "CustomUIContainer_FlyoutScoreboard": "flyout scoreboard custom UI",
        "CustomUIContainer_HudTopBar": "HUD top bar custom UI",
        "CustomUIContainer_EndScreen": "end screen custom UI",
        "topbar": "top bar",
        "minimap_container": "minimap",
        "shop": "shop",
        "HudChat": "chat",
        "scoreboard": "scoreboard",
        "combat_log": "combat log",
        "combat_events": "combat events",
        "lower_hud": "lower HUD (abilities/items/health)",
        "AbilityHeroIcons": "ability icons",
        "BigHealthBar": "big health bar",
        "PopupManager": "popup manager",
        "Tooltips": "tooltips",
        "ContextMenuManager": "context menus",
        "PreGame": "pre-game",
        "HeroIndicators": "hero indicators"
      },
      customUiAreas: MCP._ids(cui),
      hudAreas: MCP._ids(hud),
      hudWidgets: MCP._ids(hudEl)
    };
  },
  _ids: function (p, limit) {
    var out = [];
    if (!p) return out;
    var n = 0;
    try { n = p.GetChildCount ? p.GetChildCount() : 0; } catch (e) { n = 0; }
    var max = limit || 120;
    for (var i = 0; i < n && out.length < max; i++) {
      try { var c = p.GetChild(i); if (c) out.push(c.id || ""); } catch (e) { }
    }
    return out;
  },
  panel: function (sel) { return typeof sel === "string" ? MCP.select(sel) : sel; },
  _need: function (sel) {
    var p = MCP.panel(sel);
    if (!p) throw new Error("panel not found: " + sel);
    return p;
  },
  text: function (sel, value) {
    var p = MCP._need(sel);
    if (arguments.length < 2) return p.text;
    p.text = value;
    return p;
  },
  visible: function (sel, value) {
    var p = MCP._need(sel);
    if (arguments.length < 2) return p.visible;
    p.visible = !!value;
    return p;
  },
  cls: function (sel, name, value) {
    var p = MCP._need(sel);
    p.SetHasClass(name, !!value);
    return p;
  },
  style: function (sel, prop, value) {
    var p = MCP._need(sel);
    if (arguments.length < 3) return p.style[prop];
    p.style[prop] = value;
    return p;
  },
  snap: function (sel) {
    var p = MCP._need(sel);
    return { id: p.id, text: p.text, visible: p.visible };
  },
  context: function () {
    var chain = [], p = $.p, top = MCP.top();
    for (var i = 0; i < 6 && p; i++) {
      chain.push({
        id: p.id || "",
        type: String(p.paneltype || p.type || ""),
        FindChildTraverse: typeof p.FindChildTraverse,
        FindChild: typeof p.FindChild,
        BHasClass: typeof p.BHasClass
      });
      p = p.GetParent ? p.GetParent() : null;
    }
    return {
      context: "dynamic HUD bridge layout (separate Panorama JS context)",
      root_id: $.p.id || "",
      top_id: top ? (top.id || "") : "",
      top_is_root: !!(top && top.GetParent && !top.GetParent()),
      parents: chain,
      addon_globals: false,
      globals: {
        Game: typeof Game, GameEvents: typeof GameEvents, GameUI: typeof GameUI,
        Players: typeof Players, Entities: typeof Entities, CustomUI: typeof CustomUI
      },
      hints: [
        "Addon Custom UI (most common): MCP.customUi('#id') — anchored at CustomUIRoot.",
        "Engine HUD: MCP.hudElements('#id'); one-level browse: MCP.children(sel); directory: MCP.map().",
        "Geometry: MCP.rect/center/isVisible; approximate hit-test: MCP.panelAt(x,y).",
        "Cursor and world: MCP.cursor/entitiesAt/worldToScreen/screenToWorld; selection and orders: MCP.selection/selectUnit/selectAllUnits/units/unitInfo/order; camera: MCP.camera.",
        "Background panel events: MCP.focus/blur/selectPanel/setValue/setText; any engine event via MCP.dispatch(name, sel, ...args); test handlers via MCP.on/emit. onactivate and mouse events are not dispatchable."
      ],
      note: "Addon JS globals are not in scope. Engine globals and methods/properties on reachable panel instances are available. Native $ and $.FindChildInContext resolve only inside the bridge layout; MCP.select('#id') or MCP.$('#id') searches from the outermost panel (MCP.top()) with FindChildTraverse plus a bounded child walk, and a second panel argument scopes the search. MCP.top() is the root of this top-level window; sibling top-level windows have separate JS contexts and are not reachable from this bridge."
    };
  },
  locate: function (id) { return MCP.select(id); },
  log: function () {
    var a = Array.prototype.slice.call(arguments).map(MCP._safe);
    MCP._logs[MCP._cur] = (MCP._logs[MCP._cur] || []).concat(a);
    return a;
  },
  help: function () {
    return ["START: addon Custom UI -> MCP.customUi('#id'); engine HUD -> MCP.hudElements('#id'); directory -> MCP.map()", "map()", "customUi(sel?)", "hudElements(sel?)", "children(sel)", "top()", "select('#id', from?)", "$('#id', from?)", "context()", "locate(id)", "panel(sel)", "rect(sel)", "center(sel)", "isVisible(sel)", "panelAt(x,y)", "cursor()", "entitiesAt(x,y)", "worldToScreen([x,y,z])", "screenToWorld(x,y)", "units(filter?)", "unitInfo(index)", "selection()", "selectUnit(entity|name, add?)", "selectAllUnits()", "camera(opts?)", "order({order,target?,position?,ability?,unit?,issuer?,queue?,showEffects?})", "text(sel,value?)", "visible(sel,value?)", "cls(sel,name,value)", "style(sel,prop,value?)", "snap(sel)", "dispatch(event,sel,...args)", "focus(sel)", "blur(sel)", "selectPanel(sel,selected?)", "setValue(sel,value)", "setText(sel,text)", "on(sel,event,fn)", "emit(sel,event,...args)", "log(...)", "return <value>"];
  },
  _safe: function (v) {
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return String(v); }
  },
  _send: function (id, phase, ok, payload) {
    try {
      GameEvents.SendCustomGameEventToServer(__ACK, {
        id: id, phase: phase, ok: ok ? 1 : 0, payload: payload == null ? "" : String(payload)
      });
    } catch (e) {
      $.Msg("MCP_ACK_FAIL " + e);
    }
  },
  _done: function (id, ok, value) {
    var payload = "";
    try {
      var v = value;
      if (v instanceof Error) v = { message: String(v.message || v), stack: String(v.stack || "") };
      payload = JSON.stringify({ value: v, logs: MCP._logs[id] || [] });
      if (payload === undefined) payload = JSON.stringify({ value: null, logs: MCP._logs[id] || [] });
    } catch (e) {
      payload = JSON.stringify({ error: "serialize failed: " + e });
    }
    if (payload.length > 12000) {
      payload = JSON.stringify({ error: "result too large", truncated: true, head: payload.slice(0, 11000) });
    }
    MCP._seen[id] = { phase: "done", ok: ok ? 1 : 0, payload: payload };
    MCP._send(id, "done", ok, payload);
    delete MCP._logs[id];
  },
  _run: function (id, code) {
    if (MCP._seen[id]) {
      MCP._send(id, "started", 1, "");
      MCP._send(id, MCP._seen[id].phase, MCP._seen[id].ok, MCP._seen[id].payload);
      return;
    }
    MCP._seen[id] = { phase: "started", ok: 1, payload: "" };
    MCP._order.push(id);
    while (MCP._order.length > 100) delete MCP._seen[MCP._order.shift()];
    MCP._logs[id] = [];
    MCP._cur = id;
    MCP._send(id, "started", 1, "");
    var src = "(function(){try{var __r=(function(){" + code + "\\n})();MCP._done(" + JSON.stringify(id) + ",true,__r);}catch(e){MCP._done(" + JSON.stringify(id) + ",false,e);}})()";
    try {
      $.p.RunScriptInPanelContext(src);
    } catch (e) {
      MCP._done(id, false, e);
    }
  }
};
// Route $.Msg from bridge code into the result logs instead of the engine
// console, so a probe cannot leak arbitrary lines into the human's GUI.
$.Msg = function () {
  try { MCP.log.apply(MCP, ["[$.Msg]"].concat(Array.prototype.slice.call(arguments))); } catch (e) { }
};
if (typeof console !== "undefined" && console && console.log) {
  console.log = function () {
    try { MCP.log.apply(MCP, ["[console.log]"].concat(Array.prototype.slice.call(arguments))); } catch (e) { }
  };
}
GameEvents.Subscribe(__EXEC, function (d) {
  if (d && d.id != null) MCP._run(String(d.id), String(d.code || ""));
});
GameEvents.Subscribe(__PING, function (d) {
  if (d && d.id != null) MCP._send(String(d.id), "pong", 1, __GEN);
});
$.Msg("MCP_BRIDGE_READY " + __GEN);
`;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function jsonQuote(value: string): string {
  return JSON.stringify(value);
}

function stateDirPath(): string {
  return path.dirname(pidPath());
}

/** Token persisted across daemon restarts; the in-game bridge and the next
 *  daemon invocation must use the same event namespace. */
function ensureBridgeToken(): string {
  const p = path.join(stateDirPath(), "bridge.token");
  try {
    const existing = fs.readFileSync(p, "utf-8").trim();
    if (/^[0-9a-f]{32,}$/i.test(existing)) return existing;
  } catch { /* create */ }
  const token = crypto.randomBytes(16).toString("hex");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try {
    fs.writeFileSync(p, token, { mode: 0o600, flag: "wx" });
    return token;
  } catch (e: any) {
    if (e.code === "EEXIST") return fs.readFileSync(p, "utf-8").trim();
    throw e;
  }
}

export class PanoramaBridge {
  private readonly deps: BridgeDeps;
  private readonly token: string;
  private readonly generation: string;
  private readonly elementId: string;
  private readonly execEvent: string;
  private readonly ackEvent: string;
  private readonly pingEvent: string;
  private readonly ackPrefix: string;
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: BridgeDeps) {
    this.deps = deps;
    this.token = ensureBridgeToken();
    this.generation = crypto
      .createHash("sha256")
      .update([PROTOCOL_VERSION, HELPER_VERSION, XML_TEMPLATE("__ELEMENT__"), JS_TEMPLATE].join("\n"))
      .digest("hex")
      .slice(0, 8);
    const t8 = this.token.slice(0, 8);
    this.elementId = `d2mcp_${t8}_${this.generation}`;
    this.execEvent = `d2mcp_${this.token}_${this.generation}_exec`;
    this.ackEvent = `d2mcp_${this.token}_${this.generation}_ack`;
    this.pingEvent = `d2mcp_${this.token}_${this.generation}_ping`;
    this.ackPrefix = `[D2MCP-${t8}-${this.generation}:ACK] `;
    fs.mkdirSync(stateDirPath(), { recursive: true });
  }

  /** Serialize ensure/exec/reset: one bridge per Dota instance. */
  handle(req: BridgeRequest): Promise<BridgeResult> {
    const run = this.queue.then(() => this.handleLocked(req), () => this.handleLocked(req));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async handleLocked(req: BridgeRequest): Promise<BridgeResult> {
    if (req.op === "exec") {
      if (!req.code) return { ok: false, code: "invalid_arg", message: "code is required" };
      return this.executeLocked(req.code, req.timeoutMs ?? 15000, req.id);
    }
    if (req.op === "status") {
      const ens = await this.ensureLocked();
      return {
        ok: ens.ok,
        code: ens.code,
        message: ens.message,
        generation: this.generation,
        elementId: this.elementId,
        rebuilt: ens.rebuilt,
        output: ens.output,
      };
    }
    if (req.op === "reset") {
      await this.destroyHud();
      const cleanupWarning = this.cleanup();
      return {
        ok: true,
        generation: this.generation,
        elementId: this.elementId,
        cleanupWarning,
      };
    }
    return { ok: false, code: "invalid_arg", message: `unknown bridge op '${String(req.op)}'` };
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.seq.toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  }

  private addon(): string { return this.deps.addonName(); }
  private dotaPath(): string | null { return this.deps.dotaPath(); }

  private sourceDir(dotaPath: string, addon: string): string {
    return path.join(dotaPath, "content", "dota_addons", addon, "panorama", "layout", "custom_game", this.elementId);
  }

  private gameDir(dotaPath: string, addon: string): string {
    return path.join(dotaPath, "game", "dota_addons", addon, "panorama", "layout", "custom_game", this.elementId);
  }

  private jsSource(): string {
    return JS_TEMPLATE
      .split("__D2MCP_EXEC__").join(jsonQuote(this.execEvent))
      .split("__D2MCP_ACK__").join(jsonQuote(this.ackEvent))
      .split("__D2MCP_PING__").join(jsonQuote(this.pingEvent))
      .split("__D2MCP_GEN__").join(jsonQuote(this.generation));
  }

  private writeSource(dotaPath: string, addon: string): void {
    const dir = this.sourceDir(dotaPath, addon);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "bridge.xml"), XML_TEMPLATE(this.elementId), "utf-8");
    fs.writeFileSync(path.join(dir, "bridge.js"), this.jsSource(), "utf-8");
  }

  /** Delete only this bridge's source and compiled directories, then prune
   *  empty parents up to `panorama`; a failed cleanup is a warning, not a
   *  bridge failure because the running HUD lives in the process cache. */
  private cleanup(): string | undefined {
    const dotaPath = this.dotaPath();
    const addon = this.addon();
    if (!dotaPath || !addon) return undefined;
    const warnings: string[] = [];
    for (const dir of [this.sourceDir(dotaPath, addon), this.gameDir(dotaPath, addon)]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        let parent = path.dirname(dir);
        for (let i = 0; i < 3; i++) {
          try { fs.rmdirSync(parent); } catch { break; }
          parent = path.dirname(parent);
        }
      } catch (e: any) {
        warnings.push(`${dir}: ${e.message}`);
      }
    }
    return warnings.length > 0 ? warnings.join("; ") : undefined;
  }

  private runConsole(cmd: string, waitMs = 5000): Promise<{ lines: string[]; timedOut: boolean }> {
    return new Promise((resolve) => {
      const begin = `__mcp_${crypto.randomBytes(4).toString("hex")}_begin`;
      const end = `__mcp_${crypto.randomBytes(4).toString("hex")}_end`;
      const lines: string[] = [];
      let inside = false;
      let done = false;
      let timer: NodeJS.Timeout | null = null;
      let off: (() => void) | null = null;
      function finish(timedOut: boolean): void {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (off) off();
        resolve({ lines, timedOut });
      }
      off = this.deps.onPrnt((msg) => {
        const text = String(msg.text ?? "").trim();
        if (text === begin) { inside = true; return; }
        if (text === end) { finish(false); return; }
        if (inside) lines.push(String(msg.text ?? ""));
      });
      timer = setTimeout(() => finish(true), waitMs);
      try {
        this.deps.sendCommand(`echo ${begin}; ${cmd}; echo ${end}`);
      } catch {
        finish(true);
      }
    });
  }

  /** Run a server Lua statement through ent_fire. The body is generated here
   *  and contains no double quotes: exec payloads are hex-encoded, so user
   *  code cannot break the console argument. */
  private async runLua(body: string, waitMs = 5000): Promise<{ ok: boolean; code?: string; message?: string; lines: string[] }> {
    const code = `xpcall(function() ${body} end, function(e) print(debug.traceback(e)) end)`.replace(/"/g, "'");
    const statement = `ent_fire 0 RunScriptCode "${code}"`;
    if (Buffer.byteLength(statement, "utf-8") > MAX_LUA_BYTES) {
      return {
        ok: false,
        code: "lua_too_long",
        message: `Lua statement is ${Buffer.byteLength(statement, "utf-8")} bytes; the console drops anything over ${MAX_LUA_BYTES}.`,
        lines: [],
      };
    }
    const out = await this.runConsole(statement, waitMs);
    if (out.lines.some((l) => l.includes("Cheat command 'ent_fire' ignored"))) {
      return {
        ok: false,
        code: "cheats_off",
        message: "sv_cheats is off; run console_send 'sv_cheats 1' and retry.",
        lines: out.lines,
      };
    }
    return { ok: true, lines: out.lines };
  }

  private async installListener(): Promise<{ ok: boolean; code?: string; message?: string }> {
    const t8 = this.token.slice(0, 8);
    const table = `D2MCP_${t8}_${this.generation}`;
    const fn = `${table}_ACK`;
    const define =
      `${table}=${table} or {acks={},registered=false} ` +
      `function ${fn}(_,d) ${table}.acks[d.id]=d ` +
      `print('${this.ackPrefix}'..tostring(d.id)..' '..tostring(d.phase)..' '..tostring(d.ok)..' '..tostring(d.payload or '')) end`;
    const register =
      `if not ${table}.registered then ${table}.registered=true; ` +
      `CustomGameEventManager:RegisterListener('${this.ackEvent}',${fn}) end`;
    const helper =
      `function ${table}_H(s) return (s:gsub('..',function(x) return string.char(tonumber(x,16)) end)) end ` +
      `${table}_CODES=${table}_CODES or {}`;
    const first = await this.runLua(define, 4000);
    if (!first.ok) return { ok: false, code: first.code, message: first.message };
    const second = await this.runLua(register, 4000);
    if (!second.ok) return { ok: false, code: second.code, message: second.message };
    const third = await this.runLua(helper, 4000);
    if (!third.ok) return { ok: false, code: third.code, message: third.message };
    return { ok: true };
  }

  private async createHud(): Promise<{ ok: boolean; lines: string[] }> {
    // Dynamic HUD panels cannot be deleted from another panel's JS context;
    // destroy every generation recorded in the state file through the same
    // server API that created them, then create this generation.
    const stale = this.knownElements().filter((id) => id !== this.elementId);
    for (const id of stale) {
      await this.runLua(`pcall(CustomUI.DynamicHud_Destroy,CustomUI,-1,'${id}')`, 2500);
    }
    await this.runLua(`pcall(CustomUI.DynamicHud_Destroy,CustomUI,-1,'${this.elementId}')`, 2500);
    const out = await this.runLua(
      `CustomUI:DynamicHud_Create(-1,'${this.elementId}','file://{resources}/layout/custom_game/${this.elementId}/bridge.xml',{})`,
      6000
    );
    if (out.ok) this.rememberElement(this.elementId);
    return { ok: out.ok, lines: out.lines };
  }

  private elementsFile(): string {
    return path.join(stateDirPath(), "bridge.elements");
  }

  private knownElements(): string[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.elementsFile(), "utf-8"));
      return Array.isArray(raw) ? raw.filter((id) => typeof id === "string" && /^[a-z0-9_]+$/i.test(id)) : [];
    } catch {
      return [];
    }
  }

  private rememberElement(id: string): void {
    try {
      fs.writeFileSync(this.elementsFile(), JSON.stringify([id]), "utf-8");
    } catch { /* best-effort: a missing record only leaves an extra HUD panel */ }
  }

  private async destroyHud(): Promise<void> {
    const stale = this.knownElements().filter((id) => id !== this.elementId);
    for (const id of [...stale, this.elementId]) {
      await this.runLua(`pcall(CustomUI.DynamicHud_Destroy,CustomUI,-1,'${id}')`, 2500);
    }
    try { fs.rmSync(this.elementsFile(), { force: true }); } catch { /* ignore */ }
  }

  private ackWaiter(id: string) {
    const queue: Ack[] = [];
    const lines: string[] = [];
    let closed = false;
    let wake: (() => void) | null = null;
    const re = new RegExp(`${escapeRegExp(this.ackPrefix)}(\\S+)\\s+(\\S+)\\s+(\\S+)\\s?(.*)$`);
    const off = this.deps.onPrnt((msg) => {
      const text = String(msg.text ?? "").trim();
      lines.push(text);
      if (lines.length > MAX_RESULT_LINES) lines.shift();
      const m = text.match(re);
      if (!m || m[1] !== id) return;
      queue.push({ phase: m[2], ok: m[3] === "1" || m[3] === "true" ? 1 : 0, payload: m[4] });
      wake?.();
    });
    const next = (phase: string, timeoutMs: number): Promise<Ack | null> => {
      return new Promise((resolve) => {
        const check = (): boolean => {
          const i = queue.findIndex((a) => a.phase === phase);
          if (i < 0) return false;
          const [a] = queue.splice(i, 1);
          resolve(a);
          return true;
        };
        if (check()) return;
        if (closed) { resolve(null); return; }
        const timer = setTimeout(() => { wake = null; resolve(null); }, timeoutMs);
        wake = () => {
          if (check()) { clearTimeout(timer); wake = null; }
        };
      });
    };
    return {
      next,
      tail: (n = 40) => lines.slice(-n),
      close: () => { closed = true; off(); },
    };
  }

  private async sendPing(id: string): Promise<{ ok: boolean; code?: string; message?: string }> {
    const body = `CustomGameEventManager:Send_ServerToAllClients('${this.pingEvent}',{id='${id}'})`;
    const r = await this.runLua(body, 4000);
    return { ok: r.ok, code: r.code, message: r.message };
  }

  private async sendExec(id: string, code: string): Promise<{ ok: boolean; code?: string; message?: string }> {
    const base = `D2MCP_${this.token.slice(0, 8)}_${this.generation}`;
    const hex = Buffer.from(code, "utf-8").toString("hex");
    // The console drops statements over 510 bytes. Hex doubles the payload,
    // so append fixed-size chunks to a server-side buffer and send the
    // reassembled code in one final event.
    const chunkSize = 180;
    for (let i = 0; i < hex.length; i += chunkSize) {
      const chunk = hex.slice(i, i + chunkSize);
      const body = `${base}_CODES['${id}']=(${base}_CODES['${id}'] or '')..${base}_H('${chunk}')`;
      const r = await this.runLua(body, 5000);
      if (!r.ok) {
        await this.runLua(`${base}_CODES['${id}']=nil`, 2000);
        return { ok: false, code: r.code, message: r.message };
      }
    }
    const body =
      `local c=${base}_CODES['${id}']; ${base}_CODES['${id}']=nil; ` +
      `CustomGameEventManager:Send_ServerToAllClients('${this.execEvent}',{id='${id}',code=c})`;
    const r = await this.runLua(body, 5000);
    return { ok: r.ok, code: r.code, message: r.message };
  }

  private async ping(timeoutMs: number): Promise<{ ok: boolean; lines: string[] }> {
    const id = this.nextId("p");
    const waiter = this.ackWaiter(id);
    try {
      const sent = await this.sendPing(id);
      if (!sent.ok) return { ok: false, lines: waiter.tail() };
      const ack = await waiter.next("pong", timeoutMs);
      return { ok: !!ack && ack.ok === 1, lines: waiter.tail() };
    } finally {
      waiter.close();
    }
  }

  private async ensureLocked(): Promise<EnsureResult> {
    if (!this.deps.consoleReady()) {
      return { ok: false, code: "vconsole_closed", message: "vconsole is not attached; open it before using the Panorama bridge." };
    }
    const addon = this.addon();
    const dotaPath = this.dotaPath();
    if (!addon) return { ok: false, code: "addon_missing", message: "No addon is loaded; launch a custom game first." };
    if (!dotaPath) return { ok: false, code: "dota_path_missing", message: "Dota 2 path was not detected." };

    const listener = await this.installListener();
    if (!listener.ok) {
      return { ok: false, code: listener.code ?? "lua_listener_failed", message: listener.message ?? "Could not install the bridge ack listener." };
    }

    const initial = await this.ping(3000);
    if (initial.ok) {
      const cleanupWarning = this.cleanup();
      return { ok: true, rebuilt: false, cleanupWarning };
    }

    // Always write the source before creating. A cache-only probe that fails
    // makes the asset system remember the missing .vxml_c and suppresses the
    // on-demand compile for the next create; the transient write is cheap and
    // the engine still serves the compiled layout from cache when present.
    try {
      this.writeSource(dotaPath, addon);
    } catch (e: any) {
      return { ok: false, code: "bridge_unavailable", message: `Could not write the bridge source: ${e.message}` };
    }
    await new Promise((resolve) => setTimeout(resolve, 150));

    let created = await this.createHud();
    if (created.lines.some((l) => l.includes("RESOURCE COMPILE ERROR"))) {
      const output = [...initial.lines, ...created.lines].slice(-80).join("\n");
      this.cleanup();
      return {
        ok: false,
        code: "bridge_compile_failed",
        message: "The bridge resource compiler rejected the layout or its script.",
        output,
      };
    }
    let finalPing = await this.ping(15000);
    if (!finalPing.ok && finalPing.lines.some((l) => l.includes("RESOURCE COMPILE ERROR"))) {
      const output = [...initial.lines, ...created.lines, ...finalPing.lines].slice(-80).join("\n");
      this.cleanup();
      return {
        ok: false,
        code: "bridge_compile_failed",
        message: "The bridge resource compiler rejected the layout or its script.",
        output,
      };
    }
    if (!finalPing.ok) {
      // The first create can race the asset-system file watcher on a cold
      // start. One retry after the watcher tick is enough; the second call in
      // an interactive session always succeeds after the same write.
      await new Promise((resolve) => setTimeout(resolve, 500));
      created = await this.createHud();
      finalPing = await this.ping(25000);
    }
    if (finalPing.ok) {
      const cleanupWarning = this.cleanup();
      return { ok: true, rebuilt: true, cleanupWarning, output: created.lines.slice(-20).join("\n") };
    }

    const output = [...initial.lines, ...created.lines, ...finalPing.lines].slice(-80).join("\n");
    this.cleanup();
    return {
      ok: false,
      code: "bridge_compile_failed",
      message: "The bridge layout did not answer after provisioning; inspect the compile output for the engine error.",
      output,
    };
  }

  private async executeLocked(code: string, timeoutMs: number, requestId: string): Promise<BridgeResult> {
    const startedAt = Date.now();
    const ensure = await this.ensureLocked();
    if (!ensure.ok) {
      return {
        ok: false,
        code: ensure.code,
        message: ensure.message,
        output: ensure.output,
        requestId,
        generation: this.generation,
        elementId: this.elementId,
        rebuilt: ensure.rebuilt,
        durationMs: Date.now() - startedAt,
      };
    }

    const id = this.nextId("x");
    const waiter = this.ackWaiter(id);
    try {
      let sent = await this.sendExec(id, code);
      if (!sent.ok) {
        return {
          ok: false,
          code: sent.code ?? "exec_not_started",
          message: sent.message ?? "Could not send the exec event.",
          logs: waiter.tail(),
          requestId: id,
          generation: this.generation,
          elementId: this.elementId,
          rebuilt: ensure.rebuilt,
          durationMs: Date.now() - startedAt,
        };
      }

      let started = await waiter.next("started", 4000);
      if (!started) {
        // The event may have been lost while the HUD was tearing down. Ensure
        // once more and resend the same id; the bridge caches acks by id, so a
        // bridge that did receive it re-sends its cached result instead of
        // running the code twice.
        const again = await this.ensureLocked();
        if (again.ok) {
          sent = await this.sendExec(id, code);
          if (sent.ok) started = await waiter.next("started", 4000);
        }
      }
      if (!started) {
        return {
          ok: false,
          code: "exec_not_started",
          message: "The bridge did not acknowledge the exec event; the code was not started.",
          logs: waiter.tail(),
          requestId: id,
          generation: this.generation,
          elementId: this.elementId,
          rebuilt: ensure.rebuilt,
          durationMs: Date.now() - startedAt,
        };
      }

      const done = await waiter.next("done", timeoutMs);
      if (!done) {
        return {
          ok: false,
          code: "exec_incomplete",
          message: "The bridge started the code but did not report completion; it may be still running or the client may have restarted. The code was not retried.",
          logs: waiter.tail(),
          requestId: id,
          generation: this.generation,
          elementId: this.elementId,
          rebuilt: ensure.rebuilt,
          durationMs: Date.now() - startedAt,
        };
      }

      let parsed: any = null;
      try { parsed = done.payload ? JSON.parse(done.payload) : null; } catch { parsed = { value: done.payload }; }
      if (done.ok === 1) {
        return {
          ok: true,
          result: parsed && "value" in parsed ? parsed.value : parsed,
          logs: parsed && Array.isArray(parsed.logs) ? parsed.logs : [],
          output: waiter.tail().join("\n"),
          requestId: id,
          generation: this.generation,
          elementId: this.elementId,
          rebuilt: ensure.rebuilt,
          durationMs: Date.now() - startedAt,
          cleanupWarning: ensure.cleanupWarning,
        };
      }
      const error = parsed && parsed.value ? parsed.value : parsed;
      return {
        ok: false,
        code: "js_error",
        message: error && error.message ? String(error.message) : String(error),
        logs: parsed && Array.isArray(parsed.logs) ? parsed.logs : [],
        output: waiter.tail().join("\n"),
        requestId: id,
        generation: this.generation,
        elementId: this.elementId,
        rebuilt: ensure.rebuilt,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      waiter.close();
    }
  }
}

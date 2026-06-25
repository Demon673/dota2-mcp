#!/usr/bin/env node
/**
 * dota2-mcp — MCP server for DOTA2 custom game development.
 *
 * Tool layers (to be implemented):
 *   1. FileOps       — CRUD KV/Lua/TS/JS/CSS/XML files
 *   2. APIReference  — query Lua/JS/CSS/Panel APIs from vscode-dota2-tools JSON
 *   3. ConsoleBridge — bidirectional Dota 2 console via con_logfile + cfg exec
 *   4. AssetInspector — VRF subprocess for .vmdl/.vmap/.vpcf/.vpk inspection
 *   5. EditorControl — Hammer/ModelDoc/Particle editor via console commands
 *   6. BuildTools    — npm/tstl/rollup integration + scaffolding
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "child_process";
import * as path from "path";
import { VConRelay } from "./tools/vcon-relay.js";
import * as consoleBridge from "./tools/console-bridge.js";

async function main(): Promise<void> {
  const server = new McpServer({
    name: "dota2-mcp",
    version: "1.1.1",
  });

  // -----------------------------------------------------------------------
  // VCon 透明代理 — 监听 29001，vconsole2 会主动连过来
  // -----------------------------------------------------------------------

  const dotaPath = process.env.DOTA2_PATH || (await consoleBridge.detectDotaPath());
  const addonName = process.env.DOTA2_ADDON || "";
  const relay = new VConRelay();

  // 追踪 relay 状态供工具使用
  let currentAddon = addonName;
  let currentMaps: string[] = [];
  let currentAllMaps: string[] = [];

  relay.on("adon", (a: any) => {
    currentAddon = a.addonName || currentAddon;
    // relay 内部已扫描 maps，但我们也跟一份
    setTimeout(() => {
      currentMaps = (relay as any)._maps || [];
      currentAllMaps = (relay as any)._allMaps || [];
    }, 1000);
  });

  relay.start().catch((err) => {
    console.error("[relay] Failed:", err.message);
  });

  // 文件系统扫描 maps（relay 断连时的降级方案）
  function scanMapsFs(addon: string): string[] {
    try {
      const path = require("path");
      const dir = path.join(dotaPath || "", "content", "dota_addons", addon, "maps");
      return require("fs").readdirSync(dir, { withFileTypes: true })
        .filter((e: any) => e.isFile() && e.name.endsWith(".vmap"))
        .map((e: any) => e.name.replace(".vmap", ""));
    } catch { return []; }
  }

  // 结构化存 console 输出（含 verbosity 级别和 channel 来源）+ 文本缓冲（兼容旧代码）
  let prntLog: { text: string; verbosity: number; channel: string }[] = [];
  let prntBuffer: string[] = [];

  // 常见 VConsole2 通道的用途说明（协议本身不带描述，仅对名称含义明确的通道做补充）
  const channelDescriptions: Record<string, string> = {
    General: "通用引擎消息",
    Console: "控制台回显",
    Developer: "开发者消息",
    DeveloperConsole: "开发者控制台",
    DeveloperVerbose: "开发者详细消息",
    Assert: "断言失败信息",
    VScript: "服务器端 Lua / VScript 脚本输出",
    VScriptDbg: "VScript 调试输出",
    Panorama: "Panorama UI 框架",
    PanoramaScript: "Panorama UI JavaScript 输出",
    PanoramaContent: "Panorama 内容加载",
    PanoramaVideoPlayer: "Panorama 视频播放",
    V8System: "V8 JavaScript 引擎",
    Client: "客户端消息",
    Server: "服务端消息",
    ServerLog: "服务端日志",
    RenderSystem: "渲染系统",
    ResourceSystem: "资源加载系统",
    Filesystem: "文件系统",
    NetworkClientService: "网络客户端服务",
    NetworkServerService: "网络服务端服务",
    NetworkService: "网络服务",
    Steam: "Steam 集成",
    SteamNetSockets: "Steam 网络套接字",
    GCClient: "Game Coordinator 客户端",
    Workshop: "创意工坊",
    ModelDoc: "ModelDoc 模型编辑器",
    Hammer: "Hammer 关卡编辑器",
    Animgraph: "动画图编辑器",
    MaterialCompiler: "材质编译器",
    PanoramaCompiler: "Panorama 编译器",
    TextureCompiler: "纹理编译器",
    ImageCompiler: "图片编译器",
    JavaScriptCompiler: "JavaScript 编译器",
    MapBuilderSystem: "地图构建系统",
    InputService: "输入服务",
    InputSystem: "输入系统",
    Particles: "粒子系统",
    SoundSystem: "声音系统",
    SndEmitterSystem: "声音发射系统",
    SoundOperatorSystem: "声音运算器系统",
    Physics: "物理系统",
    MeshSystem: "网格系统",
    WorldRenderer: "世界渲染器",
    SceneSystem: "场景系统",
    SchemaSystem: "Schema 系统",
    EntitySystem: "实体系统",
    "Entity System": "实体系统",
    GameEventSystem: "游戏事件系统",
    "CL CommandQueue": "客户端命令队列",
    "SV CommandQueue": "服务端命令队列",
    VProf: "VProf 性能分析",
    DemoFile: "Demo 文件",
    Demo: "Demo 回放",
    Movie: "视频/电影",
    ScreenShot: "截图",
    SaveRestore: "存档/读档",
    WebApi: "Web API",
    BuildCubemaps: "构建立方体贴图",
    EntityDump: "实体导出",
    CustomNetTable: "自定义网络表",
    CustomGameCache: "自定义游戏缓存",
    CustomUI: "自定义 UI",
    DOTAHLTVDirector: "HLTV 导演",
    "Hltv Director": "HLTV 导演",
    AssetSystem: "资源系统 / AssetSystem 编辑器",
  };

  // 事件驱动：relay 收到 PRNT 时立即同步到本地缓冲
  relay.on("prnt", (msg: any) => {
    prntLog.push({ text: msg.text, verbosity: msg.verbosity, channel: msg.channel || "" });
    prntBuffer.push(msg.text);
    if (prntLog.length > 10000) {
      prntLog.shift();
      prntBuffer.shift();
    }
  });

  const bridgeConfig = { dotaPath: dotaPath || "", addonName };

  // Tool: 读取 console 输出（VCon 实时流，含 verbosity 级别和 channel 来源）
  server.tool("console_output",
    "Read Dota 2 console output with severity filtering. level: 0=all, 1=warnings+, 2=asserts+, 3=errors only.",
    {
      lines: z.number().optional().default(50),
      level: z.number().optional().default(0).describe("0=all, 1=warnings+, 3=errors only"),
      filter: z.string().optional().describe("Optional regex"),
      channel: z.string().optional().describe("Filter by source channel(s), e.g. VScript, PanoramaScript, ResourceSystem. Use comma to filter multiple channels like 'VScript, PanoramaScript'. Use console_channels to list available channels."),
    },
    async ({ lines, level, filter, channel }) => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      let output = prntLog;
      if (level > 0) output = output.filter(l => l.verbosity >= level);
      if (filter) { const re = new RegExp(filter, "i"); output = output.filter(l => re.test(l.text)); }
      if (channel) {
        const chs = channel.split(",").map(c => c.trim().toLowerCase()).filter(Boolean);
        output = output.filter(l => chs.includes(l.channel.toLowerCase()));
      }
      return { content: [{ type: "text", text: output.slice(-lines).map(l => `[${l.channel || "?"}][L${l.verbosity}] ${l.text}`).join("\n") || "(no output)" }] };
    }
  );

  // Tool: 列出当前可用的 VConsole2 通道
  server.tool("console_channels",
    "List all available VConsole2 source channels with short descriptions. Use the channel names with console_output channel filter.",
    {},
    async () => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      const channels = relay.getChannels();
      const lines = channels.map(name => {
        const desc = channelDescriptions[name];
        return desc ? `${name} - ${desc}` : name;
      });
      return { content: [{ type: "text", text: lines.join("\n") || "(no channels registered yet)" }] };
    }
  );

  // Tool: send console command via VCon
  server.tool("console_send",
    "Send console command to Dota 2 via VCon TCP",
    { commands: z.string().describe("Command(s), newline-separated") },
    async ({ commands }) => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected to Dota 2." }] };
      const cmds = commands.split("\n").map(c => c.trim()).filter(Boolean);
      cmds.forEach(c => relay.sendCommand(c));
      return { content: [{ type: "text", text: `Sent ${cmds.length} command(s)` }] };
    }
  );


  // Tool: 查询当前项目与游戏状态
  server.tool("project_info",
    "Check current addon, map, game state. Call FIRST before other tools.",
    {},
    async () => {
      const maps = currentMaps.length > 0 ? currentMaps : (currentAddon ? scanMapsFs(currentAddon) : []);
      const allMaps = currentAllMaps.length > 0 ? currentAllMaps : (currentAddon ? scanMapsFs(currentAddon) : []);

      if (!relay.dotaConnected) {
        return { content: [{ type: "text", text: JSON.stringify({
          addon: currentAddon || "(no project loaded)",
          maps,
          allMaps,
          connection: { dota: false, gui: false },
          hint: "Not connected to Dota 2. Start relay first.",
        }, null, 2) }] };
      }

      // 发送 status_json 命令获取运行时状态
      const status = await queryStatusJson(5000);
      const state = parseGameState(status);

      return { content: [{ type: "text", text: JSON.stringify({
        addon: currentAddon || "(detecting...)",
        maps,
        allMaps,
        running: {
          map: state.map,
          loaded: state.loaded,
          loading: state.loading,
          state: state.state,
          game_state: state.game_state,
          phase: state.phase,
          players: state.players,
          clients_bot: state.clients_bot,
          clients_proxies: state.clients_proxies,
          first_player: state.first_player,
          host: "",
          serverAddon: state.addon,
          hibernating: state.hibernating,
          cpu_usage: state.cpu_usage,
          udp_port: state.udp_port,
          network_lag_avg: state.network_lag_avg,
          build_version: state.build_version,
          process_uptime: state.process_uptime,
        },
        connection: { dota: relay.dotaConnected, gui: relay.guiConnected },
        hint: state.loading
          ? "Map is loading. Wait for it to finish."
          : !state.loaded
            ? "No map loaded. Use dota_launch_game."
            : `Game ${state.phase}. Use dota_restart to reload.`,
      }, null, 2) }] };
    }
  );

  // 记住上次启动参数
  let lastAddon = addonName;
  let lastMap = "";

  // Tool: 启动游戏
  server.tool("dota_launch_game",
    "Launch a Dota 2 custom game. Polls status and retries if the game does not start loading. Call project_info first to see available maps.",
    {
      map: z.string().optional().describe("Map name. Auto-detected if omitted."),
      addon: z.string().optional().describe("Addon name. Auto-detected if omitted."),
      timeout: z.number().optional().default(45).describe("Max seconds to wait for the map to finish loading."),
    },
    async ({ addon, map, timeout }) => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      const a = addon || currentAddon;
      const maps = currentMaps.length > 0 ? currentMaps : scanMapsFs(a);
      const m = map || maps[0];
      if (!a) return { content: [{ type: "text", text: "No addon detected. Load a project first." }] };
      if (!m) return { content: [{ type: "text", text: `No map specified and none found in addon '${a}'. Available: ${maps.length > 0 ? maps.join(", ") : "none"}` }] };
      lastAddon = a; lastMap = m;

      const cmd = `dota_launch_custom_game ${a} ${m}`;
      const timeoutMs = Math.max(10, timeout || 45) * 1000;

      // 如果已经加载了地图，直接返回
      const initialStatus = parseGameState(await queryStatusJson(5000));
      if (initialStatus.loaded) {
        return { content: [{ type: "text", text: `Already loaded: ${initialStatus.map}` }] };
      }
      if (initialStatus.loading) {
        return { content: [{ type: "text", text: "Map is currently loading. Wait for it to finish, or check console_output." }] };
      }

      // 发送启动命令，并按 status_json 轮询加载进度（不再重复发送启动命令）
      relay.sendCommand(cmd);
      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        await new Promise(r => setTimeout(r, 5000));
        const current = parseGameState(await queryStatusJson(5000));
        if (current.loaded) {
          return { content: [{ type: "text", text: `Launched and loaded: ${a}/${m} (map: ${current.map})` }] };
        }
        if (current.loading) {
          // 已经开始加载，继续等待
          continue;
        }
      }

      return { content: [{ type: "text", text: `Sent launch command for ${a}/${m}, but map did not load within ${Math.round(timeoutMs / 1000)}s. Check Dota 2 console for errors.` }] };
    }
  );

  // Tool: 断开
  server.tool("dota_disconnect",
    "Disconnect from current game.",
    {},
    async () => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      relay.sendCommand("disconnect");
      return { content: [{ type: "text", text: "Disconnected." }] };
    }
  );

  // Tool: 重启当前游戏
  server.tool("dota_restart",
    "Reload the current map. Uses Source 2 'restart' command.",
    {},
    async () => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      relay.sendCommand("restart");
      return { content: [{ type: "text", text: "Sent: restart (reloads current map)" }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 调试 & 状态检查工具
  // ═══════════════════════════════════════════════════════════════

  // Tool: 列出所有实体
  server.tool("dota_dump_entities",
    "List all entities currently in the game scene. Use this to inspect game state.",
    {},
    async () => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      const out = await collectOutput("dump_entity_report", { waitMs: 5000, settleMs: 300 });
      return { content: [{ type: "text", text: out.join("\n") || "Sent. Use console_output." }] };
    }
  );

  // Tool: 列出所有 modifier
  server.tool("dota_dump_modifiers",
    "Dump modifiers. side='server'→dota_modifier_dump (all on entities), side='client'→cl_dump_modifier_list (all types).",
    { side: z.enum(["server","client"]).optional().default("client").describe("server or client") },
    async ({ side }) => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      const cmd = side === "server" ? "dota_modifier_dump" : "cl_dump_modifier_list";
      const out = await queryConsole(cmd, 3000);
      return { content: [{ type: "text", text: out.join("\n") || "(no results)" }] };
    }
  );

  // Tool: 查看实体脚本作用域
  server.tool("dota_entity_inspect",
    "Inspect entity Lua scope. side='server'→ent_script_dump, side='client'→cl_ent_script_dump. Pass entity name/class/entindex.",
    { entity: z.string().describe("Entity identifier"), side: z.enum(["server","client"]).optional().default("client") },
    async ({ entity, side }) => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      const cmd = side === "server" ? "ent_script_dump" : "cl_ent_script_dump";
      const out = await queryConsole(`${cmd} ${entity}`, 3000);
      return { content: [{ type: "text", text: out.join("\n") || "(no data)" }] };
    }
  );

  // Tool: 监控游戏事件
  // ═══════════════════════════════════════════════════
  // API 文档工具 — 全部走控制台实时查询，用户已逐个验证
  // ═══════════════════════════════════════════════════

  async function queryConsole(cmd: string, waitMs = 3000, settleMs = 300): Promise<string[]> {
    return collectOutput(cmd, { waitMs, settleMs });
  }

  /** 从最近输出中提取最后一个完整的 status_json 对象 */
  function extractLastStatusJson(lines: string[]): Record<string, any> | null {
    const text = lines.join("\n");
    let depth = 0;
    let end = -1;
    for (let i = text.length - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === "}") {
        if (depth === 0) end = i;
        depth++;
      } else if (ch === "{") {
        depth--;
        if (depth === 0 && end !== -1) {
          try {
            const json = JSON.parse(text.slice(i, end + 1));
            if (json && typeof json === "object" && "server" in json) {
              return json;
            }
          } catch { /* ignore */ }
          end = -1;
        }
      }
    }
    return null;
  }

  async function queryStatusJson(waitMs = 5000): Promise<Record<string, any> | null> {
    const collected: string[] = [];

    return new Promise((resolve) => {
      let settled = false;

      const onPrnt = (msg: any) => {
        collected.push(msg.text);
      };

      const finish = () => {
        relay.off("prnt", onPrnt);
        const lines = prntLog.slice(-collected.length).map(l => l.text);
        const result = extractLastStatusJson(collected.length > 0 ? collected : lines);
        resolve(result);
      };

      relay.on("prnt", onPrnt);
      relay.sendCommand("status_json");

      let lastLen = 0;
      let lastChangeTime = Date.now();

      const settleCheck = () => {
        if (collected.length > lastLen) {
          lastLen = collected.length;
          lastChangeTime = Date.now();
        }
        const elapsed = Date.now() - lastChangeTime;
        const gotSome = collected.length > 0;
        if (gotSome && elapsed > 150) {
          if (!settled) {
            settled = true;
            finish();
          }
          return;
        }
        setTimeout(settleCheck, 50);
      };

      setTimeout(() => {
        if (!settled) {
          settled = true;
          finish();
        }
      }, waitMs);

      setTimeout(settleCheck, 50);
    });
  }

  /** 直接监听 PRNT 事件收集命令输出（避免 prntLog 滚动导致 slice 失效）
   * 支持 settleMs：收到第一批输出后，若 settleMs 毫秒内无新输出则提前返回。 */
  async function collectOutput(cmd: string, opts: { waitMs?: number; settleMs?: number } = {}): Promise<string[]> {
    const { waitMs = 3000, settleMs } = opts;
    const collected: string[] = [];
    const onPrnt = (msg: any) => collected.push(msg.text);
    relay.on("prnt", onPrnt);
    relay.sendCommand(cmd);

    return new Promise((resolve) => {
      let lastLen = 0;
      let lastChangeTime = Date.now();
      let settled = false;

      const finish = () => {
        relay.off("prnt", onPrnt);
        resolve(collected);
      };

      const check = () => {
        if (collected.length > lastLen) {
          lastLen = collected.length;
          lastChangeTime = Date.now();
        }
        const elapsed = Date.now() - lastChangeTime;
        const gotSome = collected.length > 0;
        if (settleMs && gotSome && elapsed > settleMs) {
          if (!settled) {
            settled = true;
            finish();
          }
          return;
        }
        setTimeout(check, 50);
      };

      setTimeout(() => {
        if (!settled) {
          settled = true;
          finish();
        }
      }, waitMs);

      setTimeout(check, 50);
    });
  }

  /** 解析 status_json 返回当前游戏状态 */
  function parseGameState(status: Record<string, any> | null): {
    map: string;
    loaded: boolean;
    loading: boolean;
    state: string;
    game_state: string;
    phase: string;
    players: number;
    addon: string;
    hibernating: boolean;
    cpu_usage: number;
    clients_bot: number;
    clients_proxies: number;
    udp_port: number;
    build_version: number;
    process_uptime: number;
    network_lag_avg: number;
    first_player: string;
  } {
    const server = status?.server;
    if (!server) {
      return {
        map: "(unknown)", loaded: false, loading: false,
        state: "(unknown)", game_state: "(unknown)", phase: "unknown",
        players: 0, addon: "",
        hibernating: false, cpu_usage: 0, clients_bot: 0, clients_proxies: 0,
        udp_port: 0, build_version: 0, process_uptime: 0, network_lag_avg: 0,
        first_player: "",
      };
    }
    const keys = Object.keys(server);
    const hasMap = keys.includes("map");
    const map = hasMap ? (server.map as string) : "";
    const isLoading = !hasMap && keys.includes("startup_ServerModuleInit");
    const isLoaded = hasMap && map !== "<empty>";
    const state = (server.game_state as string) || "";
    const phase = isLoading ? "loading"
                : isLoaded ? (state.includes("GAME_IN_PROGRESS") ? "playing" : state.includes("INIT") ? "init" : state.includes("SETUP") ? "setup" : state.includes("POST_GAME") ? "ended" : "in_game")
                : hasMap ? "menu"
                : "unknown";
    const clients = Array.isArray(server.clients) ? server.clients as Array<{ name?: string; bot?: boolean }> : [];
    const firstPlayer = clients.find(c => !c.bot)?.name || "";
    return {
      map: map || "(not loaded)",
      loaded: isLoaded,
      loading: isLoading,
      state: state || "(unknown)",
      game_state: state || "(unknown)",
      phase,
      players: (server.clients_human as number) ?? 0,
      addon: (server.addon as string) || "",
      hibernating: !!server.hibernating,
      cpu_usage: (server.cpu_usage as number) ?? 0,
      clients_bot: (server.clients_bot as number) ?? 0,
      clients_proxies: (server.clients_proxies as number) ?? 0,
      udp_port: (server.udp_port as number) ?? 0,
      build_version: (status?.build_version as number) ?? 0,
      process_uptime: (status?.process_uptime as number) ?? 0,
      network_lag_avg: (server.player_network_lag_avg as number) ?? 0,
      first_player: firstPlayer,
    };
  }

  // --- API 文档 ---

  // Tool: Lua API（服务端 + 客户端）
  server.tool("dota_api_lua",
    "Query Lua API. side='server'→script_help2 (full stub format, needs game), side='client'→cl_script_help2 (always available).",
    { func: z.string().optional().describe("Function/class name. Empty=full dump."), side: z.enum(["server","client"]).optional().default("server").describe("server or client") },
    async ({ func, side }) => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      const cmd = side === "client" ? "cl_script_help2" : "script_help2";
      const out = await queryConsole(func ? `${cmd} ${func}` : cmd, 3000);
      return { content: [{ type: "text", text: out.join("\n") || "(no results)" }] };
    }
  );

  // Tool: Panorama JS API
  server.tool("dota_api_panorama_js",
    "Query Panorama JS API (cl_panorama_script_help_2). Enums and classes for UI scripts. Client-side only.",
    { name: z.string().optional().describe("Enum/class name. Empty=full list.") },
    async ({ name }) => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      const out = await queryConsole(name ? `cl_panorama_script_help_2 ${name}` : "cl_panorama_script_help_2", 3000);
      return { content: [{ type: "text", text: out.join("\n") || "(no results)" }] };
    }
  );

  // Tool: Panorama CSS 属性
  server.tool("dota_api_css",
    "Query Panorama CSS properties (dump_panorama_css_properties). Full descriptions + examples. Client-side only.",
    { prop: z.string().optional().describe("CSS property name, e.g. 'wash-color'. Empty=all 128.") },
    async ({ prop }) => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      const out = await queryConsole(prop ? `dump_panorama_css_properties ${prop}` : "dump_panorama_css_properties", 3000);
      return { content: [{ type: "text", text: out.join("\n") || "(no results)" }] };
    }
  );

  // Tool: Panorama Panel 事件
  server.tool("dota_api_events",
    "Query Panorama Panel events (dump_panorama_events). All event handlers with signatures. Client-side only.",
    { event: z.string().optional().describe("Event name, e.g. 'SetPanelSelected'. Empty=all events.") },
    async ({ event }) => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      const out = await queryConsole(event ? `dump_panorama_events ${event}` : "dump_panorama_events", 3000);
      return { content: [{ type: "text", text: out.join("\n") || "(no results)" }] };
    }
  );

  // --- 调试工具（服务端 + 客户端） ---

  // Tool: 搜索所有 5248 个 console 指令/cvar
  server.tool("console_find",
    "🔍 UNIVERSAL DISCOVERY: Search all 5248 Dota 2 console commands/convars.\n" +
    "This is THE most powerful tool — use it to discover ANY command you need.\n" +
    "Key search prefixes: 'dota_' (game commands), 'script_' (Lua hot reload), 'sv_' (server), 'cl_' (client)\n" +
    "Example queries: 'restart', 'dota_create', 'script_reload', 'host_timescale', 'dota_dev', 'dota_bot', 'dota_hero'\n" +
    "Run found commands without arguments to see usage, or use console_help.",
    { query: z.string().describe("Search keyword") },
    async ({ query }) => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      const out = await queryConsole(`find ${query}`, 3000, 250);
      // Dota `find` output: header + separator + rows. Drop header/separator, keep rows that mention the query.
      const results = out.filter(l =>
        l.includes(query) && /^\S+/.test(l) && !/^=+$/.test(l.trim()) && !/^name\s+value/.test(l)
      );
      if (results.length === 0) return { content: [{ type: "text", text: `No match. Try different keyword or shorter prefix.` }] };
      return {
        content: [{
          type: "text",
          text: `${results.length} results:\n\n${results.slice(0, 50).join("\n")}${results.length > 50 ? `\n... +${results.length - 50} more (narrow search with longer keyword)` : ""}`,
        }],
      };
    }
  );

  // Tool: 查看命令用途
  server.tool("console_help",
    "Show what a Dota 2 console command does and its current value.",
    { command: z.string().describe("Command name") },
    async ({ command }) => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      const out = await queryConsole(`help ${command}`, 3000, 250);
      // help 命令常先 dump 一批枚举，再给出目标命令行；过滤出真正相关的行
      const relevant = out.filter(l => l.toLowerCase().includes(command.toLowerCase()));
      const text = relevant.length > 0 ? relevant.join("\n") : out.join("\n");
      return { content: [{ type: "text", text: text || "(no help available)" }] };
    }
  );

  // Tool: 开关 vconsole2 GUI 输出过滤
  // 默认过滤掉 status_json / API dump 等大块 JSON 输出，避免人类开发者的 vconsole2 GUI 被刷屏；
  // MCP 本身仍可通过 console_output / queryStatusJson 读取完整输出。
  const DEFAULT_GUI_SUPPRESS_PATTERNS = [
    "^\\s*\\{",       // JSON 对象开始
    "^\\s*\\}",       // JSON 对象结束
    "^\\s*\\[",       // JSON 数组开始
    "^\\s*\\]",       // JSON 数组结束
    "^\\s*\"[^\"]+\":", // JSON 键值行
  ];
  server.tool("console_gui_filter",
    "Control whether MCP-generated console output is forwarded to the vconsole2 GUI. Default: MCP command output is wrapped with markers and hidden from GUI. Call with auto:false to show all MCP output in GUI.",
    {
      enabled: z.boolean().optional().describe("Manual override: true = always suppress lines matching given/custom patterns, false = clear manual patterns."),
      auto: z.boolean().optional().describe("MCP marker suppress: true = hide all output from MCP-sent commands (default). false = show MCP output in GUI."),
      patterns: z.array(z.string()).optional().describe("Optional custom regex patterns for manual mode. If omitted, default JSON-like patterns are used."),
    },
    async ({ enabled, auto, patterns }) => {
      // 处理 manual 模式
      if (typeof enabled === "boolean") {
        const newPatterns = enabled ? (patterns ?? DEFAULT_GUI_SUPPRESS_PATTERNS) : [];
        relay.setGuiSuppressPatterns(newPatterns);
      }
      // 处理 MCP 屏蔽开关
      if (typeof auto === "boolean") {
        relay.setMcpSuppressEnabled(auto);
      }
      return { content: [{ type: "text", text: JSON.stringify({
        manualEnabled: relay.guiSuppressPatterns.length > 0,
        manualPatterns: relay.guiSuppressPatterns,
        mcpSuppressEnabled: relay.mcpSuppressEnabled,
        note: "MCP console_output still receives all output; only vconsole2 GUI forwarding is affected.",
      }, null, 2) }] };
    }
  );

  // Tool: 查询官方 Lua API 文档
  server.tool("dota_api_help",
    "Query Dota 2 official Lua API docs via 'script_help'. Pass function name like 'CreateUnitByName' or 'CDOTA_BaseNPC'.",
    { query: z.string().optional().describe("Function or class name. Empty = list all registered API functions.") },
    async ({ query }) => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      const out = await queryConsole(query ? `script_help ${query}` : "script_help", 4000, 300);
      return { content: [{ type: "text", text: out.join("\n") || "Sent. Use console_output to see results." }] };
    }
  );

  // Tool: 在运行中的游戏里执行 Lua 代码
  server.tool("dota_run_lua",
    "Execute server-side Lua in the running game via ent_fire 0 RunScriptCode. Use 'code' for arbitrary statements or 'expression' to evaluate and DeepPrintTable a value.",
    {
      code: z.string().optional().describe("Arbitrary Lua statements to run. Use single quotes inside to avoid shell escaping issues."),
      expression: z.string().optional().describe("Lua expression to evaluate; its result will be DeepPrintTable'd automatically (e.g. 'PlayerResource:GetAllTeamPlayerIDs()')."),
    },
    async ({ code, expression }) => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };

      let luaBody: string;
      if (expression) {
        luaBody = `print('[MCP-LUA] IsServer: ' .. tostring(IsServer())) DeepPrintTable((${expression}))`;
      } else if (code) {
        luaBody = `print('[MCP-LUA] IsServer: ' .. tostring(IsServer())) ${code}`;
      } else {
        return { content: [{ type: "text", text: "Provide either 'code' or 'expression'." }] };
      }

      // 简单转义：把双引号换成单引号，避免 RunScriptCode 参数字符串冲突
      const safeCode = luaBody.replace(/"/g, "'");

      // 使用 collectOutput 直接监听 PRNT，避免 prntLog 滚动和 queryConsole 提前返回导致丢失 VScript 输出
      const execOut = await collectOutput(`ent_fire 0 RunScriptCode "${safeCode}"`, { waitMs: 15000, settleMs: 400 });

      const markerIdx = execOut.findIndex(l => l.includes("[MCP-LUA] IsServer"));
      if (markerIdx === -1) {
        const fallback = execOut.filter(l =>
          l.includes("[MCP-LUA]") || l.includes("DeepPrint") || l.includes("RunScriptCode") || /^\s*\d+\s*=/.test(l) || /error/i.test(l)
        );
        return { content: [{ type: "text", text: fallback.join("\n") || "Sent. Check console_output for results." }] };
      }

      // expression 模式：捕获 DeepPrintTable 输出的 { ... } 块
      if (expression) {
        const blockStart = execOut.findIndex((l, i) => i > markerIdx && l.trim() === "{");
        if (blockStart !== -1) {
          let depth = 0;
          for (let i = blockStart; i < execOut.length; i++) {
            for (const ch of execOut[i]) {
              if (ch === "{") depth++;
              else if (ch === "}") depth--;
            }
            if (depth === 0) {
              const result = execOut.slice(markerIdx, i + 1).join("\n");
              return { content: [{ type: "text", text: result }] };
            }
          }
        }
      }

      // code 模式：捕获 marker 之后的用户输出，直到遇到已知的无关系统输出
      const unrelatedPatterns = [
        /^\[Lua Memory\]/,
        /^\[Hashtable Count\]/,
        /^\[Thinker Count\]/,
        /^\[Client Lua Memory\]/,
        /^\[Client FPS\]/,
        /^iStatusCode=/,
        /^0\t200\t/,
      ];
      const block: string[] = [];
      for (let i = markerIdx; i < execOut.length; i++) {
        const l = execOut[i];
        if (unrelatedPatterns.some(re => re.test(l))) break;
        block.push(l);
      }
      return { content: [{ type: "text", text: block.join("\n") }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // Workshop Tools 集成 — 启动编辑器 / 编译资源
  // ═══════════════════════════════════════════════════════════════

  /** 根据平台返回 Dota 2 工具二进制目录 */
  function getDotaBinDir(dotaRoot: string): string {
    const platform = process.platform;
    const archDir =
      platform === "win32" ? "win64" :
      platform === "linux" ? "linuxsteamrt64" :
      platform === "darwin" ? "osx64" :
      "win64";
    return path.join(dotaRoot, "game", "bin", archDir);
  }

  /** 根据平台追加 .exe 后缀 */
  function getDotaExeName(baseName: string): string {
    return process.platform === "win32" ? `${baseName}.exe` : baseName;
  }

  /** 执行 Dota 2 工具目录下的可执行文件 */
  function runDotaTool(exeBase: string, args: string[], waitForExit = false): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    const exePath = path.join(getDotaBinDir(dotaPath || ""), getDotaExeName(exeBase));
    return new Promise((resolve) => {
      const proc = spawn(exePath, args, {
        detached: !waitForExit,
        windowsHide: false,
      });
      let stdout = "";
      let stderr = "";
      proc.stdout?.on("data", (d) => { stdout += d.toString(); });
      proc.stderr?.on("data", (d) => { stderr += d.toString(); });
      proc.on("error", (e) => resolve({ ok: false, stdout, stderr: e.message }));
      if (waitForExit) {
        proc.on("close", (code) => resolve({ ok: code === 0, stdout, stderr }));
      } else {
        // 对于 GUI 编辑器，启动后立即返回 PID
        resolve({ ok: true, stdout: `started pid=${proc.pid}`, stderr });
      }
    });
  }

  /** 把用户传入的资源路径解析为完整路径
   *  - 绝对路径：原样返回
   *  - 以 content/ 或 game/ 开头：相对于 dotaPath
   *  - 否则：默认 content/dota_addons/{addon}/...
   */
  function resolveAssetPath(target: string, addon: string): string {
    if (path.isAbsolute(target)) return target;
    const lower = target.toLowerCase().replace(/\\/g, "/");
    if (lower.startsWith("content/") || lower.startsWith("game/")) {
      return path.join(dotaPath || "", target);
    }
    return path.join(dotaPath || "", "content", "dota_addons", addon, target);
  }

  // Tool: 编译 Source 2 资源
  server.tool("dota_compile_asset",
    "Compile Source 2 assets using resourcecompiler. Target can be absolute, relative to addon content, or start with content/ / game/.",
    {
      target: z.string().describe("File, folder, or VPK path to compile"),
      recursive: z.boolean().optional().default(false).describe("Recursively scan subdirectories"),
      force: z.boolean().optional().default(false).describe("Force recompile even if up-to-date"),
      decompile: z.boolean().optional().default(false).describe("Use VRF decompile mode (Source2Viewer-CLI) instead of resourcecompiler"),
    },
    async ({ target, recursive, force, decompile }) => {
      const addon = currentAddon || addonName;
      if (!addon) return { content: [{ type: "text", text: "No addon detected. Set DOTA2_ADDON or load a project first." }] };

      const resolved = resolveAssetPath(target, addon);

      if (decompile) {
        const result = await runDotaTool("Source2Viewer-CLI", [
          "-i", resolved,
          ...(recursive ? ["-r"] : []),
          "-d",
        ], true);
        return { content: [{ type: "text", text: result.ok
          ? `Decompiled ${resolved}\n${result.stdout.slice(0, 2000)}`
          : `Decompile failed: ${result.stderr}`
        }] };
      }

      const gameInfo = path.join(dotaPath || "", "game", "dota");
      const args = ["-i", resolved, "-game", gameInfo];
      if (recursive) args.push("-r");
      if (force) args.push("-f");
      const result = await runDotaTool("resourcecompiler", args, true);
      return { content: [{ type: "text", text: result.ok
        ? `Compiled ${resolved}\n${result.stdout.slice(0, 2000)}`
        : `Compile failed: ${result.stderr}`
      }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("dota2-mcp ready");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

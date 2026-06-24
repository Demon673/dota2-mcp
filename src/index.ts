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
    version: "0.1.0",
  });

  // -----------------------------------------------------------------------
  // VCon 透明代理 — 监听 29001，vconsole2 会主动连过来
  // -----------------------------------------------------------------------

  const dotaPath = process.env.DOTA2_PATH || consoleBridge.detectDotaPath();
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

  // 事件驱动：relay 收到 PRNT 时立即同步到本地缓冲
  relay.on("prnt", (msg: any) => {
    prntLog.push({ text: msg.text, verbosity: msg.verbosity, channel: msg.channel || "" });
    prntBuffer.push(msg.text);
    if (prntLog.length > 500) {
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
      channel: z.string().optional().describe("Filter by source channel, e.g. VScript, PanoramaScript, ResourceSystem. Use console_channels to list available channels."),
    },
    async ({ lines, level, filter, channel }) => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      let output = prntLog;
      if (level > 0) output = output.filter(l => l.verbosity >= level);
      if (filter) { const re = new RegExp(filter, "i"); output = output.filter(l => re.test(l.text)); }
      if (channel) { output = output.filter(l => l.channel.toLowerCase() === channel.toLowerCase()); }
      return { content: [{ type: "text", text: output.slice(-lines).map(l => `[${l.channel || "?"}][L${l.verbosity}] ${l.text}`).join("\n") || "(no output)" }] };
    }
  );

  // Tool: 列出当前可用的 VConsole2 通道
  server.tool("console_channels",
    "List all available VConsole2 source channels (e.g. General, VScript, PanoramaScript). Use these names with console_output channel filter.",
    {},
    async () => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      const channels = relay.getChannels();
      return { content: [{ type: "text", text: channels.join("\n") || "(no channels registered yet)" }] };
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

      // 发送 status 命令获取运行时状态
      const out = await queryConsole("status", 3000);
      const text = out.join("\n");

      // 动态解析（基于真实 status 输出格式）
      const mapMatch = text.match(/loaded spawngroup\(\s*\d+\s*\)\s*:.*?\[.*?:\s*(\S+)\s*\|/);
      const isMapLoaded = mapMatch && mapMatch[1] !== "<empty>" && mapMatch[1] !== "<none>";
      const stateMatch = text.match(/GameState:\s*DOTA_GAMERULES_STATE_(\w+)/);
      const playersMatch = text.match(/players\s*:\s*(\d+)\s*humans?/);
      const hostMatch = text.match(/hostname\s*:\s*(\S+)/);
      const spawngroupsMatch = text.match(/loaded spawngroup/g);
      const prefabsMatch = text.match(/maps\/prefabs\//g);

      const state = stateMatch?.[1] || "";
      const phase = state.includes("GAME_IN_PROGRESS") ? "playing"
                  : state.includes("CUSTOM_GAME_SETUP") ? "setup"
                  : state.includes("INIT") ? "init"
                  : state.includes("POST_GAME") ? "ended"
                  : state || "unknown";

      return { content: [{ type: "text", text: JSON.stringify({
        addon: currentAddon || "(detecting...)",
        maps,
        allMaps,
        running: {
          map: mapMatch?.[1] || "(not loaded)",
          loaded: !!isMapLoaded,
          state: state || "(unknown)",
          phase,
          players: playersMatch ? parseInt(playersMatch[1]) : 0,
          host: hostMatch?.[1] || "",
          spawngroups: spawngroupsMatch?.length || 0,
          prefabs: prefabsMatch?.length || 0,
        },
        connection: { dota: relay.dotaConnected, gui: relay.guiConnected },
        hint: !isMapLoaded
          ? "No map loaded. Use dota_launch_game."
          : `Game ${phase}. Use dota_restart to reload.`,
      }, null, 2) }] };
    }
  );

  // 记住上次启动参数
  let lastAddon = addonName;
  let lastMap = "";

  // Tool: 启动游戏
  server.tool("dota_launch_game",
    "Launch a Dota 2 custom game. Call project_info first to see available maps.",
    {
      map: z.string().optional().describe("Map name. Auto-detected if omitted."),
      addon: z.string().optional().describe("Addon name. Auto-detected if omitted."),
    },
    async ({ addon, map }) => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      const a = addon || currentAddon;
      const maps = currentMaps.length > 0 ? currentMaps : scanMapsFs(a);
      const m = map || maps[0];
      if (!a) return { content: [{ type: "text", text: "No addon detected. Load a project first." }] };
      if (!m) return { content: [{ type: "text", text: `No map specified and none found in addon '${a}'. Available: ${maps.length > 0 ? maps.join(", ") : "none"}` }] };
      lastAddon = a; lastMap = m;
      relay.sendCommand(`dota_launch_custom_game ${a} ${m}`);
      return { content: [{ type: "text", text: `Launched: ${a}/${m}` }] };
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
      const before = prntBuffer.length;
      relay.sendCommand("dump_entity_report");
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 200));
        if (prntBuffer.length > before + 3) break;
      }
      return { content: [{ type: "text", text: prntBuffer.slice(before).join("\n") || "Sent. Use console_output." }] };
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

  async function queryConsole(cmd: string, waitMs = 2000): Promise<string[]> {
    const before = prntLog.length;
    relay.sendCommand(cmd);

    return new Promise((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        cleanup();
        resolve(prntLog.slice(before).map(l => l.text));
      }, waitMs);

      const onPrnt = () => {
        if (prntLog.length > before + 2) {
          cleanup();
          // 稍等片刻让后续同一批输出也到达
          setTimeout(() => {
            if (!settled) {
              settled = true;
              resolve(prntLog.slice(before).map(l => l.text));
            }
          }, 150);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        relay.off("prnt", onPrnt);
      };

      relay.on("prnt", onPrnt);
    });
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
      const before = prntBuffer.length;
      relay.sendCommand(`find ${query}`);
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 200));
        if (prntBuffer.length > before + 1) break;
      }
      const results = prntBuffer.slice(before).filter(l =>
        /\S+\s+\S+\s+(cmd|game|client|cheat|server|archive)/.test(l)
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
      const out = await queryConsole(`help ${command}`, 2000);
      return { content: [{ type: "text", text: out.join("\n") || "(no help available)" }] };
    }
  );

  // Tool: 查询官方 Lua API 文档
  server.tool("dota_api_help",
    "Query Dota 2 official Lua API docs via 'script_help'. Pass function name like 'CreateUnitByName' or 'CDOTA_BaseNPC'.",
    { query: z.string().optional().describe("Function or class name. Empty = list all registered API functions.") },
    async ({ query }) => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };
      const before = prntBuffer.length;
      relay.sendCommand(query ? `script_help ${query}` : "script_help");
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 200));
        if (prntBuffer.length > before + 3) break;
      }
      return { content: [{ type: "text", text: prntBuffer.slice(before).join("\n") || "Sent. Use console_output to see results." }] };
    }
  );

  // Tool: 在运行中的游戏里执行 Lua 代码
  server.tool("dota_run_lua",
    "Execute arbitrary server-side Lua code in the running game via ent_fire 0 RunScriptCode. Verifies IsServer() to confirm server-side execution.",
    { code: z.string().describe("Lua code to run. Use single quotes inside to avoid shell escaping issues.") },
    async ({ code }) => {
      if (!relay.dotaConnected) return { content: [{ type: "text", text: "Not connected." }] };

      // 包装用户代码，先打印 IsServer() 验证运行端
      const wrapped = `print('[MCP-LUA] IsServer: ' .. tostring(IsServer())) ${code}`;
      // 简单转义：把双引号换成单引号，避免 RunScriptCode 参数字符串冲突
      const safeCode = wrapped.replace(/"/g, "'");

      const execOut = await queryConsole(`ent_fire 0 RunScriptCode "${safeCode}"`, 3000);

      const filtered = execOut.filter(l =>
        l.includes("[MCP-LUA]") || l.includes("RunScriptCode") || l.includes("error")
      );

      return { content: [{ type: "text", text: filtered.join("\n") || "Sent. Check console_output for results." }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // Workshop Tools 集成 — 启动编辑器 / 编译资源
  // ═══════════════════════════════════════════════════════════════

  const dotaExeDir = path.join(dotaPath || "", "game", "bin", "win64");

  /** 执行 Dota 2 win64 目录下的工具 exe */
  function runDotaTool(exeName: string, args: string[], waitForExit = false): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    const exePath = path.join(dotaExeDir, exeName);
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
    "Compile Source 2 assets using resourcecompiler.exe. Target can be absolute, relative to addon content, or start with content/ / game/.",
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
        const result = await runDotaTool("Source2Viewer-CLI.exe", [
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
      const result = await runDotaTool("resourcecompiler.exe", args, true);
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

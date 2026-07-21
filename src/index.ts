#!/usr/bin/env node
/**
 * dota2-mcp — MCP server for DOTA2 custom game development.
 *
 * 瘦客户端入口：注册全部 MCP 工具，经 createRelay() 接入 relay 守护进程
 * （失败时退化为本地 VConRelay）。控制台类工具遵守 vconsole 契约：
 * Dota 已连接且 vconsole 已接入 29001 才可用（见 requireConsole）。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import { VConRelay } from "./tools/vcon-relay.js";
import { RelayClient } from "./relay-client.js";
import * as consoleBridge from "./tools/console-bridge.js";
import * as daemon from "./daemon-utils.js";

function getVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    return require("../package.json").version;
  } catch {
    return "1.3.2";
  }
}

// Stdio MCP 服务器必须保证 stdout 只输出 JSON-RPC，任何 console.log/info 都重定向到 stderr
console.log = (...args: any[]) => console.error(...args);
console.info = (...args: any[]) => console.error(...args);

// 防止未捕获异常/未处理 Promise 破坏 stdio 流
process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection:", reason);
});

async function main(): Promise<void> {
  const server = new McpServer({
    name: "dota2-mcp",
    version: getVersion(),
  }, {
    capabilities: {
      tools: { listChanged: false },
      logging: {},
    },
  });

  // -----------------------------------------------------------------------
  // Relay 接入：优先连已有守护进程，否则本地启动
  // -----------------------------------------------------------------------

  /** 统一接口：VConRelay（本地）或 RelayClient（瘦客户端） */
  type RelayLike = VConRelay | RelayClient;

  async function createRelay(dotaPath: string | null): Promise<RelayLike> {
    const CTRL_PORT = parseInt(process.env.DOTA2_VCON_CTRL_PORT || "29002", 10);

    // 1) 已有守护进程在跑 → 瘦客户端接入
    if (await daemon.probeRelay()) {
      const token = daemon.readToken();
      const client = new RelayClient({ port: CTRL_PORT, token });
      try {
        await client.connect();
        console.error("[relay] connected to existing daemon (thin client mode)");
        return client;
      } catch (e: any) {
        console.error("[relay] daemon handshake failed:", e.message);
        client.destroy();
        // 握手失败（token 不对/协议不兼容）→ 走下方重新拉起 daemon
      }
    }

    // 2) 没有可用 daemon → 抢锁，抢到的人 spawn detached daemon，
    //    自己也以瘦客户端身份接入。这样 relay 生命周期独立于任何 MCP 会话。
    const require = createRequire(import.meta.url);
    const relayMainPath = require.resolve("./relay-main.js");
    if (daemon.acquireLock()) {
      try {
        const pid = daemon.spawnRelayDaemon(relayMainPath);
        console.error(`[relay] spawned daemon pid=${pid}`);
        // 30s：守护进程冷启动 = node 冷启动 + detectDotaPath（注册表/Steam 库扫描），
        // Windows 上叠加 Defender 实时扫描可能远超 10s，超时太短会误入本地降级
        if (await daemon.waitForRelay(30000)) {
          const token = daemon.readToken();
          const client = new RelayClient({ port: CTRL_PORT, token });
          try {
            await client.connect();
            console.error("[relay] connected to spawned daemon (thin client mode)");
            return client;
          } catch (e: any) {
            // 守护进程秒崩/握手被拒：不能让异常逃出 createRelay（respawn 路径会让
            // 会话永久卡死在被 destroy 的旧客户端上）。销毁泄漏的 client、杀掉刚
            // spawn 的守护进程，走下方本地降级
            console.error("[relay] spawned daemon handshake failed:", e.message);
            client.destroy();
            try { process.kill(pid); } catch { /* ignore */ }
          }
        }
        console.error("[relay] daemon did not become ready in 30s");
        // 超时放弃前杀掉自己 spawn 的慢守护进程，否则它启动完成后会去绑
        // 同一批端口，与下方降级的本地 relay 并存成僵尸双绑状态
        try { process.kill(pid); } catch { /* ignore */ }
      } finally {
        daemon.releaseLock();
      }
    } else {
      // 别人正在 spawn，等它就绪
      console.error("[relay] another instance is spawning daemon, waiting...");
      if (await daemon.waitForRelay(30000)) {
        const token = daemon.readToken();
        const client = new RelayClient({ port: CTRL_PORT, token });
        try {
          await client.connect();
          console.error("[relay] connected to daemon spawned by peer (thin client mode)");
          return client;
        } catch (e: any) {
          console.error("[relay] peer daemon handshake failed:", e.message);
          client.destroy();
        }
      }
    }

    // 3) daemon 方案全部失败 → 退化到本地 VConRelay（单实例旧行为），
    //    保证工具至少可用，同时明确报错。
    console.error("[relay] daemon unavailable, falling back to local relay (single-instance mode)");
    const relay = new VConRelay();
    relay.setDotaPath(dotaPath);
    await relay.start();
    if (relay.portInUse) {
      console.error(`[relay] Ports 29001/29002 in use by another dota2-mcp instance. Tools will report unavailable.`);
    }
    return relay;
  }

  const dotaPath = await consoleBridge.detectDotaPath();

  // 追踪 relay 状态供工具使用
  let currentAddon = "";
  let currentMaps: string[] = [];
  let currentAllMaps: string[] = [];

  // 结构化存 console 输出（含 verbosity 级别和 channel 来源）+ 文本缓冲（兼容旧代码）
  let prntLog: { text: string; verbosity: number; channel: string }[] = [];
  let prntBuffer: string[] = [];

  /** 当前接入的 relay（瘦客户端或本地）。守护进程被杀时由 respawnRelay 整体替换 */
  let relay: RelayLike;

  /** 把 relay 接进工具层：同步初始 addon/maps + 挂事件。初始接入与会话内重拉共用 */
  function attachRelay(r: RelayLike): void {
    relay = r;
    // 从 relay 读初始 addon/maps（瘦客户端连上已运行的 daemon 时 ADON 帧早已收过；
    // 本地 relay 启动即主动连 Dota，ADON 也可能在 handler 挂载前到达。
    // 两种情况 adon 事件都不会再发，必须从当前状态读，否则 currentAddon 永远 "(detecting...)"）
    if (r instanceof RelayClient) {
      currentAddon = r.addonName || "";
      currentMaps = r.maps || [];
      currentAllMaps = r.allMaps || [];
    } else {
      currentAddon = (r as any)._addonName || "";
      currentMaps = (r as any)._maps || [];
      currentAllMaps = (r as any)._allMaps || [];
    }

    r.on("adon", (a: any) => {
      currentAddon = a.addonName || currentAddon;
      // 本地 relay：跟一份私有字段扫描结果；瘦客户端：用广播里带的 maps
      if (r instanceof RelayClient) {
        currentMaps = r.maps || [];
        currentAllMaps = r.allMaps || [];
      } else {
        setTimeout(() => {
          currentMaps = (r as any)._maps || [];
          currentAllMaps = (r as any)._allMaps || [];
        }, 1000);
      }
    });
    // 事件驱动：relay 收到 PRNT 时立即同步到本地缓冲
    r.on("prnt", (msg: any) => {
      prntLog.push({ text: msg.text, verbosity: msg.verbosity, channel: msg.channel || "" });
      prntBuffer.push(msg.text);
      if (prntLog.length > 10000) {
        prntLog.shift();
        prntBuffer.shift();
      }
    });
    r.on("close", onRelayClose);
  }

  // 守护进程进程被杀时：瘦客户端每次失败的重连尝试都会 emit "close"。
  // 连续约 5 次（≈5s）连不上说明守护进程不是重启而是没了 → 重新走 createRelay 拉起。
  let relayCloseCount = 0;
  let lastRelayCloseAt = 0;
  let respawning = false;

  function onRelayClose(): void {
    if (!(relay instanceof RelayClient) || respawning) return;
    const now = Date.now();
    if (now - lastRelayCloseAt > 15000) relayCloseCount = 0; // 只统计连续失败
    lastRelayCloseAt = now;
    if (++relayCloseCount < 5) return;
    relayCloseCount = 0;
    void respawnRelay();
  }

  async function respawnRelay(): Promise<void> {
    if (respawning) return;
    respawning = true;
    try {
      console.error("[relay] daemon unreachable, respawning...");
      try { (relay as RelayClient).destroy(); } catch { /* ignore */ }
      attachRelay(await createRelay(dotaPath));
    } catch (e: any) {
      console.error(`[relay] respawn failed: ${e.message}, retrying in 5s`);
      // createRelay 内部已尽量降级兜底，能抛到这里的是硬错误（spawn/锁/状态目录）。
      // 5s 后重试（respawning 已在 finally 复位），避免会话永久卡死在死客户端上
      setTimeout(() => void respawnRelay(), 5000);
    } finally {
      respawning = false;
    }
  }

  attachRelay(await createRelay(dotaPath));

  /** 统一的未连接提示 */
  function notConnectedText(extra = ""): string {
    // 守护进程模式下端口被别的实例占用：报错指向真实原因
    if ((relay as VConRelay).portInUse) {
      return `另一个 dota2-mcp 实例已占用端口 29001/29002（多实例冲突）。请关闭其他实例。`;
    }
    return `未连接到 Dota 2（VConsole2 端口 29000）。Dota 2 可能未启动、已崩溃或正在重启；relay 会持续自动重连，稍后重试即可。若刚重启 Dota 2 仍持续出现：旧 dota2.exe 可能没退干净并仍占用 29000——在任务管理器彻底结束所有 dota2.exe 后再启动。${extra}`;
  }

  /** vconsole 未打开的契约提示（控制台类工具需要 vconsole 旁观 agent 活动） */
  function vconsoleNotOpenText(): string {
    const exe = dotaPath ? path.join(getDotaBinDir(dotaPath), getDotaExeName("vconsole2")) : "vconsole2.exe";
    return `vconsole 未打开。控制台类工具要求 vconsole 已打开并连接 127.0.0.1:29001（显式契约：保证你能旁观 agent 的控制台活动）。
请二选一：
1. 直接运行 ${exe}（AssetBrowser 的 vconsole 按钮在 relay 持有 29000 时被引擎禁用，勿用）；
2. 调用 dota_open_vconsole 让我帮你打开。`;
  }

  /** 控制台类工具入口两段检查：Dota 连接 → vconsole 接入 */
  function requireConsole(): void {
    if (!relay.dotaConnected) throw new McpError(ErrorCode.InvalidRequest, notConnectedText());
    if (!relay.guiConnected) throw new McpError(ErrorCode.InvalidRequest, vconsoleNotOpenText());
  }

  /** 依赖 dotaPath 的工具在路径未检测到时返回的可操作错误 */
  function dotaPathNotDetectedText(): string {
    return `未能检测到 Dota 2 安装目录（asset 编译和 addon 地图扫描依赖此路径）。
已尝试：find-steam-app、注册表 SteamPath、STEAM_PATH 环境变量、各平台默认 Steam 位置。
请确认 Dota 2 是通过 Steam 安装的（appid 570），或设置 STEAM_PATH 指向你的 Steam 目录。`;
  }

  // 文件系统扫描 maps（relay 断连时的降级方案）
  function scanMapsFs(addon: string | null): string[] {
    if (!addon || !dotaPath) return [];
    try {
      const dir = path.join(dotaPath, "content", "dota_addons", addon, "maps");
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".vmap"))
        .map((e) => e.name.replace(".vmap", ""));
    } catch { return []; }
  }

  /** 从文件系统自动检测 addon：如果只有一个项目就直接用 */
  function detectAddonFromFs(): string | null {
    if (!dotaPath) return null;
    try {
      const dir = path.join(dotaPath, "content", "dota_addons");
      const addons = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      if (addons.length === 1) return addons[0];
    } catch { /* ignore */ }
    return null;
  }

  /** 获取当前 addon，优先用 relay 检测，其次文件系统自动推断 */
  function resolveAddon(preferred?: string): string | null {
    return preferred || currentAddon || detectAddonFromFs();
  }

  /** 列出所有 addon，用于提示用户 */
  function listAddonsFs(): string[] {
    if (!dotaPath) return [];
    try {
      return fs.readdirSync(path.join(dotaPath, "content", "dota_addons"), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch { return []; }
  }

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

  // 相位卡住时的推进指引（game_state 子串匹配；命令名经 vscode-dota2-tools
  // 的 script_help2 引擎转储佐证，活体复核见 plan Task 7）
  const PHASE_GUIDANCE: Record<string, string> = {
    CUSTOM_GAME_SETUP: "Addon setup phase — it ends when the addon calls GameRules:FinishCustomGameSetup(). To advance now: dota_run_lua with code `GameRules:FinishCustomGameSetup()`. If it won't advance, the addon's setup logic is erroring → console_output (level 3, channel 'VScript').",
    WAIT_FOR_PLAYERS_TO_LOAD: "Waiting for players/bots to finish loading — usually resolves on its own. If stuck, check console_output for which client never finishes loading.",
    HERO_SELECTION: "Hero selection is controlled by the addon. Advance by assigning heroes via dota_run_lua, or set selection time to 0 in the addon (GameRules:SetHeroSelectionTime).",
    STRATEGY_TIME: "Timed phase, advances automatically. To shorten in addon code: GameRules:SetStrategyTime(0).",
    TEAM_SHOWCASE: "Timed phase, advances automatically. To shorten in addon code: GameRules:SetShowcaseTime(0).",
    WAIT_FOR_MAP_TO_LOAD: "Map still loading — should pass quickly. If stuck: console_output (channel 'ResourceSystem') — the map may not be compiled; run dota_compile_asset on it.",
    PRE_GAME: "Pre-game, advances automatically. To shorten in addon code: GameRules:SetPreGameTime(0).",
    INIT: "Engine initializing — should pass in seconds. If stuck, check console_output for engine/resource errors.",
    POST_GAME: "Game ended. Use dota_restart to run again.",
  };

  // Tool: 读取 console 输出（VCon 实时流，含 verbosity 级别和 channel 来源）
  server.tool("console_output",
    "Use when the user reports an in-game bug, error, crash, Lua/Panorama failure, or asks what went wrong while testing. Reads Dota 2 console output with severity filtering. level: 0=all, 1=warnings+, 2=asserts+, 3=errors only. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    {
      lines: z.number().optional().describe("Number of lines to return. Default 50."),
      level: z.number().optional().describe("0=all, 1=warnings+, 2=asserts+, 3=errors only. Default 0."),
      filter: z.string().optional().describe("Optional regex"),
      channel: z.string().optional().describe("Filter by source channel(s), e.g. VScript, PanoramaScript, ResourceSystem. Use comma to filter multiple channels like 'VScript, PanoramaScript'. Use console_channels to list available channels."),
    },
    async ({ lines, level, filter, channel }) => {
      requireConsole();
      const n = lines ?? 50;
      const lvl = level ?? 0;
      let output = prntLog;
      if (lvl > 0) output = output.filter(l => l.verbosity >= lvl);
      if (filter) {
        let re: RegExp;
        try {
          re = new RegExp(filter, "i");
        } catch (e) {
          throw new McpError(ErrorCode.InvalidRequest, `Invalid regex filter: ${filter}`);
        }
        output = output.filter(l => re.test(l.text));
      }
      if (channel) {
        const chs = channel.split(",").map(c => c.trim().toLowerCase()).filter(Boolean);
        output = output.filter(l => chs.includes(l.channel.toLowerCase()));
      }
      return { content: [{ type: "text", text: output.slice(-n).map(l => `[${l.channel || "?"}][L${l.verbosity}] ${l.text}`).join("\n") || "(no output)" }] };
    }
  );

  // Tool: 列出当前可用的 VConsole2 通道
  server.tool("console_channels",
    "List all available VConsole2 source channels with short descriptions. Use the channel names with console_output channel filter. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    {},
    async () => {
      requireConsole();
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
    "Use to run any Dota 2 console command — change convars, trigger cheats, exec cfgs, or drive the engine directly while testing. Sends command(s) to the live Dota 2 console. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    { commands: z.string().describe("Command(s), newline-separated") },
    async ({ commands }) => {
      requireConsole();
      const cmds = commands.split("\n").map(c => c.trim()).filter(Boolean);
      cmds.forEach(c => relay.sendCommand(c));
      return { content: [{ type: "text", text: `Sent ${cmds.length} command(s)` }] };
    }
  );


  // 内置 skill 目录：skills/<name>/SKILL.md，frontmatter 带 name/description
  function skillsDir(): string {
    const require = createRequire(import.meta.url);
    return path.join(path.dirname(require.resolve("../package.json")), "skills");
  }
  function loadSkills(): { name: string; description: string; body: string }[] {
    const dir = skillsDir();
    const out: { name: string; description: string; body: string }[] = [];
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const file = path.join(dir, e.name, "SKILL.md");
      try {
        const raw = fs.readFileSync(file, "utf-8");
        const fm = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        const meta = fm ? fm[1] : "";
        const body = fm ? fm[2] : raw;
        const name = (meta.match(/^name:\s*(.+)$/m)?.[1] || e.name).trim();
        const description = (meta.match(/^description:\s*(.+)$/m)?.[1] || "").trim();
        out.push({ name, description, body: body.trim() });
      } catch { /* skip */ }
    }
    return out;
  }

  // Tool: 获取内置 skill — 教 agent 怎么用这套 MCP（Roblox skill 模式）
  server.tool("dota2_skill",
    "Retrieve built-in skill / knowledge on how to develop a Dota 2 custom game with this MCP. Call with no argument to list available skills, or with a skill name to retrieve its content. Learn the runtime development model (long-lived process + hot reload, no map restarts for code edits) before testing or editing.",
    {
      name: z.string().optional().describe("Skill name, e.g. 'dota2-runtime-dev'. Omit to list available skills."),
    },
    async ({ name }) => {
      const skills = loadSkills();
      if (skills.length === 0) {
        return { content: [{ type: "text", text: "No built-in skills found (skills/ directory missing)." }] };
      }
      if (!name) {
        const list = skills.map(s => `- ${s.name}: ${s.description}`).join("\n");
        return { content: [{ type: "text", text: `Available skills:\n${list}\n\nCall dota2_skill with a name to retrieve it.` }] };
      }
      const skill = skills.find(s => s.name === name || s.name === `dota2-${name}`);
      if (!skill) {
        return { content: [{ type: "text", text: `Unknown skill '${name}'. Available: ${skills.map(s => s.name).join(", ")}` }] };
      }
      return { content: [{ type: "text", text: skill.body }] };
    }
  );


  // Tool: 任务入口 — 测试 / 验证 / 调试 Dota 2 自定义游戏（导航型，永不抛异常）
  server.tool("dota_status",
    "Check the Dota 2 custom game project's connection, vconsole, addon, available maps, and live game state — and what to do next. Use this FIRST whenever the user asks to test a Dota 2 addon / custom game, check why something doesn't work in-game, run a map, or inspect live game state. Never throws: reports what's missing (Dota or vconsole) and how to fix it.",
    {},
    async () => {
      if (!relay.dotaConnected) {
        return { content: [{ type: "text", text:
`Dota 2 is not connected. Ensure Dota 2 is running (with -vconsole or -tools). The relay reconnects automatically; if you just restarted Dota 2 and this persists, an old dota2.exe may not have fully exited — kill it completely and start again.

Once connected, call dota_status again.` }] };
      }
      if (!relay.guiConnected) {
        return { content: [{ type: "text", text:
`Dota 2 is connected, but vconsole is not open. Console tools require an open vconsole attached to 127.0.0.1:29001 (explicit contract: you can watch the agent's console activity there).

Open it: run vconsole2.exe and connect to 127.0.0.1:29001 — the AssetBrowser vconsole button is disabled by the engine while this MCP holds port 29000 — or call dota_open_vconsole.

Then call dota_status again.` }] };
      }

      // ADON 帧是 Dota 2 主动推送的，连接刚建立时可能还没到。
      // addon 为空时稍等片刻再读一次，避免首次调用永远 "(detecting...)"。
      if (!currentAddon) {
        for (let i = 0; i < 10 && !currentAddon; i++) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      const addon = resolveAddon();
      const maps = currentMaps.length > 0 ? currentMaps : scanMapsFs(addon);
      const allMaps = currentAllMaps.length > 0 ? currentAllMaps : scanMapsFs(addon);
      const status = await queryStatusJson(5000);
      const state = parseGameState(status);

      // 根据状态给出下一步指引
      let nextStep: string;
      if (state.loading) {
        nextStep = "Map is loading. Wait, then call dota_status again or watch console_output.";
      } else if (!state.loaded) {
        nextStep = `No map running. To test the addon, launch a map: dota_launch_game${maps.length > 0 ? ` (available: ${maps.join(", ")})` : ""}.`;
      } else {
        nextStep = `Map "${state.map}" is running (${state.phase}). To test/debug:
- Check for errors → console_output (level 3, or channel filter 'VScript' for Lua errors)
- Verify specific behavior / reproduce a bug → dota_run_lua
- Inspect entities → dota_dump_entities; modifiers → dota_dump_modifiers
- Reload after editing Lua/KV/Panorama → dota_restart${state.phase !== "playing" ? `
- Stuck in phase "${state.game_state}"? See dota2_skill 'dota2-game-phases' for how to advance.` : ""}`;
      }

      return { content: [{ type: "text", text: JSON.stringify({
        connected: true,
        vconsole: true,
        addon: currentAddon || addon || "(detecting...)",
        maps,
        allMaps,
        running: {
          map: state.map,
          loaded: state.loaded,
          loading: state.loading,
          game_state: state.game_state,
          phase: state.phase,
          players: state.players,
          clients_bot: state.clients_bot,
          clients_proxies: state.clients_proxies,
          first_player: state.first_player,
          hibernating: state.hibernating,
          cpu_usage: state.cpu_usage,
          udp_port: state.udp_port,
          network_lag_avg: state.network_lag_avg,
          build_version: state.build_version,
          process_uptime: state.process_uptime,
        },
        nextStep,
      }, null, 2) }] };
    }
  );


  // Tool: 启动游戏（轮询到 GAME_IN_PROGRESS；卡相位返回推进指引）
  server.tool("dota_launch_game",
    "Use to start / run / load a Dota 2 custom game map when the user wants to test or play their addon. Launches the map and polls until the game reaches GAME_IN_PROGRESS; if it gets stuck in a phase (e.g. CUSTOM_GAME_SETUP), returns the phase, how to advance it, and recent errors. Call dota_status first to see available maps. Requires an open vconsole (see dota_open_vconsole).",
    {
      map: z.string().optional().describe("Map name. Auto-detected if omitted."),
      addon: z.string().optional().describe("Addon name. Auto-detected if omitted."),
      timeout: z.number().optional().describe("Max seconds to wait for GAME_IN_PROGRESS. Default 90."),
    },
    async ({ addon, map, timeout }) => {
      requireConsole();
      const a = resolveAddon(addon);
      const maps = currentMaps.length > 0 ? currentMaps : scanMapsFs(a);
      const m = map || maps[0];
      if (!a) throw new McpError(ErrorCode.InvalidRequest, "No addon detected. Load a project first or specify addon.");
      if (!m) throw new McpError(ErrorCode.InvalidRequest, `No map specified and none found in addon '${a}'. Available: ${maps.length > 0 ? maps.join(", ") : "none"}`);

      const timeoutMs = Math.max(15, timeout || 90) * 1000;

      /** 卡相位报告：相位原文 + 已卡时长 + 推进指引 + 近期错误 + skill 文档指路 */
      const buildStuckReport = (state: string, stuckMs: number): string => {
        const key = Object.keys(PHASE_GUIDANCE).find(k => state.includes(k));
        const guidance = key ? PHASE_GUIDANCE[key] : "Unrecognized phase. Check console_output for errors.";
        const errors = prntLog
          .filter(l => l.verbosity >= 3 || l.channel === "VScript")
          .slice(-8)
          .map(l => `[${l.channel || "?"}][L${l.verbosity}] ${l.text}`);
        return [
          `Game has been stuck in ${state || "(unknown state)"} for ${Math.round(stuckMs / 1000)}s.`,
          `How to advance: ${guidance}`,
          errors.length > 0 ? `Recent errors:\n${errors.join("\n")}` : "No recent VScript/error output.",
          `Full phase guide: call dota2_skill with name "dota2-game-phases".`,
        ].join("\n");
      };

      // 已进入 GAME_IN_PROGRESS 直接返回；已在加载/已加载则不发命令只观察
      const initial = parseGameState(await queryStatusJson(5000));
      if (initial.game_state.includes("GAME_IN_PROGRESS")) {
        return { content: [{ type: "text", text: `Already in game: ${initial.map} (${initial.game_state})` }] };
      }
      if (!initial.loaded && !initial.loading) {
        relay.sendCommand(`dota_launch_custom_game ${a} ${m}`);
      }

      const startTime = Date.now();
      let lastState = initial.game_state;
      let lastChangeAt = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        if (!relay.dotaConnected) {
          return { content: [{ type: "text", text: `Dota 2 disconnected while launching (crash?). ${notConnectedText()}` }] };
        }
        await new Promise(r => setTimeout(r, 2000));
        const cur = parseGameState(await queryStatusJson(5000));
        if (cur.game_state !== lastState) {
          lastState = cur.game_state;
          lastChangeAt = Date.now();
        }
        if (cur.game_state.includes("GAME_IN_PROGRESS")) {
          return { content: [{ type: "text", text: `Launched and in game: ${a}/${m} (map: ${cur.map}, state: ${cur.game_state})` }] };
        }
        if (lastState && Date.now() - lastChangeAt > 15000) {
          return { content: [{ type: "text", text: buildStuckReport(lastState, Date.now() - lastChangeAt) }] };
        }
      }

      return { content: [{ type: "text", text: buildStuckReport(lastState, timeoutMs) }] };
    }
  );

  // Tool: 断开
  server.tool("dota_disconnect",
    "Use to disconnect / quit the current Dota 2 custom game and return to the main menu, e.g. after finishing a test run. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    {},
    async () => {
      requireConsole();
      relay.sendCommand("disconnect");
      return { content: [{ type: "text", text: "Disconnected." }] };
    }
  );

  // Tool: 打开 vconsole 窗口（AssetBrowser 按钮被引擎禁用时的显式路径）
  server.tool("dota_open_vconsole",
    "Use to open the VConsole2 window for the user when console tools report 'vconsole 未打开'. Launches vconsole2.exe directly (the AssetBrowser vconsole button is disabled by the engine while this MCP holds port 29000) and waits for it to attach to the relay. Console tools require an attached vconsole (explicit contract).",
    {},
    async () => {
      if (!dotaPath) throw new McpError(ErrorCode.InvalidRequest, dotaPathNotDetectedText());
      if (relay.guiConnected) {
        return { content: [{ type: "text", text: "vconsole is already open and attached." }] };
      }
      // 已有实例但未接入：vconsole2 单实例，再 spawn 只会聚焦旧窗口（实测）
      if (consoleBridge.isProcessRunning(process.platform === "win32" ? "vconsole2.exe" : "vconsole2")) {
        return { content: [{ type: "text", text: "A vconsole2.exe instance is already running but not attached to 127.0.0.1:29001 (stale window — vconsole2 is single-instance, launching another just focuses it). Close it and call dota_open_vconsole again, or in that window use Devices → Connect to 127.0.0.1:29001." }] };
      }
      const exe = path.join(getDotaBinDir(dotaPath), getDotaExeName("vconsole2"));
      if (!fs.existsSync(exe)) {
        throw new McpError(ErrorCode.InvalidRequest, `vconsole2.exe not found at ${exe}`);
      }
      const result = await runDotaTool("vconsole2", [], false);
      if (!result.ok) {
        throw new McpError(ErrorCode.InvalidRequest, `Failed to launch vconsole2: ${result.stderr}`);
      }
      // Qt 启动 + auto-connect 实测可达 ~20s，等 30s
      for (let i = 0; i < 60 && !relay.guiConnected; i++) {
        await new Promise(r => setTimeout(r, 500));
      }
      return { content: [{ type: "text", text: relay.guiConnected
        ? "vconsole opened and attached to relay (127.0.0.1:29001)."
        : "vconsole2.exe launched but did not attach to 127.0.0.1:29001 within 30s. Check the vconsole2 connection target is 127.0.0.1:29001 (saved in its settings)."
      }] };
    }
  );

  // Tool: 重启当前游戏
  server.tool("dota_restart",
    "Use to quickly reload / restart the current map after changing Lua, KV, or Panorama files, so the user can re-test without relaunching manually. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    {},
    async () => {
      requireConsole();
      relay.sendCommand("restart");
      return { content: [{ type: "text", text: "Sent: restart (reloads current map)" }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 调试 & 状态检查工具
  // ═══════════════════════════════════════════════════════════════

  // Tool: 列出所有实体
  server.tool("dota_dump_entities",
    "Use to inspect live game state while debugging — lists all entities currently in the scene (heroes, units, thinkers) to verify spawns, positions, or whether an entity exists at all. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    {},
    async () => {
      requireConsole();
      const out = await collectOutput("dump_entity_report", { waitMs: 5000, settleMs: 300 });
      return { content: [{ type: "text", text: out.join("\n") || "Sent. Use console_output." }] };
    }
  );

  // Tool: 列出所有 modifier
  server.tool("dota_dump_modifiers",
    "Use to debug buffs/debuffs/modifiers while testing — dumps active modifiers on entities (server) or all registered modifier types (client) to verify an ability applied its modifier correctly. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    { side: z.enum(["server","client"]).optional().describe("server or client. Default client.") },
    async ({ side }) => {
      requireConsole();
      const s = side ?? "client";
      const cmd = s === "server" ? "dota_modifier_dump" : "cl_dump_modifier_list";
      const out = await queryConsole(cmd, 3000);
      return { content: [{ type: "text", text: out.join("\n") || "(no results)" }] };
    }
  );

  // Tool: 查看实体脚本作用域
  server.tool("dota_entity_inspect",
    "Use to inspect a specific entity's Lua script scope (its properties, functions, member values) while debugging ability or unit behavior. Pass entity name/class/entindex. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    { entity: z.string().describe("Entity identifier"), side: z.enum(["server","client"]).optional().describe("server or client. Default client.") },
    async ({ entity, side }) => {
      requireConsole();
      const s = side ?? "client";
      const cmd = s === "server" ? "ent_script_dump" : "cl_ent_script_dump";
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
      let settleTimer: NodeJS.Timeout | null = null;
      let waitTimer: NodeJS.Timeout | null = null;

      const onPrnt = (msg: any) => {
        collected.push(msg.text);
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        if (settleTimer) clearTimeout(settleTimer);
        if (waitTimer) clearTimeout(waitTimer);
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
          finish();
          return;
        }
        settleTimer = setTimeout(settleCheck, 50);
      };

      waitTimer = setTimeout(() => {
        finish();
      }, waitMs);

      settleTimer = setTimeout(settleCheck, 50);
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
      let checkTimer: NodeJS.Timeout | null = null;
      let waitTimer: NodeJS.Timeout | null = null;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (checkTimer) clearTimeout(checkTimer);
        if (waitTimer) clearTimeout(waitTimer);
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
          finish();
          return;
        }
        checkTimer = setTimeout(check, 50);
      };

      waitTimer = setTimeout(() => {
        finish();
      }, waitMs);

      checkTimer = setTimeout(check, 50);
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
    "Use to look up a Dota 2 Lua API function or class signature while writing server-side script — e.g. 'what args does CreateUnitByName take' or 'what methods does CDOTA_BaseNPC have'. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    { func: z.string().optional().describe("Function/class name. Empty=full dump."), side: z.enum(["server","client"]).optional().describe("server or client. Default server.") },
    async ({ func, side }) => {
      requireConsole();
      const s = side ?? "server";
      const cmd = s === "client" ? "cl_script_help2" : "script_help2";
      const out = await queryConsole(func ? `${cmd} ${func}` : cmd, 3000);
      return { content: [{ type: "text", text: out.join("\n") || "(no results)" }] };
    }
  );

  // Tool: Panorama JS API
  server.tool("dota_api_panorama_js",
    "Use to look up Panorama JS API enums/classes (GameUI, CustomUIElement, $) while writing custom HUD / UI for the custom game. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    { name: z.string().optional().describe("Enum/class name. Empty=full list.") },
    async ({ name }) => {
      requireConsole();
      const out = await queryConsole(name ? `cl_panorama_script_help_2 ${name}` : "cl_panorama_script_help_2", 3000);
      return { content: [{ type: "text", text: out.join("\n") || "(no results)" }] };
    }
  );

  // Tool: Panorama CSS 属性
  server.tool("dota_api_css",
    "Use to look up a Panorama CSS property (e.g. wash-color, blur) with description and examples while styling the custom game's UI. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    { prop: z.string().optional().describe("CSS property name, e.g. 'wash-color'. Empty=all 128.") },
    async ({ prop }) => {
      requireConsole();
      const out = await queryConsole(prop ? `dump_panorama_css_properties ${prop}` : "dump_panorama_css_properties", 3000);
      return { content: [{ type: "text", text: out.join("\n") || "(no results)" }] };
    }
  );

  // Tool: Panorama Panel 事件
  server.tool("dota_api_events",
    "Use to look up Panorama panel event handlers (e.g. SetPanelSelected, onactivate) and their signatures while wiring UI interactions. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    { event: z.string().optional().describe("Event name, e.g. 'SetPanelSelected'. Empty=all events.") },
    async ({ event }) => {
      requireConsole();
      const out = await queryConsole(event ? `dump_panorama_events ${event}` : "dump_panorama_events", 3000);
      return { content: [{ type: "text", text: out.join("\n") || "(no results)" }] };
    }
  );

  // --- 调试工具（服务端 + 客户端） ---

  // Tool: 搜索所有 5248 个 console 指令/cvar
  server.tool("console_find",
    "Use to discover a Dota 2 console command or convar when you don't know its exact name — e.g. find a cheat, a debug flag, or a launch option. Use prefixes like 'dota_', 'sv_', 'cl_' to narrow. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    { query: z.string().describe("Search keyword") },
    async ({ query }) => {
      requireConsole();
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
    "Use to check what a specific Dota 2 console command or convar does and its current value before using it. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    { command: z.string().describe("Command name") },
    async ({ command }) => {
      requireConsole();
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
    "Use to look up the official Dota 2 Lua API doc string for a function or class (script_help), e.g. 'CreateUnitByName' or 'CDOTA_BaseNPC'. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    { query: z.string().optional().describe("Function or class name. Empty = list all registered API functions.") },
    async ({ query }) => {
      requireConsole();
      const out = await queryConsole(query ? `script_help ${query}` : "script_help", 4000, 300);
      return { content: [{ type: "text", text: out.join("\n") || "Sent. Use console_output to see results." }] };
    }
  );

  // Tool: 在运行中的游戏里执行 Lua 代码
  server.tool("dota_run_lua",
    "Use to run server-side Lua in the live game while testing — verify a function works, inspect a value, spawn a unit, or reproduce a bug without editing files and reloading. 'expression' auto-DeepPrintTables the result. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    {
      code: z.string().optional().describe("Arbitrary Lua statements to run. Use single quotes inside to avoid shell escaping issues."),
      expression: z.string().optional().describe("Lua expression to evaluate; its result will be DeepPrintTable'd automatically (e.g. 'PlayerResource:GetAllTeamPlayerIDs()')."),
    },
    async ({ code, expression }) => {
      requireConsole();

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

  /** 执行 Dota 2 工具目录下的可执行文件。
   *
   * - waitForExit = true：等待进程退出并收集 stdout/stderr。
   * - waitForExit = false：在进程成功启动后立即返回 PID；
   *   如果启动失败（如可执行文件不存在）则返回 ok=false。
   * 调用前需确保 dotaPath 非空（dota_compile_asset 已检查）。
   */
  function runDotaTool(exeBase: string, args: string[], waitForExit = false): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    const exePath = path.join(getDotaBinDir(dotaPath!), getDotaExeName(exeBase));
    return new Promise((resolve) => {
      const proc = spawn(exePath, args, {
        detached: !waitForExit,
        windowsHide: false,
      });
      let stdout = "";
      let stderr = "";
      let resolved = false;

      const onStdout = (d: Buffer) => { stdout += d.toString(); };
      const onStderr = (d: Buffer) => { stderr += d.toString(); };
      proc.stdout?.on("data", onStdout);
      proc.stderr?.on("data", onStderr);

      const finish = (result: { ok: boolean; stdout: string; stderr: string }) => {
        if (resolved) return;
        resolved = true;
        proc.stdout?.off("data", onStdout);
        proc.stderr?.off("data", onStderr);
        resolve(result);
      };

      proc.on("error", (e) => finish({ ok: false, stdout, stderr: e.message }));

      if (waitForExit) {
        proc.on("close", (code) => finish({ ok: code === 0, stdout, stderr }));
      } else {
        proc.on("spawn", () => {
          proc.unref();
          finish({ ok: true, stdout: `started pid=${proc.pid}`, stderr });
        });
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
      return path.join(dotaPath!, target);
    }
    return path.join(dotaPath!, "content", "dota_addons", addon, target);
  }

  // Tool: 编译 Source 2 资源
  server.tool("dota_compile_asset",
    "Use to compile Source 2 assets (models, maps, particles, materials) after editing them, or decompile a compiled asset to inspect it. Target can be absolute, relative to addon content, or start with content/ / game/.",
    {
      target: z.string().describe("File, folder, or VPK path to compile"),
      addon: z.string().optional().describe("Addon name. Auto-detected if omitted."),
      recursive: z.boolean().optional().describe("Recursively scan subdirectories. Default false."),
      force: z.boolean().optional().describe("Force recompile even if up-to-date. Default false."),
      decompile: z.boolean().optional().describe("Use VRF decompile mode (Source2Viewer-CLI) instead of resourcecompiler. Default false."),
    },
    async ({ target, addon, recursive, force, decompile }) => {
      if (!dotaPath) {
        throw new McpError(ErrorCode.InvalidRequest, dotaPathNotDetectedText());
      }
      const a = resolveAddon(addon);
      if (!a) {
        const addons = listAddonsFs();
        throw new McpError(ErrorCode.InvalidRequest, addons.length > 1
          ? `No addon detected. Please specify one of: ${addons.join(", ")}`
          : "No addon detected. Load a project first or specify the addon name."
        );
      }

      const resolved = resolveAssetPath(target, a);
      const r = recursive ?? false;
      const f = force ?? false;

      if (decompile) {
        const result = await runDotaTool("Source2Viewer-CLI", [
          "-i", resolved,
          ...(r ? ["-r"] : []),
          "-d",
        ], true);
        return { content: [{ type: "text", text: result.ok
          ? `Decompiled ${resolved}\n${result.stdout.slice(0, 2000)}`
          : `Decompile failed: ${result.stderr}`
        }] };
      }

      const gameInfo = path.join(dotaPath!, "game", "dota");
      const args = ["-i", resolved, "-game", gameInfo];
      if (r) args.push("-r");
      if (f) args.push("-f");
      const result = await runDotaTool("resourcecompiler", args, true);
      return { content: [{ type: "text", text: result.ok
        ? `Compiled ${resolved}\n${result.stdout.slice(0, 2000)}`
        : `Compile failed: ${result.stderr}`
      }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  server.sendLoggingMessage({ level: "info", data: "dota2-mcp ready" });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

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
import * as crypto from "crypto";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
import { VConRelay, MCP_MARKER_RE } from "./tools/vcon-relay.js";
import { scrubbedEnv } from "./tools/process-env.js";
import { RelayClient } from "./relay-client.js";
import * as consoleBridge from "./tools/console-bridge.js";
import { ensureVrf, DEFAULT_VERSION } from "./tools/vrf-ensure.js";
import { inspectAsset } from "./tools/asset-inspect.js";
import { checkRefs } from "./tools/asset-check-refs.js";
import { captureScreenshot, startScreenshotWatcher } from "./tools/screenshot.js";
import { recordVideo } from "./tools/recorder.js";
import { particlePrecacheNote } from "./tools/particle-precache.js";
import { ok, okPretty, fail, READ_ONLY_ANNOTATIONS, type ToolResult } from "./tools/tool-result.js";
import * as daemon from "./daemon-utils.js";

function getVersion(): string {
  try {
    return require("../package.json").version;
  } catch {
    return "1.6.0";
  }
}

/** collectOutput 的边界标记（格式定义在 vcon-relay，relay 据此不转发 GUI） */
/** 单条控制台语句的长度上限：实测 510 字节的 echo 能执行，530 字节被引擎静默丢弃 */
const LUA_STATEMENT_MAX_BYTES = 510;

function newMcpMarkers(): { begin: string; end: string } {
  const id = crypto.randomBytes(4).toString("hex");
  return { begin: `__mcp_${id}_begin`, end: `__mcp_${id}_end` };
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
    const CTRL_PORT = daemon.parsePort(process.env.DOTA2_VCON_CTRL_PORT, 29002);

    /** 读 token → 连 :29002 握手；失败销毁 client 并触发 onFail，返回 null。 */
    async function attachThinClient(label: string, onFail?: () => void): Promise<RelayClient | null> {
      const token = daemon.readToken();
      const client = new RelayClient({ port: CTRL_PORT, token });
      try {
        await client.connect();
        console.error(`[relay] connected to ${label} (thin client mode)`);
        return client;
      } catch (e: any) {
        console.error(`[relay] ${label} handshake failed:`, e.message);
        client.destroy();
        onFail?.();
        return null;
      }
    }

    // 1) 已有守护进程在跑 → 瘦客户端接入
    if (await daemon.probeRelay()) {
      const client = await attachThinClient("existing daemon");
      if (client) return client;
      // 握手失败（token 不对/协议不兼容）→ 走下方重新拉起 daemon
    }

    // 2) 没有可用 daemon → 抢锁，抢到的人 spawn detached daemon，
    //    自己也以瘦客户端身份接入。这样 relay 生命周期独立于任何 MCP 会话。
    // 自愈陈旧锁：上次 daemon 崩溃留下的 relay.pid/relay.lock 由 livePid 清理，
    // 否则 acquireLock 永远 EEXIST，会话永久降级到本地 relay（此前需手动清状态文件）
    daemon.livePid();
    const relayMainPath = require.resolve("./relay-main.js");
    if (daemon.acquireLock()) {
      try {
        const pid = daemon.spawnRelayDaemon(relayMainPath);
        console.error(`[relay] spawned daemon pid=${pid}`);
        // 30s：守护进程冷启动 = node 冷启动 + detectDotaPath（注册表/Steam 库扫描），
        // Windows 上叠加 Defender 实时扫描可能远超 10s，超时太短会误入本地降级
        if (await daemon.waitForRelay(30000)) {
          const client = await attachThinClient("spawned daemon", () => {
            // 守护进程秒崩/握手被拒：不能让异常逃出 createRelay（respawn 路径会让
            // 会话永久卡死在被 destroy 的旧客户端上）。杀掉刚 spawn 的守护进程，走下方本地降级
            try { process.kill(pid); } catch { /* ignore */ }
          });
          if (client) return client;
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
        const client = await attachThinClient("daemon spawned by peer");
        if (client) return client;
      }
    }

    // 3) daemon 方案全部失败 → 退化到本地 VConRelay（单实例旧行为），
    //    保证工具至少可用，同时明确报错。
    console.error("[relay] daemon unavailable, falling back to local relay (single-instance mode)");
    const relay = new VConRelay();
    relay.setDotaPath(dotaPath);
    // 本地 relay 同样监听 :29002，不设 token 等于对本机任意进程开放 CMD（RunScriptCode = RCE）
    relay.setExpectedToken(daemon.ensureToken());
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

  // 结构化存 console 输出（含 verbosity 级别和 channel 来源）。seq 从 0 单调递增，
  // 供 console_output 的会话游标读取；环形缓冲只从头部淘汰，prntEvicted 即现存最老行号。
  const PRNT_BUFFER_MAX = 10000;
  let prntLog: { seq: number; text: string; verbosity: number; channel: string }[] = [];
  let prntSeqNext = 0;
  let prntEvicted = 0;
  /** 默认增量读取的会话游标（null = 本次会话尚未读过）；显式窗口读取不移动它 */
  let consoleCursor: number | null = null;

  /** 当前接入的 relay（瘦客户端或本地）。守护进程被杀时由 respawnRelay 整体替换 */
  let relay: RelayLike;

  /** 控制台首次连上 Dota 时启动常驻帧缓存；失败只在显式截图时重试，避免每个工具调用都刷日志。 */
  let captureWatchStarted = false;
  function startCaptureWatcherOnce(): void {
    if (captureWatchStarted) return;
    captureWatchStarted = true;
    if (process.env.DOTA2_CAPTURE_DISABLE_WATCHER === "1") return; // 离线控制台测试不捕获真实游戏
    void startScreenshotWatcher().catch((e) => console.error(`[capture] watcher not started: ${(e as Error).message}`));
  }

  /** 把 relay 接进工具层：同步初始 addon/maps + 挂事件。初始接入与会话内重拉共用 */
  function attachRelay(r: RelayLike): void {
    relay = r;
    if (r.dotaConnected) startCaptureWatcherOnce();
    // 从 relay 读初始 addon/maps（瘦客户端连上已运行的 daemon 时 ADON 帧早已收过；
    // 本地 relay 启动即主动连 Dota，ADON 也可能在 handler 挂载前到达。
    // 两种情况 adon 事件都不会再发，必须从当前状态读，否则 currentAddon 永远 "(detecting...)"）。
    // 两侧统一走公开 getter：VConRelay 的 _scanMaps 在 emit("adon") 前同步完成，无需等待。
    currentAddon = r.addonName || "";
    currentMaps = r.maps || [];
    currentAllMaps = r.allMaps || [];

    r.on("adon", () => {
      currentAddon = r.addonName || currentAddon;
      currentMaps = r.maps || [];
      currentAllMaps = r.allMaps || [];
    });
    // 事件驱动：relay 收到 PRNT 时立即同步到本地缓冲
    r.on("prnt", (msg: any) => {
      if (MCP_MARKER_RE.test(String(msg.text).trim())) return;
      prntLog.push({ seq: prntSeqNext++, text: msg.text, verbosity: msg.verbosity, channel: msg.channel || "" });
      if (prntLog.length > PRNT_BUFFER_MAX) {
        prntLog.shift();
        prntEvicted++;
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
  function notConnectedText(): string {
    // 守护进程模式下端口被别的实例占用：报错指向真实原因
    if ((relay as VConRelay).portInUse) {
      return `另一个 dota2-mcp 实例已占用端口 29001/29002（多实例冲突）。请关闭其他实例。`;
    }
    return `未连接到 Dota 2（VConsole2 端口 29000）。Dota 2 可能未启动、已崩溃或正在重启；relay 会持续自动重连，稍后重试即可。若刚重启 Dota 2 仍持续出现：旧 dota2.exe 可能没退干净并仍占用 29000——在任务管理器彻底结束所有 dota2.exe 后再启动。
调用 dota_status 查看当前能力矩阵（daemon/vconsole/dota/phase/cheats）与当前可用动作。`;
  }

  /** vconsole 未打开的契约提示（控制台类工具需要 vconsole 旁观 agent 活动） */
  function vconsoleNotOpenText(): string {
    const exe = dotaPath ? consoleBridge.resolveDotaToolPath(dotaPath, "vconsole2") : "vconsole2.exe";
    return `vconsole 未打开。控制台类工具要求 vconsole 已打开并连接 127.0.0.1:29001（显式契约：vconsole 不开，relay 就不连 Dota——保证你能旁观 agent 的控制台活动）。
正常情况下 relay 探测到 Dota 就绪后会自动打开 vconsole；看到此消息说明自动打开被禁用（DOTA2_VCON_AUTO_OPEN_VCONSOLE=0）或打开失败/被你手动关闭了。
请二选一：
1. 直接运行 ${exe}（AssetBrowser 的 vconsole 按钮在 relay 持有 29000 时被引擎禁用，勿用）；
2. 调用 dota_open_vconsole 让我帮你打开。
调用 dota_status 查看当前能力矩阵（daemon/vconsole/dota/phase/cheats）与当前可用动作。`;
  }

  /** dota_status 的 vconsole 未开英文指引（与 requireConsole 的中文报错同源不同语，共享 exe 解析） */
  function vconsoleGuidanceEn(intro: string): string {
    const exe = dotaPath ? consoleBridge.resolveDotaToolPath(dotaPath, "vconsole2") : "vconsole2.exe";
    return `${intro}

Open it: run ${exe} and connect to 127.0.0.1:29001 — the AssetBrowser vconsole button is disabled by the engine while this MCP holds port 29000 — or call dota_open_vconsole.

Then call dota_status again.`;
  }

  /** 断连时的准确原因：Dota 真不在 vs 只是没开 vconsole（strict 模型下 relay 不连） */
  function disconnectedReasonText(): string {
    return (relay.dotaReady && !relay.guiConnected) ? vconsoleNotOpenText() : notConnectedText();
  }

  /** 控制台类工具入口检查：Dota 连接（strict 门控）→ vconsole 接入（双保险） */
  function requireConsole(): void {
    if (!relay.dotaConnected) throw new McpError(ErrorCode.InvalidRequest, disconnectedReasonText());
    if (!relay.guiConnected) throw new McpError(ErrorCode.InvalidRequest, vconsoleNotOpenText());
    startCaptureWatcherOnce();
  }

  /** requireConsole 的契约版：不满足门控时返回 fail envelope（带稳定 code），通过时返回 null */
  function consoleGate() {
    if (!relay.dotaConnected) {
      return relay.dotaReady && !relay.guiConnected
        ? fail("vconsole_closed", vconsoleNotOpenText())
        : fail("dota_down", disconnectedReasonText());
    }
    if (!relay.guiConnected) return fail("vconsole_closed", vconsoleNotOpenText());
    startCaptureWatcherOnce();
    return null;
  }

  /** Lua/VFX 工具返回窗口的游标字段：按 console_output 的 since_seq 语义计算，
   *  如实报告扫描到的缓冲位置与缺口；这些工具是动作而非读取，不移动会话游标。 */
  function windowCursor(startSeq: number): { next_seq: number; dropped: number } {
    return { next_seq: Math.max(prntSeqNext, startSeq), dropped: Math.max(0, prntEvicted - startSeq) };
  }

  /** 依赖 dotaPath 的工具在路径未检测到时返回的可操作错误 */
  function dotaPathNotDetectedText(): string {
    return `未能检测到 Dota 2 安装目录（asset 编译和 addon 地图扫描依赖此路径）。
已尝试：注册表 SteamPath、STEAM_PATH 环境变量、各平台默认 Steam 位置。
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
    CUSTOM_GAME_SETUP: "Addon setup phase — it ends when the addon calls GameRules:FinishCustomGameSetup(). To get to a playable game now: call dota_advance_to_game. If it won't advance, the addon's setup logic is erroring → console_output (level 3, channel 'VScript').",
    WAIT_FOR_PLAYERS_TO_LOAD: "Waiting for players/bots to finish loading — usually resolves on its own. If stuck, check console_output for which client never finishes loading.",
    HERO_SELECTION: "Waiting for players to pick. Call dota_advance_to_game (picks a random hero, or the one you pass, for every player without one).",
    STRATEGY_TIME: "Timed phase, advances automatically. To skip: call dota_advance_to_game.",
    TEAM_SHOWCASE: "Timed phase, advances automatically. To skip: call dota_advance_to_game.",
    WAIT_FOR_MAP_TO_LOAD: "Map still loading — should pass quickly. If stuck: console_output (channel 'ResourceSystem') — the map may not be compiled; run dota_compile_asset on it.",
    PRE_GAME: "Pre-game, advances automatically. To skip: call dota_advance_to_game.",
    INIT: "Map loading / game-rules init — big maps can take minutes, this is normal while loading. If it never finishes: console_output (channel 'ResourceSystem') — assets may be missing or uncompiled; run dota_compile_asset.",
    POST_GAME: "Game ended. Use dota_restart to run again.",
  };

  /** 加载期相位：会自己推进、只需等待（不算卡住，也无可执行的推进动作） */
  function isLoadingPhase(state: string): boolean {
    return /_INIT$|WAIT_FOR_/.test(state);
  }

  /** 卡相位报告：相位原文 + 已卡时长 + 推进指引 + 近期错误 + skill 文档指路 */
  function buildStuckReport(state: string, stuckMs: number): string {
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
      `To see what the game is showing: call dota_screenshot.`,
      `Current capabilities and the actions valid right now: call dota_status.`,
      `Full phase guide: call dota2_skill with name "dota2-game-phases".`,
    ].join("\n");
  }

  // Tool: 读取 console 输出（VCon 实时流，含 verbosity 级别和 channel 来源）
  server.tool("console_output",
    "Use when you need to read Dota 2 console output to diagnose an in-game bug, error, crash, Lua/Panorama failure, or the result of a command you just sent. Reads this MCP session's buffered console lines and is incremental by default: the first default call (no cursor yet) returns the most recent 50 lines, and later default calls return only lines added since the previous default call. Returns {ok:true,lines,count,next_seq,dropped}: lines is one newline-joined string formatted '[channel][Llevel] text', count is the number of returned lines, next_seq is the next unseen sequence number (pass it as since_seq to continue explicitly), and dropped is how many requested lines the 10000-line buffer already evicted. Window params (use at most one): tail returns the last N lines (lines is a one-version alias), since_seq replays inclusively from that seq, from_start returns the whole buffered history. level (0=all, 1=warnings+, 2=asserts+, 3=errors only), filter (case-insensitive regex) and channel (comma-separated names) narrow the returned window only: unmatched lines stay buffered and next_seq still advances over everything scanned. Limits: requires an open vconsole attached to 127.0.0.1:29001; the buffer keeps the newest 10000 lines; the cursor is per MCP session and resets when the session restarts; explicit tail/since_seq/from_start reads do not move the default cursor. Related tools: console_send (run commands), console_channels (list channel names), console_find/console_help (discover commands), dota_status (connection state).",
    {
      tail: z.number().optional().describe("Return only the last N buffered lines (N >= 1). Default on the first call without a cursor: 50. Mutually exclusive with since_seq/from_start."),
      lines: z.number().optional().describe("Alias for tail, kept for one version."),
      since_seq: z.number().optional().describe("Replay: return lines whose seq is >= this value. Mutually exclusive with tail/lines/from_start."),
      from_start: z.boolean().optional().describe("Return the whole buffered session history (subject to the 10000-line cap). Mutually exclusive with tail/lines/since_seq."),
      level: z.number().optional().describe("0=all, 1=warnings+, 2=asserts+, 3=errors only. Default 0."),
      filter: z.string().optional().describe("Optional case-insensitive regex"),
      channel: z.string().optional().describe("Filter by source channel(s), e.g. VScript, PanoramaScript, ResourceSystem. Use comma to filter multiple channels like 'VScript, PanoramaScript'. Use console_channels to list available channels."),
    },
    READ_ONLY_ANNOTATIONS,
    async ({ tail, lines, since_seq, from_start, level, filter, channel }) => {
      const blocked = consoleGate();
      if (blocked) return blocked;

      const n = tail ?? lines;
      if (tail !== undefined && lines !== undefined) return fail("invalid_arg", "Use either tail or its alias lines, not both.");
      const windows = Number(from_start === true) + Number(since_seq !== undefined) + Number(n !== undefined);
      if (windows > 1) return fail("invalid_arg", "Use at most one of from_start, since_seq, or tail/lines per call.");
      if (n !== undefined && (!Number.isInteger(n) || n < 1)) return fail("invalid_arg", "tail/lines must be a positive integer.");
      if (since_seq !== undefined && (!Number.isInteger(since_seq) || since_seq < 0)) return fail("invalid_arg", "since_seq must be a non-negative integer.");

      let re: RegExp | null = null;
      if (filter) {
        try {
          re = new RegExp(filter, "i");
        } catch {
          return fail("invalid_arg", `Invalid regex filter: ${filter}`);
        }
      }
      const chs = channel ? channel.split(",").map(c => c.trim().toLowerCase()).filter(Boolean) : null;

      // 窗口起点：显式参数优先于会话游标；无游标的首次读取等价 tail 50。
      // dropped = 请求窗口里已被环形缓冲挤掉的行数（证据缺口），过滤器不改变它。
      const oldest = prntEvicted; // seq 从 0 起、只从头部淘汰，故等于现存最老行号
      let startSeq: number;
      let dropped: number;
      let incremental = false;
      if (from_start) {
        startSeq = 0;
        dropped = oldest;
      } else if (since_seq !== undefined) {
        startSeq = since_seq;
        dropped = Math.max(0, oldest - since_seq);
      } else if (n !== undefined) {
        startSeq = Math.max(oldest, prntSeqNext - n);
        dropped = 0;
      } else if (consoleCursor === null) {
        incremental = true;
        startSeq = Math.max(oldest, prntSeqNext - 50);
        dropped = 0;
      } else {
        incremental = true;
        startSeq = consoleCursor;
        dropped = Math.max(0, oldest - consoleCursor);
      }

      // 过滤器只筛选返回内容：next_seq 仍推进到已扫描末尾，未匹配行留在缓冲里可重放
      const lvl = level ?? 0;
      const picked = prntLog.filter(l =>
        l.seq >= startSeq
        && (lvl === 0 || l.verbosity >= lvl)
        && (!re || re.test(l.text))
        && (!chs || chs.includes(l.channel.toLowerCase()))
      );
      const next_seq = Math.max(prntSeqNext, startSeq);
      if (incremental) consoleCursor = next_seq;
      return ok({
        lines: picked.map(l => `[${l.channel || "?"}][L${l.verbosity}] ${l.text}`).join("\n"),
        count: picked.length,
        next_seq,
        dropped,
      });
    }
  );

  // Tool: 列出当前可用的 VConsole2 通道
  server.tool("console_channels",
    "Use when you need channel names before filtering console_output, or want to see which engine subsystems are logging. Lists the VConsole2 source channels registered by the current Dota 2 session, with a short description for well-known ones. Returns {ok:true,text} with one 'name - description' line per channel, or {ok:false,code,message} with code dota_down/vconsole_closed when there is no live connection. Limits: only channels registered so far are listed — the set grows as the map loads, and results are not cached between calls. Related tools: console_output (channel filter), dota_status (connection state).",
    {},
    READ_ONLY_ANNOTATIONS,
    async () => {
      const blocked = consoleGate();
      if (blocked) return blocked;
      const channels = relay.getChannels();
      const lines = channels.map(name => {
        const desc = channelDescriptions[name];
        return desc ? `${name} - ${desc}` : name;
      });
      return ok({ text: lines.join("\n") || "(no channels registered yet)" });
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
        const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        const meta = fm ? fm[1] : "";
        const body = fm ? fm[2] : raw;
        const name = (meta.match(/^name:\s*(.+)$/m)?.[1] || e.name).trim();
        const description = (meta.match(/^description:\s*(.+)$/m)?.[1] || "").trim();
        out.push({ name, description, body: body.trim() });
      } catch { /* skip */ }
    }
    return out;
  }

  function markdownHeadings(body: string): string[] {
    return body.split(/\r?\n/).map(l => l.match(/^(#{2,3})\s+(.+)$/)?.[2] ?? null).filter((x): x is string => !!x);
  }

  function markdownSection(body: string, section: string): { headings: string[]; candidates: string[]; text: string | null } {
    const lines = body.split(/\r?\n/);
    const parsed = lines.map(l => l.match(/^(#{2,3})\s+(.+)$/));
    const headings = parsed.filter(Boolean).map(m => m![2]);
    const exact = parsed.findIndex(m => m?.[2] === section);
    const candidates = parsed.filter(m => m && m[2].toLowerCase().startsWith(section.toLowerCase())).map(m => m![2]);
    const start = exact !== -1 ? exact : candidates.length === 1 ? parsed.findIndex(m => m?.[2] === candidates[0]) : -1;
    if (start === -1) return { headings, candidates, text: null };
    const level = parsed[start]![1].length;
    const end = parsed.findIndex((m, i) => i > start && !!m && m[1].length <= level);
    return { headings, candidates, text: lines.slice(start, end === -1 ? undefined : end).join("\n") };
  }

  // Tool: 获取内置 skill — 教 agent 怎么用这套 MCP（Roblox skill 模式）
  server.tool("dota2_skill",
    "Retrieve built-in Dota 2 development knowledge without dumping unnecessary context. Call with no argument to list skills, name + outline for a table of contents, then name + section for one '##' or '###' section (for Markdown data, data + section works the same way). For JSON data, use data + data_path to return only a dot-path such as 'e_combos.top10' (numeric array indices also work). name alone returns the full skill; data alone returns the whole data file, so prefer targeted retrieval for large VFX/model references. Learn the runtime development model before testing or editing.",
    {
      name: z.string().optional().describe("Skill name, e.g. 'dota2-runtime-dev'. Omit to list available skills."),
      section: z.string().optional().describe("Exact '##' or '###' heading, or a unique case-insensitive heading prefix (without hashes). With data, selects a section inside that Markdown data file. Requires name."),
      outline: z.boolean().optional().describe("List the skill's section headings instead of content. Requires name."),
      data: z.string().optional().describe("Name of a data file under skills/<name>/data/ (e.g. 'vpcf-stats.json'). Use data='list' to list files. Requires name."),
      data_path: z.string().optional().describe("Dot-separated path inside a JSON data file, e.g. 'e_combos.top10' or 'e_combos.top10.0'. Requires data."),
    },
    async ({ name, section, outline, data, data_path }) => {
      const skills = loadSkills();
      if (skills.length === 0) {
        return { content: [{ type: "text", text: "No built-in skills found (skills/ directory missing)." }] };
      }
      if (!name) {
        const list = skills.map(s => `- ${s.name}: ${s.description}`).join("\n");
        return { content: [{ type: "text", text: `Available skills:\n${list}\n\nPrefer name + outline, then name + section for targeted retrieval. Use name alone only when the full skill is needed.` }] };
      }
      const skill = skills.find(s => s.name === name || s.name === `dota2-${name}`);
      if (!skill) {
        return { content: [{ type: "text", text: `Unknown skill '${name}'. Available: ${skills.map(s => s.name).join(", ")}` }] };
      }
      if (data_path && !data) {
        return { content: [{ type: "text", text: "data_path requires data (the JSON file name)." }] };
      }
      if (data_path && section) {
        return { content: [{ type: "text", text: "Use either section (Markdown) or data_path (JSON), not both." }] };
      }
      const headings = markdownHeadings(skill.body);
      if (outline) {
        return { content: [{ type: "text", text: `Sections of ${skill.name}:\n${headings.map(h => "- " + h).join("\n")}` }] };
      }
      if (section && !data) {
        const result = markdownSection(skill.body, section);
        return { content: [{ type: "text", text: result.text ?? (result.candidates.length > 1
          ? `Ambiguous section '${section}': ${result.candidates.join(", ")}`
          : `Unknown section '${section}'. Sections: ${result.headings.join(", ")}`) }] };
      }
      if (data) {
        const dataDir = path.join(skillsDir(), skill.name, "data");
        let dataFiles: string[] = [];
        try {
          dataFiles = fs.readdirSync(dataDir, { withFileTypes: true })
            .filter(e => e.isFile())
            .map(e => e.name);
        } catch { dataFiles = []; }
        if (data === "list") {
          return { content: [{ type: "text", text: dataFiles.length > 0
            ? `Data files of ${skill.name}:\n${dataFiles.map(f => "- " + f).join("\n")}`
            : `No data files bundled with ${skill.name}.` }] };
        }
        const file = dataFiles.find(f => f === data || f === data + ".json" || f === data + ".md");
        if (!file) {
          return { content: [{ type: "text", text: `Unknown data file '${data}'. Available: ${dataFiles.join(", ") || "(none)"}` }] };
        }
        try {
          const content = fs.readFileSync(path.join(dataDir, file), "utf-8");
          if (section) {
            const result = markdownSection(content, section);
            return { content: [{ type: "text", text: result.text ?? (result.candidates.length > 1
              ? `Ambiguous section '${section}' in ${file}: ${result.candidates.join(", ")}`
              : `Unknown section '${section}' in ${file}. Sections: ${result.headings.join(", ")}`) }] };
          }
          if (data_path) {
            let value: unknown;
            try { value = JSON.parse(content); } catch { return { content: [{ type: "text", text: `data_path requires JSON; ${file} is not JSON.` }] }; }
            for (const part of data_path.split(".").filter(Boolean)) {
              if (Array.isArray(value) && /^\d+$/.test(part)) value = value[Number(part)];
              else if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, part)) value = (value as Record<string, unknown>)[part];
              else return { content: [{ type: "text", text: `Unknown data_path '${data_path}' in ${file} at '${part}'.` }] };
            }
            if (value === undefined) return { content: [{ type: "text", text: `Unknown data_path '${data_path}' in ${file}.` }] };
            return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
          }
          return { content: [{ type: "text", text: content }] };
        } catch (e) {
          return { content: [{ type: "text", text: `Cannot read data file ${file}: ${(e as Error).message}` }] };
        }
      }
      return { content: [{ type: "text", text: skill.body }] };
    }
  );


  /** 从控制台读 sv_cheats；拿不到（无 vconsole / 无回应）返回 null，能力矩阵不做猜测。 */
  async function queryCheats(): Promise<boolean | null> {
    if (!relay.guiConnected) return null;
    const out = await collectOutput("sv_cheats", { waitMs: 1500, settleMs: 100 });
    for (const line of out) {
      const m = line.match(/sv_cheats"?\s*=\s*"?([01])/i);
      if (m) return m[1] === "1";
      if (/^\s*[01]\s*$/.test(line)) return line.trim() === "1";
    }
    return null;
  }

  /** 能力矩阵的可用动作：只列当前事实下真正可执行的工具，与连接/相位指引共用同一套动作名。 */
  function availableActions(f: {
    dota: boolean; dotaReady: boolean; vconsole: boolean;
    loaded: boolean; loading: boolean; gameState: string;
    cheats: boolean | null; hasAddon: boolean;
  }): string[] {
    if (!f.dota) return f.dotaReady && !f.vconsole ? ["dota_open_vconsole"] : [];
    if (!f.vconsole) return ["dota_open_vconsole"];
    if (f.loading) return [];
    if (!f.loaded) return f.hasAddon ? ["dota_launch_game"] : [];
    const preGame = /CUSTOM_GAME_SETUP|HERO_SELECTION|STRATEGY_TIME|TEAM_SHOWCASE|PRE_GAME/.test(f.gameState)
      && !f.gameState.includes("GAME_IN_PROGRESS");
    const actions: string[] = [];
    if (preGame && f.cheats === true) actions.push("dota_advance_to_game");
    actions.push("dota_restart");
    if (f.cheats === true) actions.push("dota_run_lua", "vfx_preview");
    return actions;
  }

  // Tool: 任务入口 — 测试 / 验证 / 调试 Dota 2 自定义游戏（导航型，永不抛异常）
  server.tool("dota_status",
    "Use when you need to know what is possible right now — as the first call when the user asks to test a Dota 2 addon/custom game, check why something does not work in-game, launch a map, or inspect live game state. Reports one capability matrix from live facts: whether the relay is shared through the daemon or running locally, whether vconsole is attached, whether Dota is connected, the game phase, whether sv_cheats is on, the detected addon and map, and the actions valid right now. Returns {ok:true,data:{daemon,vconsole,dota,phase,cheats,addon,map,available_actions},text} — the envelope also carries game_state and maps, and text is a short human-readable summary; it never throws and never returns isError. Limits: every call reads live facts (status_json, plus one sv_cheats query when the console is attached); cheats is null when it cannot be read, map is null and phase is 'unknown' when no map is loaded, and available_actions only lists tools whose prerequisites are met. Related tools: dota_launch_game, dota_advance_to_game, dota_restart, dota_run_lua, vfx_preview, dota_open_vconsole — every available_actions name is a callable tool.",
    {},
    READ_ONLY_ANNOTATIONS,
    async () => {
      // 先收齐事实再产出：所有连接状态走同一矩阵，文本只是摘要，指引与 available_actions 不各说各话
      const dota = relay.dotaConnected;
      const vconsole = relay.guiConnected;
      const connected = dota && vconsole;
      if (connected) startCaptureWatcherOnce();
      const state = connected ? parseGameState(await queryStatusJson(5000)) : parseGameState(null);
      // ADON 帧是 Dota 2 主动推送的，连接刚建立时可能还没到；连上后稍等片刻再读一次
      if (connected && !currentAddon) {
        for (let i = 0; i < 10 && !currentAddon; i++) {
          await new Promise(r => setTimeout(r, 300));
        }
      }
      const addon = resolveAddon();
      const maps = currentMaps.length > 0 ? currentMaps : scanMapsFs(addon);
      const cheats = connected ? await queryCheats() : null;
      const actions = availableActions({
        dota, dotaReady: relay.dotaReady, vconsole,
        loaded: state.loaded, loading: state.loading, gameState: state.game_state,
        cheats, hasAddon: !!addon || maps.length > 0,
      });

      let text: string;
      if (!dota) {
        text = relay.dotaReady && !vconsole
          ? vconsoleGuidanceEn(`Dota 2 is up, but vconsole is not open — and by design the relay does not connect to Dota until vconsole is attached (explicit contract: no window, no connection, no console tools).`)
          : `Dota 2 is not connected. Ensure Dota 2 is running (with -vconsole or -tools). The relay reconnects automatically; if you just restarted Dota 2 and this persists, an old dota2.exe may not have fully exited — kill it completely and start again.

Once connected, call dota_status again.`;
      } else if (!vconsole) {
        text = vconsoleGuidanceEn(`Dota 2 is connected, but vconsole is not open. Console tools require an open vconsole attached to 127.0.0.1:29001 (explicit contract: you can watch the agent's console activity there).`);
      } else if (state.loading) {
        text = "Dota 2 connected; a map is loading. Wait, then call dota_status again or watch console_output.";
      } else if (!state.loaded) {
        text = `Dota 2 connected; no map is loaded. Launch one with dota_launch_game${maps.length > 0 ? ` (available: ${maps.join(", ")})` : ""}.`;
      } else {
        const cheatText = cheats === null ? "unknown" : cheats ? "on" : "off";
        text = `Dota 2 connected: map "${state.map}" is ${state.phase} (${state.game_state}); cheats ${cheatText}. `
          + (actions.length > 0
            ? `Available actions: ${actions.join(", ")}.`
            : "No action is valid until the phase advances — watch console_output.");
      }

      return okPretty({
        data: {
          daemon: relay instanceof RelayClient ? "daemon" : "local",
          vconsole,
          dota,
          phase: state.phase,
          cheats,
          addon: addon ?? null,
          map: state.loaded ? state.map : null,
          available_actions: actions,
          game_state: state.game_state,
          maps,
        },
        text,
      });
    }
  );


  // Tool: 启动游戏（轮询到 GAME_IN_PROGRESS；卡相位返回推进指引）
  server.tool("dota_launch_game",
    "Use to start / run / load a Dota 2 custom game map when the user wants to test or play their addon. Launches the map and polls until the game reaches GAME_IN_PROGRESS; if it gets stuck in a phase (e.g. CUSTOM_GAME_SETUP), returns the phase, how to advance it, and recent errors. To reach a playable game from a stuck pre-game phase, follow with dota_advance_to_game. Call dota_status first to see available maps. Requires an open vconsole (see dota_open_vconsole).",
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

      // 已进入 GAME_IN_PROGRESS 直接返回；已在加载/已加载则不发命令只观察
      const initial = parseGameState(await queryStatusJson(5000));
      if (initial.game_state.includes("GAME_IN_PROGRESS")) {
        return { content: [{ type: "text", text: `Already in game: ${initial.map} (${initial.game_state})` }] };
      }
      // 已加载的是别的地图（如上一局停在 POST_GAME）也要发命令，否则只会干等到卡相位报告
      // 两侧都去目录、只去地图扩展名（名字里可以有点）、忽略大小写再比
      const mapKey = (s: string) => path.basename(s).replace(/\.(vmap|vpk)$/i, "").toLowerCase();
      if (!initial.loading && (!initial.loaded || mapKey(initial.map) !== mapKey(m))) {
        relay.sendCommand(`dota_launch_custom_game ${a} ${m}`);
      }

      const startTime = Date.now();
      let lastState = initial.game_state;
      let lastChangeAt = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        if (!relay.dotaConnected) {
          return { content: [{ type: "text", text: `Dota 2 disconnected while launching. ${disconnectedReasonText()}` }] };
        }
        await new Promise(r => setTimeout(r, 2000));
        const status = await queryStatusJson(5000);
        // 加载重资源时引擎可能数秒不应答（活体实测）：没读到不算相位变化
        if (!status) continue;
        const cur = parseGameState(status);
        if (cur.phase === "menu" && Date.now() - startTime > 15000) {
          return { content: [{ type: "text", text: `Dota 2 is still at the main menu ${Math.round((Date.now() - startTime) / 1000)}s after dota_launch_custom_game ${a} ${m}: the launch did not start. Check console_output (level 1) for why, and dota_screenshot for what the game shows.` }], isError: true };
        }
        if (cur.game_state !== lastState) {
          lastState = cur.game_state;
          lastChangeAt = Date.now();
        }
        if (cur.game_state.includes("GAME_IN_PROGRESS")) {
          return { content: [{ type: "text", text: `Launched and in game: ${a}/${m} (map: ${cur.map}, state: ${cur.game_state})` }] };
        }
        // INIT / WAIT_FOR_* 是加载期（大地图可达数分钟，且 loading 标志此时已为 false），不作卡住判定；
        // 加载真卡死由 timeout 兜底报告（含 ResourceSystem 错误）
        if (!cur.loading && !isLoadingPhase(lastState) && Date.now() - lastChangeAt > 15000) {
          return { content: [{ type: "text", text: buildStuckReport(lastState, Date.now() - lastChangeAt) }] };
        }
      }

      return { content: [{ type: "text", text: buildStuckReport(lastState, timeoutMs) }] };
    }
  );

  // Tool: 标准推进流程——从任一已加载相位推进到带英雄的 GAME_IN_PROGRESS。
  // 只按观测到的 game_state 决定动作，不依赖任何 addon 的实现（活体核对见 Agent Note）：
  // SETUP → 计时清零 + FinishCustomGameSetup；HERO_SELECTION → 无英雄的玩家选英雄；
  // STRATEGY/SHOWCASE → 计时清零；PRE_GAME 仍不走 → ForceGameStart。
  // ForceGameStart 绝不早于 PRE_GAME：英雄在进入 PRE_GAME 时才生成，提前调用得到没有英雄的「游戏中」。
  server.tool("dota_advance_to_game",
    "Use after dota_launch_game or dota_restart, when the game sits in a pre-game phase (CUSTOM_GAME_SETUP, HERO_SELECTION, STRATEGY_TIME, TEAM_SHOWCASE, PRE_GAME), to get to a playable GAME_IN_PROGRESS with a hero for every player in one call. Standard, addon-independent flow driven by the observed game_state: waits out map loading; zeroes the strategy/showcase/pre-game timers (runtime only, for this match); ends custom game setup; picks a hero for each player that has none (random, or `hero`); force-starts only from PRE_GAME, after heroes have spawned. Returns the steps taken and each player's hero, or a stuck report with recent errors. Requires sv_cheats=1 and an open vconsole (see dota_open_vconsole).",
    {
      hero: z.string().regex(/^npc_dota_hero_[a-z0-9_]+$/).optional().describe("Hero for every player, e.g. 'npc_dota_hero_axe' (overrides an existing pick). Default: a random hero for each player that has none."),
      timeout: z.number().optional().describe("Max seconds to wait. Default 120 (map loading counts)."),
    },
    async ({ hero, timeout }) => {
      requireConsole();
      const timeoutMs = Math.max(15, timeout || 120) * 1000;
      const lua = (code: string) => collectLuaOutput(code, { waitMs: 5000, settleMs: 400 });
      const zeroTimers = "GameRules:SetStrategyTime(0) GameRules:SetShowcaseTime(0) GameRules:SetPreGameTime(0)";
      // 单条控制台语句有长度上限（LUA_STATEMENT_MAX_BYTES），下面的 Lua 刻意写短
      // 用玩家控制器选（与随机选同一路径才会结束选人）；PlayerResource:SetSelectedHero 只记名字，相位不推进（活体实测）
      const pick = `local p=P:GetPlayer(i) if p then p:${hero ? `SetSelectedHero('${hero}')` : "MakeRandomHeroSelection()"} end`;
      const steps: string[] = [];
      const done = new Map<string, number>(); // 动作 → 上次执行时刻（同一相位里每 5s 至多重试一次）
      const stepIdx = new Map<string, number>(); // 动作 → 在 steps 里的位置（重试只标注，不重复记）
      const act = async (key: string, desc: string, code: string) => {
        if (Date.now() - (done.get(key) ?? 0) < 5000) return;
        if (!stepIdx.has(key)) stepIdx.set(key, steps.push(desc) - 1);
        else steps[stepIdx.get(key)!] = desc + " (retried)";
        done.set(key, Date.now());
        await lua(code);
      };

      const start = Date.now();
      let state = "";
      let stateSince = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (!relay.dotaConnected) {
          return { content: [{ type: "text", text: `Dota 2 disconnected. ${disconnectedReasonText()}` }] };
        }
        const status = await queryStatusJson(5000);
        if (!status) { await new Promise(r => setTimeout(r, 1000)); continue; } // 引擎加载时可能数秒不应答
        const cur = parseGameState(status);
        if (cur.game_state !== state) { state = cur.game_state; stateSince = Date.now(); }
        if (!cur.loaded && !cur.loading && cur.phase === "menu") {
          return { content: [{ type: "text", text: "No map is loaded. Call dota_launch_game first, then dota_advance_to_game. Call dota_status to see the actions valid right now." }], isError: true };
        }
        if (state.includes("GAME_IN_PROGRESS")) {
          const out = await lua("local P=PlayerResource for i=0,23 do if P:IsValidPlayerID(i) then local h=P:GetSelectedHeroEntity(i) " +
            "print('[MCP-ADV] player '..i..' team='..P:GetTeam(i)..' hero='..tostring(h and h:GetUnitName())) end end");
          const players = out.filter(l => l.startsWith("[MCP-ADV]")).map(l => l.slice(10));
          return { content: [{ type: "text", text: [
            `In game: ${cur.map} (${state}).`,
            steps.length > 0 ? `Steps taken:\n${steps.map(s => "- " + s).join("\n")}` : "Already in progress; nothing to do.",
            players.length > 0 ? `Players:\n${players.join("\n")}` : "No valid players found.",
            ...(players.length > 0 && players.every(p => p.endsWith("hero=nil"))
              ? ["No player has a hero yet. The addon may create heroes itself (for example after its own UI); call dota_screenshot to see what the game shows."] : []),
          ].join("\n") }] };
        }
        if (state.includes("POST_GAME")) {
          return { content: [{ type: "text", text: "Game has ended (POST_GAME). Call dota_restart, then dota_advance_to_game. Call dota_status to see the actions valid right now." }], isError: true };
        }
        if (state.includes("CUSTOM_GAME_SETUP")) {
          await act("setup", "CUSTOM_GAME_SETUP: zeroed phase timers, called GameRules:FinishCustomGameSetup()", `${zeroTimers} GameRules:FinishCustomGameSetup()`);
        } else if (state.includes("HERO_SELECTION")) {
          // 随机只补没选的（不动 addon 已分配的英雄）；显式 hero 覆盖所有玩家
          await act("pick", hero ? `HERO_SELECTION: zeroed phase timers, set ${hero} for every player` : "HERO_SELECTION: zeroed phase timers, picked a random hero for every player without one",
            `${zeroTimers} local P=PlayerResource for i=0,23 do if P:IsValidPlayerID(i)${hero ? "" : " and not P:HasSelectedHero(i)"} then ${pick} end end`);
        } else if (state.includes("STRATEGY_TIME") || state.includes("TEAM_SHOWCASE")) {
          await act("timers", `${state.replace("DOTA_GAMERULES_STATE_", "")}: zeroed phase timers`, zeroTimers);
        } else if (state.includes("PRE_GAME") && Date.now() - stateSince > 3000) {
          // 英雄在进入 PRE_GAME 时已生成；清零后仍未推进才强制开局
          await act("force", "PRE_GAME: called GameRules:ForceGameStart()", "GameRules:ForceGameStart()");
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      const report = buildStuckReport(state, Date.now() - stateSince);
      return { content: [{ type: "text", text: `${report}\n${steps.length > 0 ? `Steps taken:\n${steps.map(s => "- " + s).join("\n")}` : ""}` }], isError: true };
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

  // Tool: 游戏截图（不受 vconsole 门控：截图就是用来排查控制台没反应、画面卡在哪的）
  server.tool("dota_screenshot",
    "Use to see what the Dota 2 game is actually showing — e.g. when a launch or phase seems stuck, console output says nothing, or you need to check UI or visuals. Takes a game screenshot of the Dota 2 game window from outside the game (Windows.Graphics.Capture, no console command), so it works without a console connection, needs no vconsole, and never steals focus. A persistent helper shared across sessions starts when the console first connects to Dota or this tool first runs, and caches the latest frame. If no newer frame is available (including a hung game), it returns that cached image with captured_at and stale: true; if it has never captured a frame, it reports an error instead of substituting another image. hung: true means Windows reports the window as not responding. A minimized window is restored without focus, captured, and minimized again (restore: false to disable). Only the game viewport is captured, never the rest of the screen. After the helper is ready, each call shares a 5 s total deadline for startup, capture, and cleanup; cold compilation is reported separately. Windows only.",
    {
      max_width: z.number().int().min(64).max(7680).optional().describe("Scale the image down to at most this width in pixels. Default 1280."),
      format: z.enum(["jpeg", "png"]).optional().describe("Image format. Default jpeg (quality 80)."),
      restore: z.boolean().optional().describe("Restore a minimized window (without focus) to capture it, then minimize it again. Default true."),
    },
    async ({ max_width, format, restore }) => {
      const fmt = format ?? "jpeg";
      const r = await captureScreenshot({ maxWidth: max_width ?? 1280, format: fmt, restore: restore ?? true, dotaPath });
      return {
        content: r.image
          ? [{ type: "image" as const, data: r.image.data, mimeType: r.image.mimeType }, { type: "text" as const, text: r.text }]
          : [{ type: "text" as const, text: r.text }],
        isError: !r.ok,
      };
    }
  );

  // Tool: 游戏视频录制（同样不受 vconsole 门控；窗口矩形复用截图辅助程序）
  server.tool("dota_record",
    "Use when a single frame is not enough — for example to verify a VFX's motion, timing, or disappearance, or to capture a bug that only appears over time. Records the Dota 2 game window to a video file with FFmpeg's ddagrab (D3D11 desktop duplication), cropping to the window rectangle found by the same Windows window lookup as dota_screenshot; it sends no console command, needs no vconsole, and never steals focus. Returns {ok:true,data:{path,duration_s,fps,width,height,bytes},text} with the saved file and its metadata, or {ok:false,code,message} with code ffmpeg_missing (no FFmpeg binary), no_window (Dota 2 is not running, has no window, or is minimized), empty_capture (FFmpeg produced no frames), timeout, or internal. Limits: duration is clamped to 1–30 s, fps defaults to 30, Windows only; capture assumes the game window is on the primary monitor and unobstructed, and the recordings directory keeps no retention limit. Related tools: dota_screenshot (single frame), dota_status (is Dota 2 running), vfx_preview (spawn the effect to record).",
    {
      duration: z.number().describe("Recording length in seconds, clamped to 1–30."),
      fps: z.number().int().min(1).max(240).optional().describe("Capture frame rate. Default 30."),
      output: z.string().optional().describe("Output file path. Relative paths resolve against the recordings directory. Default dota-<timestamp>.mp4 there."),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ duration, fps, output }) => recordVideo({ duration, fps, output })
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
      const exe = consoleBridge.resolveDotaToolPath(dotaPath, "vconsole2");
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
    "Use to quickly reload / restart the current map after changing Lua, KV, or Panorama files, so the user can re-test without relaunching manually. Returns once the reload has begun; follow with dota_advance_to_game to get back to a playable game. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    {},
    async () => {
      requireConsole();
      const before = parseGameState(await queryStatusJson(5000)).game_state;
      relay.sendCommand("restart");
      // restart 不是立即生效：在它生效前读到的仍是旧相位，紧随其后的 dota_advance_to_game 会误判「已在游戏中」
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, Math.min(500, Math.max(0, deadline - Date.now()))));
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const cur = parseGameState(await queryStatusJson(Math.min(5000, remaining)));
        if (cur.loading || cur.game_state !== before) {
          return { content: [{ type: "text", text: `Restarting current map (now ${cur.loading ? "loading" : cur.game_state}). Next: dota_advance_to_game.` }] };
        }
      }
      return { content: [{ type: "text", text: `Sent restart, but the game state did not change within 20s (still ${before}). Check dota_status / console_output.` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // 调试 & 状态检查工具
  // ═══════════════════════════════════════════════════════════════

  function filterDumpLines(out: string[], filter?: string): string[] {
    const q = filter?.toLowerCase();
    return q ? out.filter(l => l.toLowerCase().includes(q)) : out;
  }

  // Tool: 列出所有实体
  server.tool("dota_dump_entities",
    "Use to inspect live game state while debugging — lists entities currently in the scene (heroes, units, thinkers) to verify spawns, positions, or whether an entity exists at all. Use filter to avoid the full dump. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    { filter: z.string().optional().describe("Case-insensitive substring; keep only matching entity report lines, e.g. 'npc_dota_hero' or 'phoenix'. Empty = full dump.") },
    async ({ filter }) => {
      requireConsole();
      const out = filterDumpLines(await collectOutput("dump_entity_report", { waitMs: 5000, settleMs: 300 }), filter);
      return { content: [{ type: "text", text: out.join("\n") || (filter ? `No entity report lines match '${filter}'.` : "Sent. Use console_output.") }] };
    }
  );

  // Tool: 列出所有 modifier
  server.tool("dota_dump_modifiers",
    "Use to debug buffs/debuffs/modifiers while testing — dumps active modifiers on entities (server, default) or all registered modifier types (client, usually large) to verify an ability applied its modifier correctly. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    {
      side: z.enum(["server","client"]).optional().describe("server = active modifiers on entities (default); client = all registered modifier types."),
      filter: z.string().optional().describe("Case-insensitive substring; keep only matching lines, e.g. 'modifier_phoenix' or a hero name. Empty = full dump."),
    },
    async ({ side, filter }) => {
      requireConsole();
      const s = side ?? "server";
      const cmd = s === "server" ? "dota_modifier_dump" : "cl_dump_modifier_list";
      const out = filterDumpLines(await collectOutput(cmd, { waitMs: 3000, settleMs: 300 }), filter);
      return { content: [{ type: "text", text: out.join("\n") || (filter ? `No modifier lines match '${filter}'.` : "(no results)") }] };
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
      const out = await collectOutput(`${cmd} ${entity}`, { waitMs: 3000, settleMs: 300 });
      return { content: [{ type: "text", text: out.join("\n") || "(no data)" }] };
    }
  );

  // Tool: 监控游戏事件
  // ═══════════════════════════════════════════════════
  // API 文档工具 — 全部走控制台实时查询，用户已逐个验证
  // ═══════════════════════════════════════════════════

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

  /** 只解析本次命令窗口内收到的输出：无回应返回 null，绝不回落到历史日志（那里是过期状态） */
  async function queryStatusJson(waitMs = 5000): Promise<Record<string, any> | null> {
    return extractLastStatusJson(await collectOutput("status_json", { waitMs, settleMs: 150 }));
  }

  /** 收集一条控制台命令的输出：`echo <begin>; <cmd>; echo <end>` 作为一个 CMND 发出（整条原子执行，
   * 其他会话的命令插不进来），只收两标记之间的行，隔离其他会话与游戏自身的打印。
   * 契约：收到结束标记即返回——命令若把输出推迟到 echo 之后（下一帧才执行的命令），那部分会被截掉；
   * 这类命令改用 collectLuaOutput。settleMs：收到首批输出后静默这么久即返回（结束标记没到时的兜底）。 */
  function collectOutput(cmd: string, opts: { waitMs?: number; settleMs?: number } = {}): Promise<string[]> {
    return collectBetweenMarkers((begin, end) => `echo ${begin}; ${cmd}; echo ${end}`, opts);
  }

  /** collectLuaOutput 的稳定失败：长度上限与 sv_cheats 关闭由三个 Lua/VFX 工具映射成错误码。
   *  仍继承 McpError，非契约调用方（如 dota_advance_to_game）保持原有 InvalidRequest 行为。 */
  class LuaChannelError extends McpError {
    constructor(readonly toolCode: "lua_too_long" | "cheats_off", readonly plainMessage: string) {
      super(ErrorCode.InvalidRequest, plainMessage);
    }
  }

  /** 三个 Lua/VFX 工具的收集入口：契约失败映射成 fail envelope，其余错误继续上抛。 */
  async function collectLuaWindow(luaBody: string): Promise<string[] | ToolResult> {
    try {
      return await collectLuaOutput(luaBody, { waitMs: 15000, settleMs: 400 });
    } catch (e) {
      if (e instanceof LuaChannelError) return fail(e.toolCode, e.plainMessage);
      throw e;
    }
  }

  /** 在服务端 Lua 里执行代码并收集输出。ent_fire RunScriptCode 下一帧才执行，晚于 relay 包在命令外的
   * `ai_disabled` 屏蔽窗口，所以 Lua 自己打印 `ai_disabled = …` 开关行（relay 按这种行切换 GUI 屏蔽）
   * 和结束标记。xpcall 保证运行时报错也会打印收尾开关与结束标记（否则 GUI 屏蔽卡死在开启态）；
   * 语法错误时整段都不执行，靠 settleMs 兜底。双引号换成单引号，避免与 RunScriptCode 参数的引号冲突。
   * 引擎静默丢弃超过 LUA_STATEMENT_MAX_BYTES 的单条控制台语句（活体实测），超长直接报错而不是返回空结果。 */
  async function collectLuaOutput(luaBody: string, opts: { waitMs?: number; settleMs?: number } = {}): Promise<string[]> {
    const code = luaBody.replace(/"/g, "'");
    const toggle = relay.mcpSuppressEnabled ? "print('ai_disabled =') " : "";
    const statement = (end: string) =>
      `ent_fire 0 RunScriptCode "${toggle}xpcall(function() ${code} end, function(e) print(debug.traceback(e)) end) print('${end}') ${toggle}"`;
    const bytes = Buffer.byteLength(statement(newMcpMarkers().end), "utf8");
    if (bytes > LUA_STATEMENT_MAX_BYTES) {
      throw new LuaChannelError("lua_too_long", `Lua too long: ${bytes} bytes after wrapping, but the Dota console drops any single statement over ${LUA_STATEMENT_MAX_BYTES} bytes. Shorten the code (about ${LUA_STATEMENT_MAX_BYTES - (bytes - Buffer.byteLength(code, "utf8"))} bytes are available), split it into several calls, or put it in an addon script and call that.`);
    }
    const out = await collectBetweenMarkers((begin, end) => `echo ${begin}; ${statement(end)}`, opts);
    // sv_cheats 关闭时引擎不执行 ent_fire，只打印这一行（活体实测）
    if (out.some(l => l.includes("Cheat command 'ent_fire' ignored"))) {
      throw new LuaChannelError("cheats_off", "The Lua did not run: the engine ignored ent_fire because sv_cheats is off. Lua-based tools run server Lua through ent_fire, which is a cheat command. Run console_send 'sv_cheats 1' and try again; if sv_cheats keeps switching off, the addon itself is turning it off and needs a development exception.");
    }
    return out;
  }

  async function collectBetweenMarkers(buildCmd: (begin: string, end: string) => string, opts: { waitMs?: number; settleMs?: number }): Promise<string[]> {
    const { waitMs = 3000, settleMs } = opts;
    const r = relay; // respawn 会替换 relay，off 必须落在同一个对象上
    const { begin, end } = newMcpMarkers();
    const collected: string[] = [];
    let inside = false;
    let finishEarly: (() => void) | null = null;
    const onPrnt = (msg: any) => {
      const text = String(msg.text).trim();
      if (text === begin) { inside = true; return; }
      if (text === end) { finishEarly?.(); return; }
      if (inside) collected.push(msg.text);
    };
    r.on("prnt", onPrnt);
    r.sendCommand(buildCmd(begin, end));

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
        r.off("prnt", onPrnt);
        resolve(collected);
      };
      finishEarly = finish;

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
    game_state: string;
    phase: string;
    players: number;
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
        game_state: "(unknown)", phase: "unknown",
        players: 0,
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
      game_state: state || "(unknown)",
      phase,
      players: (server.clients_human as number) ?? 0,
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

  // 这些引擎命令忽略查询参数、总是全量转储；按条目边界过滤，不能把几百 KB 原文塞给 agent。
  function filterDumpBlocks(out: string[], query: string, nameOf: (line: string) => string | null): string {
    const blocks: Array<{ name: string; lines: string[] }> = [];
    let current: { name: string; lines: string[] } | null = null;
    for (const line of out) {
      const name = nameOf(line);
      if (name) {
        current = { name, lines: [line] };
        blocks.push(current);
      } else if (current) {
        current.lines.push(line);
      }
    }
    if (blocks.length === 0) return out.join("\n"); // 保留引擎错误等非转储输出
    const q = query.toLowerCase();
    const exact = blocks.filter(b => {
      const name = b.name.toLowerCase();
      return name === q || name.startsWith(q + ":");
    });
    const matches = exact.length > 0 ? exact : blocks.filter(b => b.name.toLowerCase().includes(q));
    if (matches.length === 0) return `No entry matching '${query}'. Omit the query for the full dump.`;
    return matches.map(b => b.lines.join("\n").trim()).join("\n\n");
  }

  const equalsDumpName = (line: string) => line.match(/^===\s*(.+?)\s*===\s*$/)?.[1] ?? null;

  // Tool: Lua API（服务端 + 客户端）
  server.tool("dota_api_lua",
    "Use to look up a Dota 2 Lua API function or class signature while writing server-side script — e.g. 'what args does CreateUnitByName take' or 'what methods does CDOTA_BaseNPC have'. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    { func: z.string().optional().describe("Function/class name. Empty=full dump."), side: z.enum(["server","client"]).optional().describe("server or client. Default server.") },
    async ({ func, side }) => {
      requireConsole();
      const s = side ?? "server";
      const cmd = s === "client" ? "cl_script_help2" : "script_help2";
      const out = await collectOutput(func ? `${cmd} ${func}` : cmd, { waitMs: 3000, settleMs: 300 });
      const text = func
        ? filterDumpBlocks(out, func, l => l.match(/---\[\[\s*([^\s\]]+)/)?.[1] ?? null)
        : out.join("\n");
      return { content: [{ type: "text", text: text || "(no results)" }] };
    }
  );

  // Tool: Panorama JS API
  server.tool("dota_api_panorama_js",
    "Use to look up Panorama JS API enums/classes (GameUI, CustomUIElement, $) while writing custom HUD / UI for the custom game. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    { name: z.string().optional().describe("Enum/class name. Empty=full list.") },
    async ({ name }) => {
      requireConsole();
      const out = await collectOutput(name ? `cl_panorama_script_help_2 ${name}` : "cl_panorama_script_help_2", { waitMs: 3000, settleMs: 300 });
      const text = name ? filterDumpBlocks(out, name, equalsDumpName) : out.join("\n");
      return { content: [{ type: "text", text: text || "(no results)" }] };
    }
  );

  // Tool: Panorama CSS 属性
  server.tool("dota_api_css",
    "Use to look up a Panorama CSS property (e.g. wash-color, blur) with description and examples while styling the custom game's UI. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    { prop: z.string().optional().describe("CSS property name, e.g. 'wash-color'. Empty=all 128.") },
    async ({ prop }) => {
      requireConsole();
      const out = await collectOutput(prop ? `dump_panorama_css_properties ${prop}` : "dump_panorama_css_properties", { waitMs: 3000, settleMs: 300 });
      const text = prop ? filterDumpBlocks(out, prop, equalsDumpName) : out.join("\n");
      return { content: [{ type: "text", text: text || "(no results)" }] };
    }
  );

  // Tool: Panorama Panel 事件
  server.tool("dota_api_events",
    "Use to look up Panorama panel event handlers (e.g. SetPanelSelected, onactivate) and their signatures while wiring UI interactions. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    { event: z.string().optional().describe("Event name, e.g. 'SetPanelSelected'. Empty=all events.") },
    async ({ event }) => {
      requireConsole();
      const out = await collectOutput(event ? `dump_panorama_events ${event}` : "dump_panorama_events", { waitMs: 3000, settleMs: 300 });
      const text = event
        ? filterDumpBlocks(out, event, l => l.match(/^\|\s*<code>([A-Za-z0-9_]+)\s*\(/)?.[1] ?? null)
        : out.join("\n");
      return { content: [{ type: "text", text: text.split("\n").filter(l => !/^\s*(?:\|-|\|})\s*$/.test(l)).join("\n") || "(no results)" }] };
    }
  );

  // --- 调试工具（服务端 + 客户端） ---

  // Tool: 搜索所有 5248 个 console 指令/cvar
  server.tool("console_find",
    "Use to discover a Dota 2 console command or convar when you don't know its exact name — e.g. find a cheat, a debug flag, or a launch option. Use prefixes like 'dota_', 'sv_', 'cl_' to narrow. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    { query: z.string().describe("Search keyword") },
    async ({ query }) => {
      requireConsole();
      const out = await collectOutput(`find ${query}`, { waitMs: 3000, settleMs: 250 });
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
      const out = await collectOutput(`help ${command}`, { waitMs: 3000, settleMs: 250 });
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

  // Tool: 查询 Lua 脚本作用域
  server.tool("dota_api_help",
    "Use to inspect a Dota 2 Lua class/scope (script_help), e.g. 'CDOTAGameRules'. This command accepts scopes, not global functions: use dota_api_lua for CreateUnitByName and other function signatures. Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).",
    { query: z.string().optional().describe("Class/scope name, e.g. 'CDOTAGameRules'. Empty = list available scopes.") },
    async ({ query }) => {
      requireConsole();
      const out = await collectOutput(query ? `script_help ${query}` : "script_help", { waitMs: 4000, settleMs: 300 });
      return { content: [{ type: "text", text: out.join("\n") || "Sent. Use console_output to see results." }] };
    }
  );

  // Tool: 在运行中的游戏里执行 Lua 代码
  server.tool("dota_run_lua",
    "Use when you need to run server-side Lua in the live game while testing — verify a function works, inspect a value, spawn a unit, or reproduce a bug without editing files and reloading. 'expression' evaluates and prints a value (DeepPrintTable for tables, plain values directly); 'code' runs statements. Returns {ok:true,lines,count,next_seq,dropped}: lines is the captured Lua output as one newline-joined string, count is its number of lines, and next_seq/dropped describe the shared console window without moving this session's console_output cursor (pass next_seq to console_output as since_seq to continue explicitly). Failures return {ok:false,code,message} with lua_too_long (the message reports the bytes still available), cheats_off (sv_cheats is off), dota_down, or vconsole_closed. Limits: one console statement of at most 510 bytes after wrapping — code over about 300 bytes is usually rejected, so keep snippets short or put the logic in an addon script; requires sv_cheats=1 and an open vconsole attached to 127.0.0.1:29001 (see dota_open_vconsole), because Lua-based tools run through ent_fire, a cheat command. Related tools: dota_advance_to_game (standard phase flow), vfx_preview (spawn particles), console_output (read the full console), console_send (send console commands).",
    {
      code: z.string().optional().describe("Arbitrary Lua statements to run. Use single quotes inside to avoid shell escaping issues."),
      expression: z.string().optional().describe("Lua expression to evaluate and print, e.g. 'GameRules:State_Get()'. Tables use DeepPrintTable; numbers, strings, booleans and nil print directly."),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ code, expression }) => {
      const blocked = consoleGate();
      if (blocked) return blocked;

      let luaBody: string;
      if (expression) {
        luaBody = `print('[MCP-LUA] IsServer: ' .. tostring(IsServer())) local v=(${expression}) if type(v)=='table' then DeepPrintTable(v) else print('[MCP-LUA] '..tostring(v)) end`;
      } else if (code) {
        luaBody = `print('[MCP-LUA] IsServer: ' .. tostring(IsServer())) ${code}`;
      } else {
        return fail("invalid_arg", "Provide either 'code' or 'expression'.");
      }

      const startSeq = prntSeqNext;
      const execOut = await collectLuaWindow(luaBody);
      if (!Array.isArray(execOut)) return execOut;
      const cursor = windowCursor(startSeq);

      const markerIdx = execOut.findIndex(l => l.includes("[MCP-LUA] IsServer"));
      if (markerIdx === -1) {
        const fallback = execOut.filter(l =>
          l.includes("[MCP-LUA]") || l.includes("DeepPrint") || l.includes("RunScriptCode") || /^\s*\d+\s*=/.test(l) || /error/i.test(l)
        );
        const lines = fallback.length > 0 ? fallback.join("\n") : "Sent. Check console_output for results.";
        return ok({ lines, count: lines.split("\n").length, ...cursor });
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
              const lines = execOut.slice(markerIdx, i + 1).join("\n");
              return ok({ lines, count: lines.split("\n").length, ...cursor });
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
      const lines = block.join("\n");
      return ok({ lines, count: block.length, ...cursor });
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // Workshop Tools 集成 — 启动编辑器 / 编译资源
  // ═══════════════════════════════════════════════════════════════

  /** Dota 2 工具完整路径解析（共享实现见 console-bridge，直接调用） */

  /** 执行 Dota 2 工具目录下的可执行文件。
   *
   * - waitForExit = true：等待进程退出并收集 stdout/stderr。
   * - waitForExit = false：在进程成功启动后立即返回 PID；
   *   如果启动失败（如可执行文件不存在）则返回 ok=false。
   * 调用前需确保 dotaPath 非空（dota_compile_asset 已检查）。
   */
  function runDotaTool(exeBase: string, args: string[], waitForExit = false): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    const exePath = consoleBridge.resolveDotaToolPath(dotaPath!, exeBase);
    // WSL 下 win64 目录命中 = Windows 安装：参数里的 /mnt/ 路径必须转成 Windows 路径
    const isWinTool = process.platform !== "win32" && path.basename(path.dirname(exePath)) === "win64";
    const finalArgs = isWinTool ? args.map((a) => consoleBridge.toWindowsPath(a)) : args;
    return new Promise((resolve) => {
      const proc = spawn(exePath, finalArgs, {
        detached: !waitForExit,
        windowsHide: false,
        env: scrubbedEnv(),
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
      const a = requireAddon(addon);

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


  // Tool: 确保 VRF CLI（Source2Viewer-CLI）可用（离线安全：仅缺失时联网下载）
  server.tool("vrf_ensure",
    `Ensure the ValveResourceFormat CLI (Source2Viewer-CLI) is available for asset inspection. Returns the cached path, or downloads the pinned release (default v${DEFAULT_VERSION}, self-contained, no .NET runtime needed), verifies its sha256, and caches under os.tmpdir()/dota2-mcp/vrf/. Offline-safe: touches the network only when the CLI is missing. Used automatically by asset_inspect and asset_check_refs.`,
    {
      version: z.string().optional().describe(`Pin a VRF release version. Default ${DEFAULT_VERSION} (VRF_VERSION env overrides).`),
    },
    async ({ version }) => {
      const info = await ensureVrf({ version });
      return { content: [{ type: "text", text: info.message }] };
    }
  );


  // Tool: 反编译 + 结构化摘要单个资产（VRF CLI，离线）
  server.tool("asset_inspect",
    "Decompile and structurally summarize a single Source 2 asset (offline; no game needed). Uses the VRF CLI (Source2Viewer-CLI, auto-installed by vrf_ensure). Returns a stable JSON summary keyed by asset type: vpcf (particle system/emitter/operator counts, child and material refs, max particles), vmdl (mesh count, material refs, LOD group, skeleton ref), vmat (shader, texture refs, param count), vtex (PNG dimensions). Unknown types pass through the decompiled text. raw_decompiled is omitted unless include_raw=true (then truncated to 4000 chars). Single-level references only: recursive reference walking is asset_check_refs' job.",
    {
      target: z.string().describe("Asset to inspect (absolute, or content/ / game/ prefixed, or addon-content relative)"),
      addon: z.string().optional().describe("Addon name. Auto-detected if omitted."),
      include_raw: z.boolean().optional().describe("Include the raw decompiled text (truncated to 4000 chars). Default false."),
    },
    async ({ target, addon, include_raw }) => {
      if (!dotaPath) throw new McpError(ErrorCode.InvalidRequest, dotaPathNotDetectedText());
      const a = requireAddon(addon);
      const resolved = resolveAssetPath(target, a);
      const result = await inspectAsset(dotaPath, resolved, { includeRaw: include_raw ?? false });
      return { content: [{ type: "text", text: result.text }], isError: !result.ok };
    }
  );


  // Tool: 单资产递归引用完整性检查（VRF CLI，离线）
  server.tool("asset_check_refs",
    "Recursively check one asset's reference chain for integrity (offline; no game needed). Decompiles with the VRF CLI and walks asset refs (vmdl→vmat→vtex, vpcf→vmat→vtex) up to max_depth (default 3, visited-set cycle guard). Two-level resolution per ref: inside the addon (content source + compiled game output) → then game/dota (engine assets, reported as engine_refs). Reports four buckets: ok, uncompiled (source exists but compiled output missing — did you forget to compile?), engine_refs (legit engine assets, depth not walked), broken (not found anywhere).",
    {
      target: z.string().describe("Asset to check (absolute, or content/ / game/ prefixed, or addon-content relative)"),
      addon: z.string().optional().describe("Addon name. Auto-detected if omitted."),
      max_depth: z.number().int().min(0).max(10).optional().describe("Max reference chain depth. Default 3."),
    },
    async ({ target, addon, max_depth }) => {
      if (!dotaPath) throw new McpError(ErrorCode.InvalidRequest, dotaPathNotDetectedText());
      const a = requireAddon(addon);
      const resolved = resolveAssetPath(target, a);
      const result = await checkRefs(dotaPath, a, resolved, { maxDepth: max_depth ?? 3 });
      return { content: [{ type: "text", text: result.text }], isError: !result.ok };
    }
  );


  // ===== VFX 预览：运行时粒子实例（继承 dota_run_lua 门控；资产创建/删除走 file_write/file_delete）=====

  const PATTACH_NAMES = ["PATTACH_ABSORIGIN", "PATTACH_ABSORIGIN_FOLLOW", "PATTACH_CUSTOMORIGIN", "PATTACH_CUSTOMORIGIN_FOLLOW", "PATTACH_POINT", "PATTACH_POINT_FOLLOW", "PATTACH_EYES_FOLLOW", "PATTACH_OVERHEAD_FOLLOW", "PATTACH_WORLDORIGIN", "PATTACH_ROOTBONE_FOLLOW", "PATTACH_RENDERORIGIN_FOLLOW", "PATTACH_MAIN_VIEW", "PATTACH_WATERWAKE", "PATTACH_CENTER_FOLLOW", "PATTACH_CUSTOM_GAME_STATE_1", "PATTACH_HEALTHBAR"];

  server.tool("vfx_preview",
    "Use when you want to see a particle effect in the running game without wiring it into an ability or unit — spawn it, look at it with dota_screenshot, then destroy it. Spawns a runtime particle instance via ParticleManager:CreateParticle through the dota_run_lua channel (it is NOT an asset file — create/edit/delete .vpcf sources with file_write/file_edit/file_delete) and returns the instance id. Returns {ok:true,lines,count,next_seq,dropped}: lines is the captured '[MCP-VFX]' output plus a precache verdict where one applies, count is its number of lines, and next_seq/dropped describe the shared console window without moving this session's console_output cursor; failures return {ok:false,code,message} with precache_missing when the path is an addon asset that no PrecacheResource in scripts/vscripts names (the client then draws nothing even though CreateParticle returns a valid id), cheats_off, dota_down, or vconsole_closed. Limits: the client only draws particles precached at map load, so add the PrecacheResource entry and reload the map (a runtime PrecacheResource call leaves the client without the asset); position only affects systems that bind control point 0; requires a running game, sv_cheats=1, and an open vconsole attached to 127.0.0.1:29001. Related tools: vfx_preview_stop (destroy the instance), dota_screenshot (confirm the effect), console_output (read Particles/ResourceSystem errors), dota2_skill with name 'dota2-vfx' (recipes and silent-drop traps).",
    {
      particle_path: z.string().describe("Particle path relative to content root, e.g. 'particles/basic_explosion/basic_explosion.vpcf'"),
      attach: z.number().int().min(0).max(15).optional().describe("ParticleAttachment_t value. Default 8 (PATTACH_WORLDORIGIN)."),
      position: z.array(z.number()).length(3).optional().describe("World position [x,y,z] for control point 0 (only meaningful with world-origin attaches)."),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ particle_path, attach, position }) => {
      const blocked = consoleGate();
      if (blocked) return blocked;
      const attachIdx = attach ?? 8;
      const attachName = PATTACH_NAMES[attachIdx] ?? "PATTACH_WORLDORIGIN";
      const pathSafe = particle_path.replace(/'/g, "");
      const posLua = position
        ? " ParticleManager:SetParticleControl(pid, 0, Vector(" + position.join(",") + ")) "
        : " ";
      const luaBody = "print('[MCP-VFX] IsServer: ' .. tostring(IsServer())) local pid = ParticleManager:CreateParticle('" + pathSafe + "', " + attachName + ", nil)" + posLua + " print('[MCP-VFX] pid=' .. tostring(pid) .. ' attach=" + attachName + "')";
      const startSeq = prntSeqNext;
      const execOut = await collectLuaWindow(luaBody);
      if (!Array.isArray(execOut)) return execOut;
      const note = dotaPath ? particlePrecacheNote(dotaPath, process.env.DOTA2_TEST_ADDON ?? resolveAddon() ?? null, pathSafe) : "";
      const body = execOut.filter((l) => l.includes("[MCP-VFX]") || /error|failed|missing/i.test(l));
      // 引擎资产不受 addon Precache 约束；只有 addon 内资产缺声明才是"画不出来"的根因
      if (note.startsWith("precache: MISSING")) {
        return fail("precache_missing", [body.join("\n"), note].filter(Boolean).join("\n"));
      }
      const lines = [body.join("\n"), note].filter(Boolean).join("\n") || "Sent. Read console_output (channels Particles/ResourceSystem) for load errors.";
      return ok({ lines, count: lines.split("\n").length, ...windowCursor(startSeq) });
    }
  );

  server.tool("vfx_preview_stop",
    "Use when a particle spawned by vfx_preview should stop — after taking the screenshot or when it is cluttering the test. Destroys one runtime particle instance by id (it does not touch asset files and does not unload the precache). Returns {ok:true,lines,count,next_seq,dropped}: lines contains '[MCP-VFX] destroyed pid=N' and count is its number of lines, because DestroyParticle returns nothing and the call never reports a nil return value; next_seq/dropped describe the shared console window without moving this session's console_output cursor. Failures return {ok:false,code,message} with cheats_off, dota_down, or vconsole_closed. Limits: needs a running game, sv_cheats=1, and an open vconsole attached to 127.0.0.1:29001; the id must come from this game session's vfx_preview call. Related tools: vfx_preview (spawn the instance), console_output (read full console output), dota_screenshot (confirm the effect disappeared).",
    {
      particle_id: z.number().int().min(0).describe("Particle id returned by vfx_preview"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ particle_id }) => {
      const blocked = consoleGate();
      if (blocked) return blocked;
      const luaBody = "print('[MCP-VFX] destroy pid=' .. tostring(" + particle_id + ")) ParticleManager:DestroyParticle(" + particle_id + ", false) print('[MCP-VFX] destroyed pid=" + particle_id + "')";
      const startSeq = prntSeqNext;
      const execOut = await collectLuaWindow(luaBody);
      if (!Array.isArray(execOut)) return execOut;
      const body = execOut.filter((l) => l.includes("[MCP-VFX]") || /error|failed/i.test(l));
      const lines = body.join("\n") || "Sent. Check console_output for errors.";
      return ok({ lines, count: lines.split("\n").length, ...windowCursor(startSeq) });
    }
  );

  // ===== FileOps：addon 内文件读写编辑删除（离线工具，不门控）=====

  /** 解析 FileOps 目标路径并校验边界。
   *  - content/ 或 game/ 开头：相对于 dotaPath
   *  - 其他：默认 content/dota_addons/{addon}/...
   *  - 解析结果必须落在 content/dota_addons/{addon}/ 或 game/dota_addons/{addon}/ 内（防 ../ 逃逸）
   */
  function resolveFileOpsPath(target: string, addon: string): string {
    const lower = target.toLowerCase().replace(/\\/g, "/");
    const resolved = (lower.startsWith("content/") || lower.startsWith("game/"))
      ? path.join(dotaPath!, target)
      : path.join(dotaPath!, "content", "dota_addons", addon, target);
    const normalized = path.resolve(resolved);
    const bases = [
      path.resolve(dotaPath!, "content", "dota_addons", addon),
      path.resolve(dotaPath!, "game", "dota_addons", addon),
    ];
    const inside = bases.some((b) => normalized === b || normalized.startsWith(b + path.sep));
    if (!inside) {
      throw new McpError(ErrorCode.InvalidRequest,
        `Path outside addon '${addon}': ${target}. Allowed roots: content/dota_addons/${addon}/ and game/dota_addons/${addon}/ (start target with content/ or game/).`);
    }
    return normalized;
  }

  /** 工具层 addon 解析：显式参数 > relay 检测 > DOTA2_TEST_ADDON > 文件系统唯一推断。
   *  addon 必须是单个目录名：它参与拼接路径边界，含 .. 或分隔符会让边界本身逃逸 */
  function requireAddon(addon?: string): string {
    const fromEnv = process.env.DOTA2_TEST_ADDON;
    const a = resolveAddon(addon) ?? (fromEnv ? fromEnv : null);
    if (a) {
      if (a === "." || a === ".." || /[\\/:]/.test(a)) {
        throw new McpError(ErrorCode.InvalidRequest, `Invalid addon name '${a}': must be a single directory name under dota_addons/.`);
      }
      return a;
    }
    const addons = listAddonsFs();
    throw new McpError(ErrorCode.InvalidRequest, addons.length > 1
      ? `No addon detected. Specify the addon name or one of: ${addons.join(", ")}`
      : "No addon detected. Load a project first or specify the addon name.");
  }

  const FILEOPS_MAX_BYTES = 5 * 1024 * 1024;

  server.tool("file_read",
    "Read a text file inside the current Dota 2 addon. Offline tool: no game or vconsole required. Target can start with content/ or game/ (relative to the Dota 2 install), or be relative to the addon content dir. Paths outside content/dota_addons/{addon}/ and game/dota_addons/{addon}/ are rejected.",
    {
      target: z.string().describe("File path inside the addon"),
      addon: z.string().optional().describe("Addon name. Auto-detected if omitted."),
    },
    async ({ target, addon }) => {
      if (!dotaPath) throw new McpError(ErrorCode.InvalidRequest, dotaPathNotDetectedText());
      const a = requireAddon(addon);
      const resolved = resolveFileOpsPath(target, a);
      try {
        const stat = fs.statSync(resolved);
        if (stat.size > FILEOPS_MAX_BYTES) {
          throw new McpError(ErrorCode.InvalidRequest, `File too large (${stat.size} bytes, max ${FILEOPS_MAX_BYTES}). Use asset_inspect for binary assets.`);
        }
        const content = fs.readFileSync(resolved, "utf8");
        return { content: [{ type: "text", text: content }] };
      } catch (e) {
        if (e instanceof McpError) throw e;
        throw new McpError(ErrorCode.InvalidRequest, `Cannot read ${resolved}: ${(e as Error).message}`);
      }
    }
  );

  server.tool("file_write",
    "Write (create or overwrite) a text file inside the current Dota 2 addon. Offline tool: no game or vconsole required. Same path rules as file_read; parent directories are created.",
    {
      target: z.string().describe("File path inside the addon"),
      content: z.string().describe("Full UTF-8 content to write"),
      addon: z.string().optional().describe("Addon name. Auto-detected if omitted."),
    },
    async ({ target, content, addon }) => {
      if (!dotaPath) throw new McpError(ErrorCode.InvalidRequest, dotaPathNotDetectedText());
      const a = requireAddon(addon);
      const resolved = resolveFileOpsPath(target, a);
      try {
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, content, "utf8");
        return { content: [{ type: "text", text: `Wrote ${resolved} (${Buffer.byteLength(content, "utf8")} bytes)` }] };
      } catch (e) {
        throw new McpError(ErrorCode.InvalidRequest, `Cannot write ${resolved}: ${(e as Error).message}`);
      }
    }
  );

  server.tool("file_edit",
    "Replace one occurrence of old_string with new_string in a file inside the current Dota 2 addon. Offline tool. old_string must appear exactly once (report counts when not), so ambiguous edits fail loudly.",
    {
      target: z.string().describe("File path inside the addon"),
      old_string: z.string().describe("Exact text to replace (must appear exactly once)"),
      new_string: z.string().describe("Replacement text (may be empty to delete)"),
      addon: z.string().optional().describe("Addon name. Auto-detected if omitted."),
    },
    async ({ target, old_string, new_string, addon }) => {
      if (!dotaPath) throw new McpError(ErrorCode.InvalidRequest, dotaPathNotDetectedText());
      const a = requireAddon(addon);
      const resolved = resolveFileOpsPath(target, a);
      try {
        const content = fs.readFileSync(resolved, "utf8");
        const count = content.split(old_string).length - 1;
        if (count === 0) throw new McpError(ErrorCode.InvalidRequest, `old_string not found in ${resolved}`);
        if (count > 1) throw new McpError(ErrorCode.InvalidRequest, `old_string appears ${count} times in ${resolved}; make it unique before editing`);
        // 函数形式：字符串替换参数会展开 $' $& $1 等特殊序列
        fs.writeFileSync(resolved, content.replace(old_string, () => new_string), "utf8");
        return { content: [{ type: "text", text: `Edited ${resolved} (1 replacement)` }] };
      } catch (e) {
        if (e instanceof McpError) throw e;
        throw new McpError(ErrorCode.InvalidRequest, `Cannot edit ${resolved}: ${(e as Error).message}`);
      }
    }
  );

  server.tool("file_delete",
    "Delete a file inside the current Dota 2 addon. Offline tool. Returns a short snapshot of the deleted content so the deletion is auditable.",
    {
      target: z.string().describe("File path inside the addon"),
      addon: z.string().optional().describe("Addon name. Auto-detected if omitted."),
    },
    async ({ target, addon }) => {
      if (!dotaPath) throw new McpError(ErrorCode.InvalidRequest, dotaPathNotDetectedText());
      const a = requireAddon(addon);
      const resolved = resolveFileOpsPath(target, a);
      try {
        const snapshot = fs.readFileSync(resolved, "utf8").slice(0, 500);
        fs.unlinkSync(resolved);
        return { content: [{ type: "text", text: `Deleted ${resolved}\n--- snapshot (first 500 chars) ---\n${snapshot}` }] };
      } catch (e) {
        throw new McpError(ErrorCode.InvalidRequest, `Cannot delete ${resolved}: ${(e as Error).message}`);
      }
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

/**
 * VCon 透明代理 + Dota 2 连接持有者
 *
 * 启动即主动连接 Dota 2 :29000 并常驻持有（断线每 2s 重连，不依赖 GUI）。
 * vconsole2 连 :29001 获得透明转发（可选，纯观察者）。
 *
 * ```
 * vconsole2 ──→ :29001 (relay) ──→ :29000 (Dota 2)
 *                │
 *                └── MCP 可注入 CMND，可读取 PRNT
 * ```
 */

import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { VConClient, PrntMessage, AinfMessage } from "./vcon-bridge.js";
import { pidPath } from "../daemon-utils.js";

const DEFAULT_DOTA_PORT = 29000;  // Dota 2 VCon 端口
const DEFAULT_GUI_PORT = 29001;   // VConsole2 GUI 连接端口
const DEFAULT_CTRL_PORT = 29002;  // MCP 控制端口
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 无客户端连接 5 分钟后自动退出
const PROTOCOL_VERSION = 1;

/** 连接建立时 Dota 推送的初始化帧类型，按到达顺序缓存，重放给晚接入的 GUI */
const INIT_FRAME_TYPES = new Set(["AINF", "CHAN", "CVRB", "CFGV", "ADON"]);

function parsePort(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

const DOTA_PORT = parsePort("DOTA2_VCON_DOTA_PORT", DEFAULT_DOTA_PORT);
const GUI_PORT = parsePort("DOTA2_VCON_GUI_PORT", DEFAULT_GUI_PORT);
const CTRL_PORT = parsePort("DOTA2_VCON_CTRL_PORT", DEFAULT_CTRL_PORT);

/** 瘦客户端连接状态 */
interface ClientConn {
  sock: net.Socket;
  buffer: string;
  streaming: boolean;
}

export class VConRelay extends EventEmitter {
  private dotaClient: VConClient | null = null;
  private guiServer!: net.Server;
  private guiSocket: net.Socket | null = null;
  private prntBuffer: string[] = [];
  _prntLog: { text: string; verbosity: number; channel: string }[] = [];
  private _dotaConnected = false;
  private _guiConnected = false;
  private _addonName = "";
  private _maps: string[] = [];      // addoninfo.txt 中的官方地图
  private _allMaps: string[] = [];   // maps/ 目录下所有 .vmap
  private _ainf: any = null;
  private _dotaPath: string | null = null;
  private _channels = new Map<number, string>(); // channelId (from CHAN.id / PRNT.channelCRC) -> name
  /** 当前 Dota 连接的初始化帧缓存（每次新连接重建），重放给晚接入的 GUI */
  private _initFrames: Buffer[] = [];
  private _guiSuppressPatterns: string[] = [];
  /** MCP 命令包装标记：把命令包在 `ai_disabled; ...; ai_disabled` 中一次性发给 Dota，
   * 标记之间的输出不转发到 GUI。使用官方 cvar `ai_disabled` 的响应行
   * `ai_disabled = false` / `ai_disabled = true` 作为标记。 */
  private _mcpMarker = "ai_disabled =";
  private _mcpMarkerSuppress = false;
  private _mcpSuppressEnabled = true;

  // 守护进程模式新增
  private clients = new Set<ClientConn>();
  private idleTimer: NodeJS.Timeout | null = null;
  private expectedToken: string | null = null;
  private portConflict = false;
  /** close() 后不再重连 Dota 2 */
  private _closed = false;
  /** 仅守护进程模式启用空闲退出（内嵌为本地 relay 时本进程是 MCP server，不能退出） */
  private idleExitEnabled = false;

  /** 设置 Dota 2 根目录（由 detectDotaPath() 提供），用于地图扫描 */
  setDotaPath(p: string | null): void {
    this._dotaPath = p;
  }

  /** 守护进程模式下设置期望的 token（瘦客户端 HELLO 校验） */
  setExpectedToken(token: string): void {
    this.expectedToken = token;
  }

  /** 守护进程调用：启用无客户端空闲 5 分钟自动退出。本地内嵌模式绝不能调用 */
  enableIdleExit(): void {
    this.idleExitEnabled = true;
    this._resetIdleTimer();
  }

  get dotaConnected() { return this._dotaConnected; }
  get guiConnected() { return this._guiConnected; }
  get guiSuppressPatterns(): string[] { return [...this._guiSuppressPatterns]; }
  get mcpSuppressEnabled(): boolean { return this._mcpSuppressEnabled; }
  /** 端口被占用（守护进程模式下另一个实例在跑） */
  get portInUse(): boolean { return this.portConflict; }

  /** 设置/清空要阻止转发到 vconsole2 GUI 的 PRNT 正则模式（MCP 仍可通过 prnt 事件读取） */
  setGuiSuppressPatterns(patterns: string[]): void {
    this._guiSuppressPatterns = [...patterns];
    console.error("[relay] GUI suppress patterns:", this._guiSuppressPatterns.join(", ") || "(none)");
  }

  /** 开关 MCP 命令输出的 GUI 屏蔽（默认开启） */
  setMcpSuppressEnabled(enabled: boolean): void {
    this._mcpSuppressEnabled = enabled;
    console.error("[relay] MCP output GUI suppress:", enabled ? "enabled" : "disabled");
  }

  async start(): Promise<void> {
    this.guiServer = net.createServer((sock) => this._onGuiConnect(sock));
    this.guiServer.on("error", (e: any) => {
      if (e.code === "EADDRINUSE") {
        this.portConflict = true;
        console.error(`[relay] GUI port ${GUI_PORT} in use — another instance is running`);
      } else {
        console.error("[relay] GUI server error:", e.message);
      }
    });
    this.guiServer.listen(GUI_PORT, "127.0.0.1", () => {
      console.error(`[relay] GUI :${GUI_PORT}, waiting vconsole2...`);
    });

    // 控制端口 — MCP 通过这个端口发命令、读输出
    const ctrlServer = net.createServer((sock) => this._onCtrlConnect(sock));
    ctrlServer.on("error", (e: any) => {
      if (e.code === "EADDRINUSE") {
        this.portConflict = true;
        console.error(`[relay] Control port ${CTRL_PORT} in use — another instance is running`);
      } else {
        console.error("[relay] ctrl server error:", e.message);
      }
    });
    ctrlServer.listen(CTRL_PORT, "127.0.0.1", () => {
      console.error(`[relay] Control :${CTRL_PORT}`);
    });

    this._resetIdleTimer();

    // 启动即主动连接 Dota 2（不等 vconsole2 GUI 触发），断线自动重连
    this._connectDota();
  }

  sendCommand(cmd: string): void {
    if (this._mcpSuppressEnabled) {
      this.dotaClient?.sendCommand(`ai_disabled; ${cmd}; ai_disabled`);
    } else {
      this.dotaClient?.sendCommand(cmd);
    }
  }

  getRecentOutput(n = 50): string[] {
    return this.prntBuffer.slice(-n);
  }

  /** 返回当前已注册的 VConsole2 通道名列表 */
  getChannels(): string[] {
    return Array.from(new Set(this._channels.values())).sort();
  }

  close(): void {
    this._closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.dotaClient?.close();
    this.guiSocket?.destroy();
    this.guiServer?.close();
    for (const c of this.clients) c.sock.destroy();
  }

  // ---- 守护进程：空闲计时 ----

  private _resetIdleTimer(): void {
    if (!this.idleExitEnabled) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.clients.size === 0 && !this._guiConnected) {
        console.error("[relay] idle timeout, exiting");
        this._cleanupStateFiles();
        process.exit(0);
      }
      this._resetIdleTimer();
    }, IDLE_TIMEOUT_MS);
  }

  /** 空闲退出前清理 PID 文件，避免下次启动走 stale 检测。token 保留复用。 */
  private _cleanupStateFiles(): void {
    try {
      const f = pidPath();
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch { /* ignore */ }
  }

  // ---- 守护进程：瘦客户端连接 ----

  private _onCtrlConnect(sock: net.Socket): void {
    const conn: ClientConn = { sock, buffer: "", streaming: false };
    sock.on("error", (e: Error) => console.error("[relay] ctrl error:", e.message));
    sock.on("data", (data: Buffer) => {
      conn.buffer += data.toString();
      let idx: number;
      while ((idx = conn.buffer.indexOf("\n")) !== -1) {
        const line = conn.buffer.slice(0, idx).trim();
        conn.buffer = conn.buffer.slice(idx + 1);
        if (line) this._handleCtrlLine(conn, line);
      }
    });
    sock.on("close", () => {
      this.clients.delete(conn);
      this._resetIdleTimer();
    });
  }

  private _handleCtrlLine(conn: ClientConn, text: string): void {
    // 握手（新协议）
    if (text.startsWith("HELLO")) {
      const token = text.slice(5).trim() || null;
      if (this.expectedToken && token !== this.expectedToken) {
        conn.sock.write(JSON.stringify({ type: "hello-err", reason: "bad token" }) + "\n");
        conn.sock.destroy();
        return;
      }
      this.clients.add(conn);
      this._resetIdleTimer();
      conn.sock.write(JSON.stringify({
        type: "hello-ok",
        version: PROTOCOL_VERSION,
        dota: this._dotaConnected,
        gui: this._guiConnected,
        addon: this._addonName,
        maps: this._maps,
        allMaps: this._allMaps,
      }) + "\n");
      return;
    }

    // 设置 token 后，未完成握手的连接禁止使用任何命令（防本机未认证进程
    // 绕过 HELLO 直接 CMD: 注入，RunScriptCode 等于 RCE）。
    if (this.expectedToken && !this.clients.has(conn)) {
      conn.sock.write(JSON.stringify({ type: "hello-err", reason: "handshake required" }) + "\n");
      return;
    }

    // 以下命令要求已完成握手（在 clients 集合中）或旧协议直通
    if (text === "STATUS") {
      conn.sock.write(JSON.stringify({
        dota: this._dotaConnected,
        gui: this._guiConnected,
        addon: this._addonName,
        maps: this._maps,
        allMaps: this._allMaps,
      }) + "\n");
    } else if (text === "STREAM") {
      conn.streaming = true;
    } else if (text === "SHUTDOWN") {
      if (this.clients.size === 0) {
        console.error("[relay] SHUTDOWN requested, exiting");
        process.exit(0);
      }
    } else if (text.startsWith("SETMCPSUPPRESS:")) {
      this.setMcpSuppressEnabled(text.slice(15) === "1");
    } else if (text.startsWith("CMD:")) {
      let cmd = text.slice(4);
      if (cmd.startsWith("dota_launch_custom_game") && this._addonName) {
        const parts = cmd.split(/\s+/);
        if (parts.length === 2 && parts[1] && !parts[1].startsWith("-")) {
          cmd = `dota_launch_custom_game ${this._addonName} ${parts[1]}`;
          console.error("[relay] Auto-addon:", cmd);
        }
        if (parts.length === 1 && this._maps.length > 0) {
          cmd = `dota_launch_custom_game ${this._addonName} ${this._maps[0]}`;
          console.error("[relay] Auto-all:", cmd);
        }
      }
      this.sendCommand(cmd);
      conn.sock.write("OK\n");
    } else if (text.startsWith("TAIL:")) {
      const n = parseInt(text.slice(5)) || 20;
      conn.sock.write(this.getRecentOutput(n).join("\n") + "\n");
    } else if (text === "FILTERS") {
      conn.sock.write(JSON.stringify({ patterns: this._guiSuppressPatterns }) + "\n");
    } else if (text.startsWith("SETFILTERS:")) {
      try {
        const patterns = JSON.parse(text.slice(11));
        if (Array.isArray(patterns)) {
          this.setGuiSuppressPatterns(patterns.map(String));
          conn.sock.write("OK\n");
        } else {
          conn.sock.write("ERR: expected array\n");
        }
      } catch (e: any) {
        conn.sock.write("ERR: " + e.message + "\n");
      }
    } else {
      // 旧协议直通
      this.sendCommand(text);
      conn.sock.write("OK\n");
    }
  }

  /** 向所有订阅了 STREAM 的瘦客户端推送 JSON 行 */
  private _broadcast(obj: any): void {
    const line = JSON.stringify(obj) + "\n";
    for (const c of this.clients) {
      if (c.streaming && !c.sock.destroyed) {
        c.sock.write(line);
      }
    }
  }

  private _scanMaps(): void {
    if (!this._addonName || !this._dotaPath) return;

    // 同时扫描 maps/ 目录下的所有 .vmap（完整可用地图）
    const mapsDir = path.join(this._dotaPath, "content", "dota_addons", this._addonName, "maps");
    try {
      const entries = fs.readdirSync(mapsDir, { withFileTypes: true });
      this._allMaps = entries
        .filter((e) => e.isFile() && e.name.endsWith(".vmap"))
        .map((e) => e.name.replace(".vmap", ""));
    } catch {
      this._allMaps = [];
    }

    // 优先从 addoninfo.txt 读取作者声明的正式地图列表
    const addonInfoMaps = this._readAddonInfoMaps();
    this._maps = addonInfoMaps.length > 0 ? addonInfoMaps : this._allMaps;
  }

  /** 从 addoninfo.txt 解析 maps 数组 */
  private _readAddonInfoMaps(): string[] {
    if (!this._dotaPath) return [];
    const candidates = [
      path.join(this._dotaPath, "game", "dota_addons", this._addonName, "addoninfo.txt"),
      path.join(this._dotaPath, "content", "dota_addons", this._addonName, "addoninfo.txt"),
    ];

    for (const filePath of candidates) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const maps = this._parseKv3StringArray(content, "maps");
        if (maps.length > 0) return maps;
      } catch {
        // continue to next candidate
      }
    }
    return [];
  }

  /** 简单解析 KV3 中的字符串数组：key = [ "a", "b" ] */
  private _parseKv3StringArray(content: string, key: string): string[] {
    const regex = new RegExp(`${key}\\s*=\\s*\\[([^\\]]*)\\]`, "s");
    const match = content.match(regex);
    if (!match) return [];
    const items: string[] = [];
    const stringRegex = /"([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = stringRegex.exec(match[1])) !== null) {
      items.push(m[1]);
    }
    return items;
  }

  // ---- internal ----

  private _onGuiConnect(sock: net.Socket): void {
    this.guiSocket = sock;
    this._guiConnected = true;
    console.error("[relay] vconsole2 connected");
    // 晚接入的 GUI：先重放初始化帧（AINF/CHAN/CVRB/CFGV/ADON），否则拿不到
    // 通道表/cvar/addon 信息，窗口是空壳（已实测验证）
    for (const f of this._initFrames) sock.write(f);
    if (this._initFrames.length > 0) {
      console.error(`[relay] replayed ${this._initFrames.length} init frames to vconsole2`);
    }

    // vconsole2 → Dota 2：按 VCon 帧边界重组后再转发。
    // TCP 不保证一个 data 事件就是一帧，半帧直接 rawWrite 会让 Dota 2 协议错乱。
    let guiBuffer: Buffer = Buffer.alloc(0);
    sock.on("data", (data: Buffer) => {
      if (!this._dotaConnected || !this.dotaClient) return;
      guiBuffer = Buffer.concat([guiBuffer, data]);
      // 按 12 字节帧头里的 length 字段切出完整帧
      while (guiBuffer.length >= 12) {
        const frameLen = guiBuffer.readUInt32BE(6);
        if (frameLen < 12 || guiBuffer.length < frameLen) break; // 半帧，等下一个 data
        const frame = guiBuffer.subarray(0, frameLen);
        this.dotaClient.rawWrite(frame);
        guiBuffer = guiBuffer.subarray(frameLen);
      }
      // 防御：buffer 异常膨胀（GUI 发了非 VCon 数据）时清空重同步
      if (guiBuffer.length > 1024 * 1024) {
        console.error("[relay] GUI buffer overflow, resyncing");
        guiBuffer = Buffer.alloc(0);
      }
    });

    sock.on("close", () => {
      this._guiConnected = false;
      this.guiSocket = null;
      // 不再随 GUI 断开释放 :29000：relay 常驻持有 Dota 连接，MCP 工具不依赖 GUI
      console.error("[relay] vconsole2 disconnected");
      this._resetIdleTimer();
    });

    sock.on("error", (e: Error) => console.error("[relay] GUI:", e.message));
  }

  private _connectDota(): void {
    if (this.dotaClient || this._closed) return; // already connected/connecting (or shut down)

    this.dotaClient = new VConClient({
      port: DOTA_PORT,
      rawPrntEditor: (msg) => {
        const text = msg.text.trim();
        // MCP 标记之间的输出：静默丢弃，不转发 GUI
        if (this._mcpMarkerSuppress) return false;
        // MCP 标记行本身也不转发（ai_disabled = false / ai_disabled = true）
        if (this._mcpSuppressEnabled && text.startsWith(this._mcpMarker)) return false;
        // 用户手动设置的额外规则
        if (this._guiSuppressPatterns.length > 0) {
          const matched = this._guiSuppressPatterns.find(p => {
            try { return new RegExp(p).test(msg.text); } catch { return false; }
          });
          if (matched) return false;
        }
        return true;
      },
    });

    this.dotaClient.on("connected", () => {
      this._dotaConnected = true;
      this._mcpMarkerSuppress = false;
      this._initFrames = [];
      console.error("[relay] Dota 2 connected");
      this._broadcast({ type: "status", dota: true, gui: this._guiConnected });
    });

    this.dotaClient.on("rawFrame", (type: string, rawData: Buffer) => {
      if (INIT_FRAME_TYPES.has(type)) this._initFrames.push(rawData);
      if (this.guiSocket && !this.guiSocket.destroyed) {
        this.guiSocket.write(rawData);
      }
    });

    this.dotaClient.on("prnt", (msg: PrntMessage) => {
      const text = msg.text.trim();
      // MCP 标记行：切换屏蔽状态，标记本身不进入缓冲区，也不转发给 MCP/GUI
      if (this._mcpSuppressEnabled && text.startsWith(this._mcpMarker)) {
        this._mcpMarkerSuppress = !this._mcpMarkerSuppress;
        return;
      }

      const channelName = this._channels.get(msg.channelCRC) || "";
      const enhanced = { ...msg, channel: channelName };
      this.prntBuffer.push(msg.text);
      this._prntLog.push({ text: msg.text, verbosity: msg.verbosity, channel: channelName });
      if (this.prntBuffer.length > 500) { this.prntBuffer.shift(); this._prntLog.shift(); }
      // 转发给 MCP server，实现事件驱动（包括被 GUI 屏蔽的 MCP 命令输出）
      this.emit("prnt", enhanced);
      // 广播给瘦客户端
      this._broadcast({ type: "prnt", text: msg.text, verbosity: msg.verbosity, channel: channelName });
    });

    this.dotaClient.on("adon", (a) => {
      this._addonName = a.addonName;
      this._scanMaps();
      console.error("[relay] Addon:", a.addonName, "Maps:", this._maps.join(", "), "AllMaps:", this._allMaps.join(", "));
      this.emit("adon", a);
      this._broadcast({ type: "adon", addonName: a.addonName, maps: this._maps, allMaps: this._allMaps });
    });

    this.dotaClient.on("chan", (channels) => {
      for (const c of channels) {
        this._channels.set(c.id, c.name);
      }
      console.error("[relay] Channels:", channels.map(c => `${c.id}:${c.name}`).join(", "));
      this.emit("chan", channels);
      this._broadcast({ type: "chan", channels: this.getChannels() });
    });

    this.dotaClient.on("ainf", (a) => {
      this._ainf = a;
      console.error("[relay] Game:", a.productName, "CmdLine:", a.commandLine);
      this.emit("ainf", a);
    });

    this.dotaClient.on("close", () => {
      this._dotaConnected = false;
      this._mcpMarkerSuppress = false;
      this.dotaClient = null;
      this._broadcast({ type: "status", dota: false, gui: this._guiConnected });
      if (!this._closed) {
        console.error("[relay] Dota 2 disconnected, retrying in 2s...");
        setTimeout(() => this._connectDota(), 2000);
      }
    });

    this.dotaClient.on("error", (e: Error) => {
      console.error("[relay] Dota error:", e.message);
      this._mcpMarkerSuppress = false;
      this.dotaClient = null;
      if (!this._closed) {
        setTimeout(() => this._connectDota(), 2000);
      }
    });

    this.dotaClient.connect().catch(() => {
      this.dotaClient = null;
      if (!this._closed) {
        setTimeout(() => this._connectDota(), 2000);
      }
    });
  }
}

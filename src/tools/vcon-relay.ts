/**
 * VCon 透明代理 — vconsole2 连上来时才去连 Dota 2
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

const DEFAULT_DOTA_PORT = 29000;  // Dota 2 VCon 端口
const DEFAULT_GUI_PORT = 29001;   // VConsole2 GUI 连接端口
const DEFAULT_CTRL_PORT = 29002;  // MCP 控制端口

function parsePort(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

const DOTA_PORT = parsePort("DOTA2_VCON_DOTA_PORT", DEFAULT_DOTA_PORT);
const GUI_PORT = parsePort("DOTA2_VCON_GUI_PORT", DEFAULT_GUI_PORT);
const CTRL_PORT = parsePort("DOTA2_VCON_CTRL_PORT", DEFAULT_CTRL_PORT);

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
  private _guiSuppressPatterns: string[] = [];
  /** MCP 命令包装标记：把命令包在 `ai_disabled; ...; ai_disabled` 中一次性发给 Dota，
   * 标记之间的输出不转发到 GUI。使用官方 cvar `ai_disabled` 的响应行
   * `ai_disabled = false` / `ai_disabled = true` 作为标记。 */
  private _mcpMarker = "ai_disabled =";
  private _mcpMarkerSuppress = false;
  private _mcpSuppressEnabled = true;

  /** 设置 Dota 2 根目录（由 detectDotaPath() 提供），用于地图扫描 */
  setDotaPath(p: string | null): void {
    this._dotaPath = p;
  }

  get dotaConnected() { return this._dotaConnected; }
  get guiConnected() { return this._guiConnected; }
  get guiSuppressPatterns(): string[] { return [...this._guiSuppressPatterns]; }
  get mcpSuppressEnabled(): boolean { return this._mcpSuppressEnabled; }

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
    this.guiServer.listen(GUI_PORT, "127.0.0.1", () => {
      console.error(`[relay] GUI :${GUI_PORT}, waiting vconsole2...`);
    });

    // 控制端口 — MCP 通过这个端口发命令、读输出
    const ctrlServer = net.createServer((sock) => {
      sock.on("error", (e: Error) => console.error("[relay] ctrl error:", e.message));
      sock.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (text === "STATUS") {
          sock.write(JSON.stringify({
            dota: this._dotaConnected,
            gui: this._guiConnected,
            addon: this._addonName,
            maps: this._maps,
            allMaps: this._allMaps,
          }) + "\n");
        } else if (text.startsWith("CMD:")) {
          let cmd = text.slice(4);
          if (cmd.startsWith("dota_launch_custom_game") && this._addonName) {
            const parts = cmd.split(/\s+/);
            // Only map given: dota_launch_custom_game <map>
            if (parts.length === 2 && parts[1] && !parts[1].startsWith("-")) {
              cmd = `dota_launch_custom_game ${this._addonName} ${parts[1]}`;
              console.error("[relay] Auto-addon:", cmd);
            }
            // No args at all: auto-pick first map
            if (parts.length === 1 && this._maps.length > 0) {
              cmd = `dota_launch_custom_game ${this._addonName} ${this._maps[0]}`;
              console.error("[relay] Auto-all:", cmd);
            }
          }
          this.sendCommand(cmd);
          sock.write("OK\n");
        } else if (text.startsWith("TAIL:")) {
          const n = parseInt(text.slice(5)) || 20;
          sock.write(this.getRecentOutput(n).join("\n") + "\n");
        } else if (text === "FILTERS") {
          sock.write(JSON.stringify({ patterns: this._guiSuppressPatterns }) + "\n");
        } else if (text.startsWith("SETFILTERS:")) {
          try {
            const patterns = JSON.parse(text.slice(11));
            if (Array.isArray(patterns)) {
              this.setGuiSuppressPatterns(patterns.map(String));
              sock.write("OK\n");
            } else {
              sock.write("ERR: expected array\n");
            }
          } catch (e: any) {
            sock.write("ERR: " + e.message + "\n");
          }
        } else {
          this.sendCommand(text);
          sock.write("OK\n");
        }
      });
    });
    ctrlServer.listen(CTRL_PORT, "127.0.0.1", () => {
      console.error(`[relay] Control :${CTRL_PORT} (STATUS|CMD:xxx|TAIL:50|FILTERS|SETFILTERS:[...])`);
    });
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
    this.dotaClient?.close();
    this.guiSocket?.destroy();
    this.guiServer?.close();
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
    console.error("[relay] vconsole2 connected, connecting to Dota 2...");

    // 按需连接 Dota 2：VConsole2 连上 relay 时才去占 :29000
    this._connectDota();

    // vconsole2 → Dota 2
    sock.on("data", (data: Buffer) => {
      if (this._dotaConnected && this.dotaClient) {
        this.dotaClient.rawWrite(data);
      }
    });

    sock.on("close", () => {
      this._guiConnected = false;
      this.guiSocket = null;
      console.error("[relay] vconsole2 disconnected, releasing Dota 2 connection");
      // VConsole2 断开后释放 Dota 2 的 :29000，让 Dota 2 认为 VConsole2 已关闭，
      // 从而可以从 Dota 2 快捷键重新启动 VConsole2。
      this.dotaClient?.close();
      this.dotaClient = null;
      this._dotaConnected = false;
    });

    sock.on("error", (e: Error) => console.error("[relay] GUI:", e.message));
  }

  private _connectDota(): void {
    if (this.dotaClient) return; // already connected/connecting

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
      console.error("[relay] Dota 2 connected");
    });

    this.dotaClient.on("rawFrame", (_type: string, rawData: Buffer) => {
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
    });

    this.dotaClient.on("adon", (a) => {
      this._addonName = a.addonName;
      this._scanMaps();
      console.error("[relay] Addon:", a.addonName, "Maps:", this._maps.join(", "), "AllMaps:", this._allMaps.join(", "));
      this.emit("adon", a);
    });

    this.dotaClient.on("chan", (channels) => {
      for (const c of channels) {
        this._channels.set(c.id, c.name);
      }
      console.error("[relay] Channels:", channels.map(c => `${c.id}:${c.name}`).join(", "));
      this.emit("chan", channels);
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
      // 只有在 VConsole2 还连着时才需要自动重连；否则释放 :29000
      if (this._guiConnected) {
        console.error("[relay] Dota 2 disconnected, retrying in 2s...");
        setTimeout(() => this._connectDota(), 2000);
      } else {
        console.error("[relay] Dota 2 disconnected, no VConsole2 attached");
      }
    });

    this.dotaClient.on("error", (e: Error) => {
      console.error("[relay] Dota error:", e.message);
      this._mcpMarkerSuppress = false;
      this.dotaClient = null;
      if (this._guiConnected) {
        setTimeout(() => this._connectDota(), 2000);
      }
    });

    this.dotaClient.connect().catch(() => {
      this.dotaClient = null;
      if (this._guiConnected) {
        setTimeout(() => this._connectDota(), 2000);
      }
    });
  }
}

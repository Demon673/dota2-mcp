/**
 * Relay 客户端 — 瘦客户端模式下的 relay 代理。
 *
 * 实现 VConRelay 的公共接口子集（sendCommand / getRecentOutput / getChannels /
 * setGuiSuppressPatterns / setMcpSuppressEnabled / dotaConnected / guiConnected /
 * guiSuppressPatterns / mcpSuppressEnabled），通过 :29002 控制端口与真正的 relay
 * 守护进程通信。index.ts 无需改动即可在守护进程模式下工作。
 *
 * 断线后自动重连：socket 关闭时按退避重试，直到重新握手成功。
 */

import * as net from "net";
import { EventEmitter } from "events";

export interface RelayClientConfig {
  port: number;
  token: string | null;
}

const MAX_BUFFER = 1024 * 1024; // 1MB，超过则丢弃（防 relay 异常刷数据撑爆内存）
const MAX_LINE = 256 * 1024;    // 单行上限，超过截断

export class RelayClient extends EventEmitter {
  private sock: net.Socket | null = null;
  private buffer = "";
  private connected = false;
  private _dotaConnected = false;
  private _guiConnected = false;
  private _mcpSuppressEnabled = true;
  private _guiSuppressPatterns: string[] = [];
  private channels: string[] = [];
  private prntBuffer: string[] = [];
  private port: number;
  private token: string | null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private destroyed = false;
  /** 断线期间缓冲的命令，重连成功后补发（上限 100 条防堆积） */
  private pendingCommands: string[] = [];
  /** hello-ok 中携带的 addon/maps（瘦客户端模式下 _maps 等私有字段不可用，走这里） */
  addonName = "";
  maps: string[] = [];
  allMaps: string[] = [];

  constructor(config: RelayClientConfig) {
    super();
    this.port = config.port;
    this.token = config.token;
  }

  get dotaConnected() { return this._dotaConnected; }
  get guiConnected() { return this._guiConnected; }
  get mcpSuppressEnabled() { return this._mcpSuppressEnabled; }
  get guiSuppressPatterns(): string[] { return [...this._guiSuppressPatterns]; }

  async connect(): Promise<void> {
    return this._connect();
  }

  private _connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.destroyed) { reject(new Error("client destroyed")); return; }
      this.sock = new net.Socket();
      this.sock.connect(this.port, "127.0.0.1", () => {
        const hello = this.token ? `HELLO ${this.token}` : "HELLO";
        this.sock!.write(hello + "\n");
      });
      this.sock.on("data", (data: Buffer) => this._onData(data));
      this.sock.on("error", (e: Error) => {
        if (!this.connected) {
          reject(e);
        } else {
          // 已连接后出错（如 daemon 重启）：不往外抛 error 事件
          // （EventEmitter 对无监听的 error 会 throw），只走 close → 自动重连。
          // 记录到 stderr 供排查，但对 MCP 调用方透明。
          console.error("[relay-client] connection lost:", e.message);
        }
      });
      this.sock.on("close", () => {
        const wasConnected = this.connected;
        this.connected = false;
        this._dotaConnected = false;
        this._guiConnected = false;
        this.emit("close");
        if (wasConnected && !this.destroyed) this._scheduleReconnect();
      });

      const onHello = (msg: any) => {
        if (msg.type === "hello-ok") {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.off("hello", onHello);
          this._dotaConnected = !!msg.dota;
          this._guiConnected = !!msg.gui;
          this.addonName = msg.addon || "";
          this.maps = msg.maps || [];
          this.allMaps = msg.allMaps || [];
          this.sock!.write("STREAM\n");
          // 补发断线期间缓冲的命令
          for (const c of this.pendingCommands) this.sock!.write(`CMD:${c}\n`);
          this.pendingCommands = [];
          resolve();
        } else if (msg.type === "hello-err") {
          this.off("hello", onHello);
          reject(new Error(`relay rejected: ${msg.reason}`));
        }
      };
      this.on("hello", onHello);
    });
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer || this.destroyed) return;
    // 指数退避，封顶 5s
    const delay = Math.min(500 * Math.pow(1.5, this.reconnectAttempts), 5000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect().catch(() => {
        // 重连失败会继续触发 close → _scheduleReconnect
      });
    }, delay);
  }

  /** 主动断开并不再重连 */
  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.sock?.destroy();
  }

  private _onData(data: Buffer): void {
    this.buffer += data.toString();
    // 单行过长或 buffer 超限：丢弃，防内存被异常数据撑爆
    if (this.buffer.length > MAX_BUFFER) {
      const lastNl = this.buffer.lastIndexOf("\n");
      this.buffer = lastNl === -1 ? "" : this.buffer.slice(lastNl + 1);
    }
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length > MAX_LINE) line = line.slice(0, MAX_LINE);
      this._handleLine(line);
    }
  }

  private _handleLine(line: string): void {
    if (!line) return;
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }

    switch (msg.type) {
      case "hello-ok":
      case "hello-err":
        this.emit("hello", msg);
        break;
      case "status":
        this._dotaConnected = !!msg.dota;
        this._guiConnected = !!msg.gui;
        break;
      case "prnt":
        this.prntBuffer.push(msg.text);
        if (this.prntBuffer.length > 10000) this.prntBuffer.shift();
        this.emit("prnt", { text: msg.text, verbosity: msg.verbosity ?? 0, channel: msg.channel ?? "" });
        break;
      case "adon":
        this.addonName = msg.addonName || this.addonName;
        this.maps = msg.maps || this.maps;
        this.allMaps = msg.allMaps || this.allMaps;
        this.emit("adon", { addonName: msg.addonName });
        break;
      case "chan":
        this.channels = msg.channels || [];
        break;
    }
  }

  /** 发送命令。断线期间缓冲，重连后补发（对调用方无感）。 */
  sendCommand(cmd: string): void {
    if (this.connected && this.sock) {
      this.sock.write(`CMD:${cmd}\n`);
    } else {
      this.pendingCommands.push(cmd);
      if (this.pendingCommands.length > 100) this.pendingCommands.shift();
    }
  }

  getRecentOutput(n = 50): string[] {
    return this.prntBuffer.slice(-n);
  }

  getChannels(): string[] {
    return [...this.channels];
  }

  setGuiSuppressPatterns(patterns: string[]): void {
    this._guiSuppressPatterns = [...patterns];
    if (this.connected && this.sock) this.sock.write(`SETFILTERS:${JSON.stringify(patterns)}\n`);
  }

  setMcpSuppressEnabled(enabled: boolean): void {
    this._mcpSuppressEnabled = enabled;
    if (this.connected && this.sock) this.sock.write(`SETMCPSUPPRESS:${enabled ? "1" : "0"}\n`);
  }
}

/**
 * Relay 客户端 — 瘦客户端模式下的 relay 代理。
 *
 * 实现 VConRelay 的公共接口子集（sendCommand / getRecentOutput / getChannels /
 * setGuiSuppressPatterns / setMcpSuppressEnabled / dotaConnected / guiConnected /
 * guiSuppressPatterns / mcpSuppressEnabled），通过 :29002 控制端口与真正的 relay
 * 守护进程通信。index.ts 无需改动即可在守护进程模式下工作。
 */

import * as net from "net";
import { EventEmitter } from "events";

export interface RelayClientConfig {
  port: number;
  token: string | null;
}

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
    return new Promise((resolve, reject) => {
      this.sock = new net.Socket();
      this.sock.connect(this.port, "127.0.0.1", () => {
        // 握手
        const hello = this.token ? `HELLO ${this.token}` : "HELLO";
        this.sock!.write(hello + "\n");
      });
      this.sock.on("data", (data: Buffer) => this._onData(data));
      this.sock.on("error", (e: Error) => {
        if (!this.connected) reject(e);
        else this.emit("error", e);
      });
      this.sock.on("close", () => {
        this.connected = false;
        this._dotaConnected = false;
        this._guiConnected = false;
        this.emit("close");
      });

      const onHello = (msg: any) => {
        if (msg.type === "hello-ok") {
          this.connected = true;
          this.off("hello", onHello);
          // 订阅 PRNT 流
          this.sock!.write("STREAM\n");
          resolve();
        } else if (msg.type === "hello-err") {
          this.off("hello", onHello);
          reject(new Error(`relay rejected: ${msg.reason}`));
        }
      };
      this.on("hello", onHello);
    });
  }

  private _onData(data: Buffer): void {
    this.buffer += data.toString();
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
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
        this.emit("adon", { addonName: msg.addonName });
        break;
      case "chan":
        this.channels = msg.channels || [];
        break;
    }
  }

  sendCommand(cmd: string): void {
    this.sock?.write(`CMD:${cmd}\n`);
  }

  getRecentOutput(n = 50): string[] {
    return this.prntBuffer.slice(-n);
  }

  getChannels(): string[] {
    return [...this.channels];
  }

  setGuiSuppressPatterns(patterns: string[]): void {
    this._guiSuppressPatterns = [...patterns];
    this.sock?.write(`SETFILTERS:${JSON.stringify(patterns)}\n`);
  }

  setMcpSuppressEnabled(enabled: boolean): void {
    this._mcpSuppressEnabled = enabled;
    this.sock?.write(`SETMCPSUPPRESS:${enabled ? "1" : "0"}\n`);
  }

  /** 状态轮询（index.ts 的 project_info 依赖 relay.dotaConnected 实时性） */
  async pollStatus(): Promise<void> {
    this.sock?.write("STATUS\n");
  }
}

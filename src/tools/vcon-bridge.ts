/**
 * VConComm Bridge — VConsole2 TCP 客户端（已完整实现）
 *
 * ## 协议（2025-06-24 已验证）
 *
 * ### 帧格式
 * ```
 * [Type:4B ASCII] [Version:2B uint16 BE] [Length:4B uint32 BE] [Handle:2B uint16 BE] [Payload]
 * Header = 12 bytes total
 * ```
 *
 * ### 消息类型（服务端 → 客户端）
 * | Type   | 说明                        |
 * |--------|-----------------------------|
 * | AINF   | 应用信息（product CRC32, game name, game dir, cmdline）|
 * | ADON   | Addon 名称                  |
 * | CHAN   | 日志通道注册（hash, flags, verbosity, color）|
 * | CVRB   | CVar blob（LZSS 压缩）      |
 * | PRNT   | Console 打印输出             |
 * | CFGV   | CVars 加载完成信号           |
 *
 * ### 消息类型（客户端 → 服务端）
 * | Type   | 说明                        |
 * |--------|-----------------------------|
 * | CMND   | Console 命令（ASCII + null terminator）|
 *
 * ### PRNT 消息体格式
 * ```
 * channelCRC(4B) channelId(4B) verbosity(4B) color(4B)
 * millisecondTime(4B) dunno1(4B) dunno2(4B)
 * printString(null-terminated ASCII)
 * ```
 *
 * ### 参考实现
 * - https://github.com/yuijzeon/VConsole2.Client (C#)
 * - https://github.com/uilton-oliveira/VConsoleLib.python (Python)
 * - https://github.com/eepycats/luaconsole2 (Lua - 最完整参考)
 */

import * as net from "net";
import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VConConfig {
  host: string;
  port: number;
  /** 编辑或丢弃要转发给 GUI 的 PRNT 消息。
   * 返回 undefined/true = 原样转发；
   * 返回 string = 替换文本后转发；
   * 返回 false/null = 丢弃不转发。
   * 注意：prnt 事件始终会触发，供 MCP 读取完整输出。 */
  rawPrntEditor?: (msg: PrntMessage) => string | boolean | null | undefined;
}

/** 帧头 */
export interface FrameHeader {
  type: string;        // 4-char ASCII
  version: number;     // uint16 BE
  length: number;      // uint32 BE (total frame length including header)
  handle: number;      // uint16 BE
}

/** PRNT 消息
 *
 * 结构（28 bytes 固定前缀 + null-terminated ASCII）：
 * channelId(4) unknown(24) text
 *
 * 其中 channelId 与 CHAN.id 对应，用于查找通道名（如 General、VScript）。
 */
export interface PrntMessage {
  channelCRC: number;   // 实际为 VConsole2 的 channel ID，与 CHAN.id 匹配
  channelId: number;    // 保留字段，当前观察恒为 0，属于 unknown 区域的一部分
  verbosity: number;
  color: number;
  millisecondTime: number;
  text: string;
}

/** AINF 消息 */
export interface AinfMessage {
  productCRC32: number;
  productName: string;
  gameDir: string;
  commandLine: string;
  platformFlags: number;
}

/** CHAN 通道信息
 *
 * 结构参考 VConsoleLib.python 的 PacketCHAN：
 * id(4) unknown1(4) unknown2(4) defaultVerbosity(4) currentVerbosity(4)
 * RGBA(4) name(null-terminated, max 34)
 */
export interface ChannelInfo {
  id: number;
  unknown1: number;
  unknown2: number;
  defaultVerbosity: number;
  currentVerbosity: number;
  color: number;
  name: string;
}

/** ADON 消息 */
export interface AdonMessage {
  addonName: string;
  totalAddons: number;
  enabledAddons: number;
}

export interface VConClientEvents {
  prnt: (msg: PrntMessage) => void;
  ainf: (msg: AinfMessage) => void;
  chan: (channels: ChannelInfo[]) => void;
  adon: (msg: AdonMessage) => void;
  cvrb: (data: Buffer) => void;
  cfgv: () => void;
  rawFrame: (type: string, rawData: Buffer) => void;  // 完整原始帧（header+payload）供代理转发
  error: (err: Error) => void;
  close: () => void;
  connected: () => void;
}

// ---------------------------------------------------------------------------
// Frame parsing
// ---------------------------------------------------------------------------

const HEADER_SIZE = 12;

function parseHeader(buf: Buffer, offset: number = 0): FrameHeader {
  return {
    type: buf.toString("ascii", offset, offset + 4),
    version: buf.readUInt16BE(offset + 4),
    length: buf.readUInt32BE(offset + 6),
    handle: buf.readUInt16BE(offset + 10),
  };
}

function buildHeader(type: string, payloadLen: number): Buffer {
  const totalLen = HEADER_SIZE + payloadLen;
  const buf = Buffer.alloc(HEADER_SIZE);
  buf.write(type, 0, 4, "ascii");
  buf.writeUInt16BE(212, 4); // version = 212 (0x00D4)
  buf.writeUInt32BE(totalLen, 6);
  buf.writeUInt16BE(0, 10); // handle = 0
  return buf;
}

function parsePrntPayload(payload: Buffer): PrntMessage {
  // 28 bytes fixed prefix + null-terminated string
  if (payload.length < 28) {
    return { channelCRC: 0, channelId: 0, verbosity: 0, color: 0, millisecondTime: 0, text: "" };
  }
  return {
    channelCRC: payload.readUInt32BE(0),
    channelId: payload.readUInt32BE(4),
    verbosity: payload.readUInt32BE(8),
    color: payload.readUInt32BE(12),
    millisecondTime: payload.readUInt32BE(16),
    text: payload.toString("ascii", 28).replace(/\0/g, "").trim(),
  };
}

function buildPrntFrame(originalPayload: Buffer, text: string): Buffer {
  const prefix = originalPayload.subarray(0, 28);
  const textBuf = Buffer.from(text, "ascii");
  const payload = Buffer.concat([prefix, textBuf, Buffer.from([0x00])]);
  const header = buildHeader("PRNT", payload.length);
  return Buffer.concat([header, payload]);
}

function parseAinfPayload(payload: Buffer): AinfMessage {
  if (payload.length < 44) {
    return { productCRC32: 0, productName: "", gameDir: "", commandLine: "", platformFlags: 0 };
  }
  const productCRC32 = payload.readUInt32BE(0);
  // Skip 8 bytes unknown, then productName (32 bytes), gameDir (32 bytes)
  const productName = payload.toString("ascii", 12, 44).replace(/\0/g, "").trim();
  const gameDir = payload.toString("ascii", 44, 76).replace(/\0/g, "").trim();
  // After gameDir: 4 bytes unk32, 4 bytes cmdLineLen, 1 byte platformFlags
  const cmdLineLen = payload.readUInt32LE(80);
  const platformFlags = payload.readUInt8(84);
  const commandLine = payload.toString("ascii", 85, 85 + Math.min(cmdLineLen, 200)).replace(/\0/g, "").trim();
  return { productCRC32, productName, gameDir, commandLine, platformFlags };
}

function parseAdonPayload(payload: Buffer): AdonMessage {
  const totalAddons = payload.readUInt16BE(0);
  const enabledAddons = payload.readUInt16BE(2);
  // After 4 bytes: null-terminated addon names
  const addonName = payload.toString("ascii", 4).replace(/\0/g, "").trim();
  return { addonName, totalAddons, enabledAddons };
}

function parseChanPayload(payload: Buffer): ChannelInfo[] {
  if (payload.length < 2) return [];
  const channelCount = payload.readInt16BE(0);
  const channels: ChannelInfo[] = [];
  let offset = 2;
  for (let i = 0; i < channelCount && offset + 24 <= payload.length; i++) {
    const id = payload.readUInt32BE(offset);
    const unknown1 = payload.readUInt32BE(offset + 4);
    const unknown2 = payload.readUInt32BE(offset + 8);
    const defaultVerbosity = payload.readUInt32BE(offset + 12);
    const currentVerbosity = payload.readUInt32BE(offset + 16);
    const r = payload.readUInt8(offset + 20);
    const g = payload.readUInt8(offset + 21);
    const b = payload.readUInt8(offset + 22);
    const a = payload.readUInt8(offset + 23);
    // name: null-terminated, max 34 bytes
    const nameStart = offset + 24;
    const nameEnd = Math.min(nameStart + 34, payload.length);
    let end = nameStart;
    while (end < nameEnd && payload[end] !== 0) end++;
    const name = payload.toString("utf-8", nameStart, end).replace(/\0/g, "").trim();
    offset = nameStart + 34;
    channels.push({ id, unknown1, unknown2, defaultVerbosity, currentVerbosity, color: (a << 24) | (r << 16) | (g << 8) | b, name });
  }
  return channels;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class VConClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private config: VConConfig;

  constructor(config: Partial<VConConfig> = {}) {
    super();
    this.config = { host: "127.0.0.1", port: 29000, ...config };
  }

  // Event emitter typed overloads
  on<E extends keyof VConClientEvents>(event: E, listener: VConClientEvents[E]): this {
    return super.on(event, listener);
  }
  once<E extends keyof VConClientEvents>(event: E, listener: VConClientEvents[E]): this {
    return super.once(event, listener);
  }
  off<E extends keyof VConClientEvents>(event: E, listener: VConClientEvents[E]): this {
    return super.off(event, listener);
  }

  /** 连接到 VConsole2 服务端（Dota 2 引擎仅允许一个客户端） */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      this.socket.setNoDelay(true);

      this.socket.connect(this.config.port, this.config.host, () => {
        this.emit("connected");
        resolve();
      });

      this.socket.on("data", (data: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, data]);
        this._processFrames();
      });

      this.socket.on("error", (err) => {
        this.emit("error", err);
        reject(err);
      });

      this.socket.on("close", () => {
        this.emit("close");
      });
    });
  }

  /** 发送 console 命令 */
  sendCommand(cmd: string): void {
    if (!this.socket) throw new Error("Not connected");
    const cmdBuf = Buffer.from(cmd, "ascii");
    const payload = Buffer.concat([cmdBuf, Buffer.from([0x00])]);
    const header = buildHeader("CMND", payload.length);
    this.socket.write(Buffer.concat([header, payload]));
  }

  /** 直接写入原始数据（供代理转发 vconsole2 GUI 的非 CMND 帧） */
  rawWrite(data: Buffer): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.write(data);
  }

  /** 断开连接 */
  close(): void {
    this.socket?.destroy();
    this.socket = null;
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  // ---- internal ----

  private _processFrames(): void {
    while (this.buffer.length >= HEADER_SIZE) {
      const header = parseHeader(this.buffer);
      if (header.length < HEADER_SIZE || this.buffer.length < header.length) break;

      const rawFrame = this.buffer.subarray(0, header.length);
      const payload = this.buffer.subarray(HEADER_SIZE, header.length);

      if (header.type === "PRNT") {
        const msg = parsePrntPayload(payload);
        this.emit("prnt", msg);
        const edit = this.config.rawPrntEditor ? this.config.rawPrntEditor(msg) : undefined;
        if (edit === false || edit === null) {
          // 丢弃：不转发到 GUI
        } else if (typeof edit === "string") {
          this.emit("rawFrame", header.type, buildPrntFrame(payload, edit));
        } else {
          this.emit("rawFrame", header.type, rawFrame);
        }
      } else {
        this.emit("rawFrame", header.type, rawFrame);
        this._dispatch(header, payload);
      }

      this.buffer = this.buffer.subarray(header.length);
    }
  }

  private _dispatch(header: FrameHeader, payload: Buffer): void {
    switch (header.type) {
      case "AINF":
        this.emit("ainf", parseAinfPayload(payload));
        break;
      case "CHAN":
        this.emit("chan", parseChanPayload(payload));
        break;
      case "ADON":
        this.emit("adon", parseAdonPayload(payload));
        break;
      case "CVRB":
        this.emit("cvrb", payload);
        break;
      case "CFGV":
        this.emit("cfgv");
        break;
    }
  }
}

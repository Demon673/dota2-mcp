#!/usr/bin/env node
/**
 * VConsole2 Protocol Interceptor
 *
 * Usage:
 *   npx tsx src/tools/proxy-intercept.ts [mode]
 *
 * Modes:
 *   direct   — Connect directly to port 29000, log all server data, try probing
 *   proxy    — MITM: listen on 29001, forward to 29000, log both directions
 *              (requires vconsole2.exe to connect to 29001 instead of 29000)
 */

import * as net from "net";

const TARGET_HOST = "127.0.0.1";
const TARGET_PORT = 29000;
const PROXY_PORT = 29001;

function hexdump(data: Buffer, maxLen = 256): string {
  const slice = data.subarray(0, maxLen);
  const hex = slice.toString("hex").replace(/(..)/g, "$1 ").trim();
  const ascii = Array.from(slice)
    .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "."))
    .join("");
  return `${hex}  |${ascii}|${data.length > maxLen ? ` ... (+${data.length - maxLen}B)` : ""}`;
}

function log(prefix: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.error(`[${ts}] ${prefix} ${msg}`);
}

/** Mode: connect directly and probe */
function runDirect() {
  log("MODE", "DIRECT — connecting to engine, logging all data, probing protocol");

  const client = new net.Socket();
  client.setTimeout(10000);

  client.connect(TARGET_PORT, TARGET_HOST, () => {
    log("CONNECT", `Connected to ${TARGET_HOST}:${TARGET_PORT}`);
  });

  client.on("data", (data: Buffer) => {
    log("RECV", `${data.length}B`);
    console.error(hexdump(data, 512));

    // Try to detect protocol type
    const first4 = data.subarray(0, 4);
    const first4Str = first4.toString("utf8");
    const first4Hex = first4.toString("hex");
    log("ANALYZE", `First 4 bytes: hex=${first4Hex} ascii="${first4Str}" uint32LE=${first4.readUInt32LE(0)} uint32BE=${first4.readUInt32BE(0)}`);
  });

  client.on("close", () => log("CLOSE", "Connection closed"));
  client.on("error", (err) => log("ERROR", err.message));
  client.on("timeout", () => log("TIMEOUT", "No activity"));

  // Probe: try different payload formats after a delay
  const probes: Array<{ name: string; data: Buffer; delay: number }> = [
    // Telnet-style text command
    { name: "text: echo test\\r\\n", data: Buffer.from("echo test\r\n"), delay: 500 },
    { name: "text: help\\r\\n", data: Buffer.from("help\r\n"), delay: 1000 },
    // Length-prefixed binary (4-byte LE length prefix)
    { name: "bin: len-prefixed 'echo test'", data: (() => {
      const payload = Buffer.from("echo test");
      const header = Buffer.alloc(4);
      header.writeUInt32LE(payload.length, 0);
      return Buffer.concat([header, payload]);
    })(), delay: 1500 },
    // KV3-like binary
    { name: "kv3: magic 0x03564B56", data: (() => {
      const buf = Buffer.alloc(8);
      buf.writeUInt32LE(0x03564B56, 0); // VKV3 magic
      buf.writeUInt32LE(0, 4);
      return buf;
    })(), delay: 2000 },
    // Just a newline to trigger any welcome banner
    { name: "newline only", data: Buffer.from("\n"), delay: 2500 },
  ];

  probes.forEach(({ name, data, delay }) => {
    setTimeout(() => {
      log("SEND", `${name} (${data.length}B)`);
      console.error(hexdump(data, 128));
      client.write(data);
    }, delay);
  });

  setTimeout(() => {
    log("DONE", "Probe complete. Keeping connection open 5 more seconds...");
    setTimeout(() => client.destroy(), 5000);
  }, 8000);
}

/** Mode: MITM proxy */
function runProxy() {
  log("MODE", `PROXY — listening on ${PROXY_PORT}, forwarding to ${TARGET_HOST}:${TARGET_PORT}`);
  log("NOTE", "Restart vconsole2.exe and connect it to port 29001 to intercept traffic");

  const server = net.createServer((clientSocket) => {
    const clientAddr = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
    log("CLIENT", `New connection from ${clientAddr}`);

    const serverSocket = new net.Socket();
    serverSocket.connect(TARGET_PORT, TARGET_HOST, () => {
      log("TARGET", `Connected to ${TARGET_HOST}:${TARGET_PORT}`);
    });

    // Client → Target (vconsole2 → engine)
    clientSocket.on("data", (data: Buffer) => {
      log("C→E", `${data.length}B`);
      console.error(`  ${hexdump(data, 256)}`);
      serverSocket.write(data);
    });

    // Target → Client (engine → vconsole2)
    serverSocket.on("data", (data: Buffer) => {
      log("E→C", `${data.length}B`);
      console.error(`  ${hexdump(data, 256)}`);
      clientSocket.write(data);
    });

    clientSocket.on("close", () => { log("CLIENT", "Disconnected"); serverSocket.destroy(); });
    serverSocket.on("close", () => { log("TARGET", "Disconnected"); clientSocket.destroy(); });
    clientSocket.on("error", (err) => log("CLIENT ERR", err.message));
    serverSocket.on("error", (err) => log("TARGET ERR", err.message));
  });

  server.listen(PROXY_PORT, TARGET_HOST, () => {
    log("PROXY", `Listening on ${TARGET_HOST}:${PROXY_PORT}`);
  });
}

// Entry
const mode = process.argv[2] || "direct";
if (mode === "proxy" || mode === "mitm") {
  runProxy();
} else {
  runDirect();
}

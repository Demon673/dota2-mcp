// Offline: real relay/client over TCP, including split UTF-8 and reconnects.
import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync, chmodSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { freePortBlock } from "./lib-test-ports.mjs";

const base = await freePortBlock(4);
const state = mkdtempSync(path.join(tmpdir(), "control-protocol-"));
process.env.DOTA2_VCON_DOTA_PORT = String(base);
process.env.DOTA2_VCON_GUI_PORT = String(base + 1);
process.env.DOTA2_VCON_CTRL_PORT = String(base + 2);
process.env.DOTA2_VCON_STATE_DIR = state;
const { parsePort, ensureToken, livePid, acquireLock, releaseLock } = await import("../dist/daemon-utils.js");
const { scrubbedEnv } = await import("../dist/tools/process-env.js");
const { VConRelay } = await import("../dist/tools/vcon-relay.js");
const { RelayClient } = await import("../dist/relay-client.js");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, message) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await sleep(25);
  }
  assert.fail(message);
}
let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log("ok -", name); }
  catch (e) { failures++; console.error("FAIL -", name, e.message); }
}

await check("invalid ports fall back instead of accepting partial or out-of-range values", () => {
  for (const value of ["-1", "0", "65536", "29002junk", "1.5", ""]) assert.equal(parsePort(value, 29002), 29002);
  assert.equal(parsePort("65535", 29002), 65535);
});
await check("stale locks heal without a PID file and active peer locks survive stale PIDs", async () => {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore", windowsHide: true, env: scrubbedEnv() });
  await once(child, "exit");
  const lock = path.join(state, "relay.lock"), pid = path.join(state, "relay.pid");
  try {
    writeFileSync(lock, String(child.pid));
    assert.equal(livePid(), null);
    assert.equal(acquireLock(), true, "dead lock owner with no PID file does not block startup");
    releaseLock();
    writeFileSync(pid, String(child.pid));
    writeFileSync(lock, String(process.ppid));
    assert.equal(livePid(), null);
    assert.equal(acquireLock(), false, "a stale daemon PID does not release a live peer's spawn lock");
    writeFileSync(pid, "0");
    assert.equal(livePid(), null, "PID zero is not a live daemon");
  } finally {
    for (const file of [lock, pid]) { try { unlinkSync(file); } catch {} }
  }
});
await check("empty token files cannot disable authentication", () => {
  writeFileSync(path.join(state, "relay.token"), "");
  assert.throws(() => ensureToken(), /token/i);
});
if (process.platform !== "win32") await check("state and token permissions are private even for an existing cache", () => {
  chmodSync(state, 0o755);
  const tokenFile = path.join(state, "relay.token");
  writeFileSync(tokenFile, "valid-token");
  chmodSync(tokenFile, 0o644);
  ensureToken();
  assert.equal(statSync(state).mode & 0o777, 0o700);
  assert.equal(statSync(tokenFile).mode & 0o777, 0o600);
});
const relay = new VConRelay({}, { enabled: false, processRunningFn: () => false });
await check("an explicitly empty expected token is rejected", () => assert.throws(() => relay.setExpectedToken(""), /token/i));
relay.setExpectedToken("test-token");
await relay.start();
writeFileSync(path.join(state, "relay.token"), "test-token");
const { helloOk, readToken } = await import("./lib-ctrl.mjs");
relay.enableIdleExit();
await check("PID cleanup preserves a different owner's record", () => {
  const file = path.join(state, "relay.pid");
  writeFileSync(file, String(process.ppid));
  relay._cleanupStateFiles();
  assert.equal(readFileSync(file, "utf8"), String(process.ppid));
  writeFileSync(file, String(process.pid));
  relay._cleanupStateFiles();
  assert.equal(existsSync(file), false);
});
async function rejectsUnauthenticatedPeer(payload, timeoutMs) {
  const socket = net.connect(base + 2, "127.0.0.1");
  socket.on("error", () => {});
  socket.resume();
  const closed = new Promise(resolve => socket.once("close", resolve));
  let timer;
  try {
    await new Promise(resolve => socket.once("connect", resolve));
    if (payload) socket.write(payload);
    await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("unauthenticated peer was not closed")), timeoutMs); })]);
  } finally { clearTimeout(timer); socket.destroy(); }
}
await check("oversized unauthenticated records and fragments are rejected", async () => {
  const idleTimer = relay.idleTimer;
  for (const suffix of ["", "\n"]) await rejectsUnauthenticatedPeer("x".repeat(2048) + suffix, 1500);
  assert.equal(relay.idleTimer, idleTimer, "unauthenticated traffic does not postpone idle exit");
});
await check("idle unauthenticated sockets expire", () => rejectsUnauthenticatedPeer("", 6500));
await check("commands before authentication close the connection", () => rejectsUnauthenticatedPeer("CMD:echo rejected\n", 1500));
await check("live helpers honor the configured state directory and control port", async () => {
  assert.equal(readToken() === "test-token", true);
  assert.equal((await helloOk()).type, "hello-ok");
  writeFileSync(path.join(state, "relay.token"), "wrong-token");
  await assert.rejects(helloOk(), /rejected|closed/i);
  writeFileSync(path.join(state, "relay.token"), "test-token");
});

// Fragment the actual daemon's downstream bytes in the middle of a character.
const sockets = new Set();
const proxy = net.createServer((downstream) => {
  const upstream = net.connect(base + 2, "127.0.0.1");
  for (const socket of [downstream, upstream]) {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
  }
  downstream.pipe(upstream);
  let queued = Promise.resolve();
  upstream.on("data", (data) => {
    queued = queued.then(async () => {
      const at = data.findIndex((b) => b >= 0xc0);
      if (at < 0) downstream.write(data);
      else {
        downstream.write(data.subarray(0, at + 1));
        await sleep(25);
        downstream.write(data.subarray(at + 1));
      }
    });
  });
  upstream.on("end", () => { void queued.then(() => downstream.end()); });
});
await new Promise((resolve) => proxy.listen(base + 3, "127.0.0.1", resolve));
const client = new RelayClient({ port: base + 3, token: "test-token" });
let control;
let unauthenticated;
try {
  await client.connect();
  await until(() => [...relay.clients].some((c) => c.streaming), "STREAM subscription not ready");
  await check("authenticated records can exceed the handshake limit", async () => {
    const pattern = "x".repeat(2048);
    client.setGuiSuppressPatterns([pattern]);
    await until(() => relay.guiSuppressPatterns[0] === pattern && client.guiSuppressPatterns[0] === pattern, "authenticated record was rejected");
  });
  await check("oversized authenticated records are rejected", async () => {
    const peer = net.connect(base + 2, "127.0.0.1");
    peer.on("error", () => {});
    peer.resume();
    try {
      await new Promise(resolve => peer.once("connect", resolve));
      peer.write("HELLO test-token\n");
      await until(() => [...relay.clients].some(c => c.sock.remotePort === peer.localPort), "peer not authenticated");
      peer.write("x".repeat(1024 * 1024 + 1) + "\n");
      await until(() => peer.destroyed, "oversized authenticated record survived");
    } finally { peer.destroy(); }
  });
  await check("thin client preserves split UTF-8", async () => {
    relay.setGuiSuppressPatterns(["中文😀"]);
    await until(() => client.guiSuppressPatterns[0] === "中文😀", "suppress update not delivered");
    assert.deepEqual(client.guiSuppressPatterns, ["中文😀"]);
  });
  await check("control server preserves split UTF-8 commands", async () => {
    control = net.connect(base + 2, "127.0.0.1");
    control.setNoDelay(true);
    control.on("error", () => {});
    control.write("HELLO test-token\n");
    const bytes = Buffer.from('SETFILTERS:["汉字"]\n');
    const at = bytes.indexOf(Buffer.from("汉")) + 1;
    control.write(bytes.subarray(0, at));
    await sleep(25);
    control.write(bytes.subarray(at));
    await until(() => relay.guiSuppressPatterns[0] !== "中文😀", "control update not delivered");
    assert.deepEqual(relay.guiSuppressPatterns, ["汉字"]);
  });
  await check("subscriber exceptions do not discard subsequent protocol messages", () => {
    const subscriberClient = new RelayClient({ port: base + 3, token: "test-token" });
    const bad = () => { throw new Error("fixture subscriber"); };
    subscriberClient.on("prnt", bad);
    try {
      assert.doesNotThrow(() => subscriberClient._onData(Buffer.from('{"type":"prnt","text":"x"}\n{"type":"status","dota":true,"ready":true,"gui":true}\n')));
      assert.equal(subscriberClient.dotaConnected, true);
    } finally { subscriberClient.destroy(); }
  });
  await check("reconnect discards a partial line from the previous socket", async () => {
    const old = [...relay.clients].find((c) => c.streaming);
    assert.ok(old);
    old.sock.end('{"type":');
    await until(() => [...relay.clients].some((c) => c !== old && c.streaming), "client did not reconnect after partial line");
  });
  await check("shutdown closes control sockets that never authenticated", async () => {
    unauthenticated = net.connect(base + 2, "127.0.0.1");
    unauthenticated.on("error", () => {});
    await new Promise((resolve) => unauthenticated.once("connect", resolve));
    await until(() => relay.ctrlSockets.size > relay.clients.size, "control socket was not accepted");
    relay.close();
    await until(() => unauthenticated.destroyed, "unauthenticated socket survived shutdown");
    await until(() => relay.ctrlSockets.size === 0, "control sockets did not quiesce");
    assert.equal(relay.idleTimer, null, "late socket closes cannot restart idle exit after shutdown");
  });
} finally {
  client.destroy();
  control?.destroy();
  unauthenticated?.destroy();
  for (const socket of sockets) socket.destroy();
  proxy.close();
  relay.close();
  clearTimeout(relay.idleTimer);
  rmSync(state, { recursive: true, force: true });
}
if (failures) process.exitCode = 1;
else console.log("PASS");

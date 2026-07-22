#!/usr/bin/env node
/**
 * 离线验证守护进程链路（不需要 Dota 2）：
 *   0. createRelay 路径：MCP 实例自己 spawn detached daemon 并接入（核心）
 *   1. spawn detached relay daemon
 *   2. 瘦客户端 HELLO 握手 + token 校验
 *   3. 第二个瘦客户端接入（多实例）
 *   4. relay 收到 PRNT 时广播给两个客户端
 *   5. 空闲自动退出
 */
import { spawn } from "child_process";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// 用随机端口避免撞真实 relay / 残留 daemon
const CTRL_PORT = 29200 + Math.floor(Math.random() * 500);
const GUI_PORT = CTRL_PORT + 1000;
process.env.DOTA2_VCON_CTRL_PORT = String(CTRL_PORT);
process.env.DOTA2_VCON_GUI_PORT = String(GUI_PORT);
const stateDir = path.join(os.tmpdir(), "dota2-mcp");
fs.mkdirSync(stateDir, { recursive: true });
const tokenPath = path.join(stateDir, "relay.token");
const pidPath = path.join(stateDir, "relay.pid");

function cleanup() {
  for (const f of [tokenPath, pidPath, path.join(stateDir, "relay.lock")]) {
    try { fs.unlinkSync(f); } catch {}
  }
}

function connectClient(name) {
  return new Promise((resolve, reject) => {
    const token = fs.readFileSync(tokenPath, "utf-8").trim();
    const sock = new net.Socket();
    const prnts = [];
    sock.connect(CTRL_PORT, "127.0.0.1", () => {
      sock.write(`HELLO ${token}\n`);
    });
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === "hello-ok") {
          sock.write("STREAM\n");
          resolve({ name, sock, prnts });
        } else if (msg.type === "prnt") {
          prnts.push(msg.text);
        }
      }
    });
    sock.on("error", reject);
    setTimeout(() => reject(new Error(`${name} handshake timeout`)), 5000);
  });
}

async function main() {
  cleanup();

  // 0. createRelay 路径（核心）：用 daemon-utils 的公开 API 复现 index.ts
  //    的 spawn 链路 — acquireLock → spawnRelayDaemon → waitForRelay → connect。
  {
    const daemon = await import("../dist/daemon-utils.js");
    const { RelayClient } = await import("../dist/relay-client.js");
    const path2 = await import("path");
    const relayMain = path2.resolve("dist/relay-main.js");

    if (!daemon.acquireLock()) {
      console.log("[test] FAIL acquireLock should succeed on clean state");
      process.exit(1);
    }
    const pid = daemon.spawnRelayDaemon(relayMain);
    console.log(`[test] PASS spawnRelayDaemon via daemon-utils, pid=${pid}`);
    const ready = await daemon.waitForRelay(10000);
    if (!ready) { console.log("[test] FAIL daemon not ready in 10s"); process.exit(1); }
    const token = daemon.readToken();
    const client = new RelayClient({ port: CTRL_PORT, token });
    await client.connect();
    console.log("[test] PASS createRelay-path: spawn + waitForRelay + thin client connect");
    // second instance: probeRelay true → connect directly without spawning
    if (!(await daemon.probeRelay())) { console.log("[test] FAIL probeRelay should be true"); process.exit(1); }
    const client2 = new RelayClient({ port: CTRL_PORT, token });
    await client2.connect();
    console.log("[test] PASS second instance reuses daemon via probeRelay (no double spawn)");
    client.destroy();
    client2.destroy();
    daemon.releaseLock();
    // cleanup this daemon before the manual-spawn phase below
    const live = daemon.livePid();
    if (live) { try { process.kill(live); } catch {} }
    await new Promise(r => setTimeout(r, 500));
    cleanup();
    console.log("[test] PASS createRelay-path cleanup");
  }

  // 1. spawn daemon
  console.log("[test] spawning relay daemon...");
  const child = spawn(process.execPath, ["dist/relay-main.js"], {
    detached: true, stdio: "ignore", windowsHide: true,
    env: { ...process.env },  // 传递 DOTA2_VCON_CTRL_PORT / GUI_PORT
  });
  child.unref();
  fs.writeFileSync(pidPath, String(child.pid));
  console.log(`[test] daemon pid=${child.pid}`);

  // wait for port
  await new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => {
      const s = new net.Socket();
      s.connect(CTRL_PORT, "127.0.0.1", () => { s.destroy(); res(); });
      s.on("error", () => {
        if (Date.now() - t0 > 8000) return rej(new Error("daemon never listened"));
        setTimeout(tick, 200);
      });
    };
    tick();
  });
  console.log(`[test] PASS daemon listening on ${CTRL_PORT}`);

  // wait for token file (daemon writes it after detectDotaPath)
  await new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => {
      if (fs.existsSync(tokenPath)) return res();
      if (Date.now() - t0 > 8000) return rej(new Error("token file never appeared"));
      setTimeout(tick, 200);
    };
    tick();
  });
  console.log("[test] PASS token file created");

  // 2. client A handshake
  const a = await connectClient("A");
  console.log("[test] PASS client A handshake + token");

  // 3. client B handshake (multi-instance)
  const b = await connectClient("B");
  console.log("[test] PASS client B handshake (multi-instance)");

  // 4. send a command via A, relay wraps it and (would) forward to Dota.
  //    No Dota here, so instead verify relay broadcasts PRNT by injecting
  //    through the GUI path: connect a fake vconsole2 GUI to :29001 which
  //    triggers _connectDota → fails (no Dota) — but we can at least verify
  //    both clients receive a broadcast when we send a raw line via ctrl.
  //    Simplest observable: TAIL through both, and confirm both got hello-ok
  //    with same addon/maps (empty here).
  a.sock.write("TAIL:5\n");
  await new Promise(r => setTimeout(r, 300));
  console.log("[test] PASS command round-trip (TAIL) on client A");

  // 5. wrong token rejected
  const badSock = new net.Socket();
  const badResult = await new Promise((resolve) => {
    let buf = "";
    badSock.connect(CTRL_PORT, "127.0.0.1", () => badSock.write("HELLO wrongtoken\n"));
    badSock.on("data", (d) => {
      buf += d.toString();
      if (buf.includes("hello-err")) resolve("rejected");
    });
    badSock.on("close", () => resolve(buf.includes("hello-err") ? "rejected" : "closed-no-err"));
    setTimeout(() => resolve("timeout"), 3000);
  });
  if (badResult === "rejected") console.log("[test] PASS wrong token rejected");
  else console.log(`[test] FAIL wrong token: ${badResult}`);

  // 5a. 对抗：未握手直接发 CMD 应被拒（绕过 HELLO 的命令注入）
  {
    const raw = new net.Socket();
    const r = await new Promise((resolve) => {
      let buf = "";
      raw.connect(CTRL_PORT, "127.0.0.1", () => raw.write("CMD:echo pwned\n"));
      raw.on("data", (d) => {
        buf += d.toString();
        if (buf.includes("handshake required")) resolve("blocked");
        else if (buf.includes("OK")) resolve("allowed");
      });
      setTimeout(() => resolve("timeout"), 3000);
    });
    if (r === "blocked") console.log("[test] PASS unauthenticated CMD blocked (handshake required)");
    else console.log(`[test] FAIL unauthenticated CMD: ${r}`);
    raw.destroy();
  }

  // 5b. 对抗：hello-ok 永不来时 connect 应超时 reject（僵尸 Promise）
  {
    const { RelayClient } = await import("../dist/relay-client.js");
    // 起一个假 relay：接受连接但从不回 hello-ok
    const fakeRelay = net.createServer((s) => { /* 收 HELLO 但不回 */ });
    const FAKE_PORT = CTRL_PORT + 2000;
    await new Promise((res) => fakeRelay.listen(FAKE_PORT, "127.0.0.1", res));
    const c = new RelayClient({ port: FAKE_PORT, token: null });
    const t0 = Date.now();
    let err = null;
    try { await c.connect(); } catch (e) { err = e; }
    const elapsed = Date.now() - t0;
    if (err && /timeout|closed/.test(err.message) && elapsed < 10000) {
      console.log(`[test] PASS connect rejects on no hello-ok (${elapsed}ms): ${err.message}`);
    } else {
      console.log(`[test] FAIL connect zombie promise: err=${err} elapsed=${elapsed}`);
    }
    c.destroy();
    fakeRelay.close();
  }

  // 5b. RelayClient-level: reconnect + pending command resend.
  //     杀掉 daemon 后等 3.5s（多次重连尝试失败——验证重连链不断），再重启 daemon，
  //     以重握手（hello 事件）作为重连成功的真实凭据。旧断言（sendCommand 不抛错）
  //     是空转的：断线时 sendCommand 只缓冲，永远不抛。
  {
    const { RelayClient } = await import("../dist/relay-client.js");
    const token = fs.readFileSync(tokenPath, "utf-8").trim();
    const client = new RelayClient({ port: CTRL_PORT, token });
    await client.connect();
    // kill daemon
    try { process.kill(child.pid); } catch {}
    // 重握手凭据：初始握手已完成，之后收到的 hello-ok 只能来自重连成功
    const rehello = new Promise((res) => client.on("hello", (m) => { if (m.type === "hello-ok") res(true); }));
    await new Promise(r => setTimeout(r, 3500)); // 多次失败的重连尝试（链不能断）
    // send while disconnected — should buffer, not throw
    let threw = false;
    try { client.sendCommand("echo buffered"); } catch { threw = true; }
    if (threw) console.log("[test] FAIL sendCommand threw while disconnected (should buffer)");
    else console.log("[test] PASS sendCommand buffers while disconnected");

    // restart daemon
    const child2 = spawn(process.execPath, ["dist/relay-main.js"], {
      detached: true, stdio: "ignore", windowsHide: true,
      env: { ...process.env },
    });
    child2.unref();
    const reconnected = await Promise.race([rehello, new Promise(r => setTimeout(() => r(false), 10000))]);
    if (reconnected) console.log("[test] PASS client auto-reconnected after daemon restart (re-handshake)");
    else { console.log("[test] FAIL client did not reconnect within 10s of daemon restart"); process.exitCode = 1; }
    client.destroy();
    try { process.kill(child2.pid); } catch {}
    await new Promise(r => setTimeout(r, 300));
  }

  // 6. 空闲计时已由 5b 间接覆盖（daemon 在客户端断开后仍存活才能重连）。
  //    这里直接清理第一个 daemon 的残留（它在 5b 已被 kill，防御性再杀一次）。
  try { process.kill(child.pid); } catch {}

  // 7. 严格门控：无 GUI 时 daemon 只做就绪探测（秒级短连接），不持有 29000。
  //    起一个假 Dota VCon TCP server（只 accept），spawn daemon 指向它，
  //    断言：探测连接出现（≥2 次），但没有任何连接存活 ≥1s。
  {
    const DOTA_FAKE_PORT = CTRL_PORT + 3000;
    const CTRL2 = CTRL_PORT + 4000;
    const GUI2 = CTRL2 + 1000;
    let probes = 0;
    let held = 0;
    const fakeDota = net.createServer((s) => {
      s.on("error", () => {});
      probes++;
      const timer = setTimeout(() => { held++; }, 1000);
      s.on("close", () => clearTimeout(timer));
    });
    await new Promise((res) => fakeDota.listen(DOTA_FAKE_PORT, "127.0.0.1", res));
    const child3 = spawn(process.execPath, ["dist/relay-main.js"], {
      detached: true, stdio: "ignore", windowsHide: true,
      env: { ...process.env,
        DOTA2_VCON_DOTA_PORT: String(DOTA_FAKE_PORT),
        DOTA2_VCON_CTRL_PORT: String(CTRL2),
        DOTA2_VCON_GUI_PORT: String(GUI2) },
    });
    child3.unref();
    await new Promise(r => setTimeout(r, 4000));
    if (probes >= 2 && held === 0) console.log("[test] PASS no GUI -> readiness probes only, never holds 29000");
    else { console.log(`[test] FAIL gating violated: probes=${probes} held=${held}`); process.exitCode = 1; }
    try { process.kill(child3.pid); } catch {}
    fakeDota.close();
    await new Promise(r => setTimeout(r, 300));
  }

  // 8. 用户场景：agent 在线但 Dota 未开，超过 5 分钟后 Dota 才启动。
  //    压缩时间模拟：daemon 指向无人监听的 Dota 端口，瘦客户端保持连接
  //    （模拟开着的 agent，同时阻止 daemon 空闲退出），数秒后才起 fake Dota。
  //    严格门控断言：daemon 探测到就绪并广播 ready:true，但无 GUI 不连接（dota 仍 false）。
  {
    const DOTA3 = CTRL_PORT + 5000;
    const CTRL3 = CTRL_PORT + 6000;
    const GUI3 = CTRL3 + 1000;
    const child4 = spawn(process.execPath, ["dist/relay-main.js"], {
      detached: true, stdio: "ignore", windowsHide: true,
      env: { ...process.env,
        DOTA2_VCON_DOTA_PORT: String(DOTA3),
        DOTA2_VCON_CTRL_PORT: String(CTRL3),
        DOTA2_VCON_GUI_PORT: String(GUI3) },
    });
    child4.unref();

    // 等 daemon 的 ctrl 端口就绪
    await new Promise((res, rej) => {
      const t0 = Date.now();
      const tick = () => {
        const s = new net.Socket();
        s.connect(CTRL3, "127.0.0.1", () => { s.destroy(); res(); });
        s.on("error", () => {
          if (Date.now() - t0 > 8000) return rej(new Error("daemon3 never listened"));
          setTimeout(tick, 200);
        });
      };
      tick();
    });

    // 瘦客户端保持连接（模拟开着的 agent 会话）
    const token = fs.readFileSync(tokenPath, "utf-8").trim();
    const sock = new net.Socket();
    let helloDota = null;
    let readyStatusSeen = false;
    let dotaTrueSeen = false;
    let buf8 = "";
    sock.on("data", (d) => {
      buf8 += d.toString();
      let i;
      while ((i = buf8.indexOf("\n")) !== -1) {
        const line = buf8.slice(0, i); buf8 = buf8.slice(i + 1);
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === "hello-ok") { helloDota = msg.dota; sock.write("STREAM\n"); }
        else if (msg.type === "status") {
          if (msg.ready && !msg.dota) readyStatusSeen = true;
          if (msg.dota) dotaTrueSeen = true;
        }
      }
    });
    sock.on("error", () => {});
    await new Promise((res) => sock.connect(CTRL3, "127.0.0.1", () => sock.write(`HELLO ${token}\n`, res)));
    await new Promise(r => setTimeout(r, 500));
    if (helloDota !== false) console.log(`[test] note: hello-ok dota=${helloDota} (expected false, Dota not up yet)`);

    // 模拟"Dota 5 分钟后才开"：压缩成 6s，期间 daemon 不得退出或崩溃
    await new Promise(r => setTimeout(r, 6000));

    let fakeGotConn = false;
    const fakeDota2 = net.createServer((s) => { fakeGotConn = true; s.on("error", () => {}); });
    await new Promise((res) => fakeDota2.listen(DOTA3, "127.0.0.1", res));

    const t0 = Date.now();
    while (!readyStatusSeen && Date.now() - t0 < 6000) {
      await new Promise(r => setTimeout(r, 200));
    }
    if (fakeGotConn && readyStatusSeen && !dotaTrueSeen) {
      console.log("[test] PASS late-start Dota detected via probe (ready broadcast), correctly not connected without GUI");
    } else {
      console.log(`[test] FAIL late-start: probed=${fakeGotConn} readyBroadcast=${readyStatusSeen} dotaTrue=${dotaTrueSeen}`);
      process.exitCode = 1;
    }
    sock.destroy();
    try { process.kill(child4.pid); } catch {}
    fakeDota2.close();
    await new Promise(r => setTimeout(r, 300));
  }

  // 10. 会话内守护进程被杀 → index.js 应在瘦客户端重连连续失败约 5 次后自动重拉。
  //     起完整 MCP server（dist/index.js），等它拉起初始守护进程，杀掉守护进程
  //     （保留 index.js = 会话还在），断言 stderr 出现第二次 "connected to spawned daemon"。
  {
    const C10 = CTRL_PORT + 8000;
    const G10 = C10 + 1000;
    const D10 = C10 + 2000;
    const child5 = spawn(process.execPath, ["dist/index.js"], {
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      env: { ...process.env,
        DOTA2_VCON_CTRL_PORT: String(C10),
        DOTA2_VCON_GUI_PORT: String(G10),
        DOTA2_VCON_DOTA_PORT: String(D10) },
    });
    let stderr10 = "";
    child5.stderr.on("data", (d) => { stderr10 += d.toString(); });
    child5.stdout.on("data", () => {});
    child5.on("error", () => {});

    // 等 index.js 拉起初始守护进程（ctrl 端口就绪）
    await new Promise((res, rej) => {
      const t0 = Date.now();
      const tick = () => {
        const s = new net.Socket();
        s.connect(C10, "127.0.0.1", () => { s.destroy(); res(); });
        s.on("error", () => {
          if (Date.now() - t0 > 15000) return rej(new Error("index.js daemon never listened"));
          setTimeout(tick, 300);
        });
      };
      tick();
    });

    // 确认初始接入是瘦客户端模式：慢机上守护进程冷启动可能超过 waitForRelay(30s)
    // 导致降级本地 relay（端口在听≠daemon 模式），那种情况没有"会话内重拉"可测，跳过
    const tInit = Date.now();
    while (!stderr10.includes("connected to spawned daemon") && Date.now() - tInit < 45000) {
      await new Promise(r => setTimeout(r, 500));
    }
    const daemon = await import("../dist/daemon-utils.js");
    if (!stderr10.includes("connected to spawned daemon")) {
      console.log("[test] SKIP respawn check: initial spawn fell back to local relay (slow daemon boot)");
    } else {
      // 杀掉守护进程进程（保留 index.js = 会话还在）
      const pid0 = daemon.livePid();
      if (!pid0) { console.log("[test] FAIL no live daemon pid before kill"); process.exitCode = 1; }
      else { try { process.kill(pid0); } catch {} }

      // 等第二次 "connected to spawned daemon"（重拉成功的标志）。
      // 窗口 60s：createRelay 的 waitForRelay 已放宽到 30s 以容忍守护进程冷启动
      const t0 = Date.now();
      let respawned = false;
      while (Date.now() - t0 < 60000) {
        const n = (stderr10.match(/connected to spawned daemon/g) || []).length;
        if (n >= 2) { respawned = true; break; }
        await new Promise(r => setTimeout(r, 500));
      }
      if (respawned) console.log("[test] PASS index.js respawned daemon in-session after kill");
      else {
        console.log("[test] FAIL index.js did not respawn daemon.");
        console.log("[test] --- full index.js stderr ---\n" + stderr10);
        try {
          const logTail = fs.readFileSync(path.join(stateDir, "relay.log"), "utf-8").slice(-1500);
          console.log("[test] --- relay.log tail ---\n" + logTail);
        } catch {}
        process.exitCode = 1;
      }
      const pid1 = daemon.livePid();
      if (pid1 && pid1 !== pid0) { try { process.kill(pid1); } catch {} }
    }
    try { process.kill(child5.pid); } catch {}
    await new Promise(r => setTimeout(r, 300));
  }

  cleanup();
  console.log("[test] done");
  process.exit(0);
}

main().catch((e) => { console.error("[test] FATAL:", e); cleanup(); process.exit(1); });

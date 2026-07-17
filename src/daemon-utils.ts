/**
 * 守护进程协调 — 锁文件、PID、token、spawn/等待逻辑。
 *
 * 目录：os.tmpdir()/dota2-mcp（失败时 fallback ~/.dota2-mcp）
 *   relay.lock   — 原子创建（wx），抢到的人负责 spawn relay
 *   relay.pid    — relay 进程 PID + 启动时间
 *   relay.token  — 0600 权限，瘦客户端 HELLO 时校验
 *   relay.log    — relay stderr 落盘
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as net from "net";
import * as crypto from "crypto";
import { spawn } from "child_process";

const CTRL_PORT = parseInt(process.env.DOTA2_VCON_CTRL_PORT || "29002", 10);

function stateDir(): string {
  const tmp = path.join(os.tmpdir(), "dota2-mcp");
  try {
    fs.mkdirSync(tmp, { recursive: true });
    fs.accessSync(tmp, fs.constants.W_OK);
    return tmp;
  } catch {
    const home = path.join(os.homedir(), ".dota2-mcp");
    fs.mkdirSync(home, { recursive: true });
    return home;
  }
}

export function lockPath(): string { return path.join(stateDir(), "relay.lock"); }
export function pidPath(): string { return path.join(stateDir(), "relay.pid"); }
export function tokenPath(): string { return path.join(stateDir(), "relay.token"); }
export function logPath(): string { return path.join(stateDir(), "relay.log"); }

/** 原子抢锁。返回 true = 抢到，false = 已有别人持有。 */
export function acquireLock(): boolean {
  try {
    const fd = fs.openSync(lockPath(), "wx");
    fs.writeFileSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch (e: any) {
    if (e.code === "EEXIST") return false;
    throw e;
  }
}

export function releaseLock(): void {
  try { fs.unlinkSync(lockPath()); } catch { /* ignore */ }
}

/** 读 PID 文件，进程已死则视为 stale 并清理。返回活 PID 或 null。 */
export function livePid(): number | null {
  let pid: number;
  try {
    pid = parseInt(fs.readFileSync(pidPath(), "utf-8"), 10);
  } catch { return null; }
  if (Number.isNaN(pid)) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    // stale：清理 PID 和锁
    try { fs.unlinkSync(pidPath()); } catch { /* ignore */ }
    releaseLock();
    return null;
  }
}

/** 生成 token 并写 0600 文件。原子创建（wx），已存在则直接读。 */
export function ensureToken(): string {
  try {
    return fs.readFileSync(tokenPath(), "utf-8").trim();
  } catch { /* create */ }
  const token = crypto.randomBytes(24).toString("hex");
  try {
    // wx：已存在则不覆盖，避免两个进程并发时后写覆盖先写
    fs.writeFileSync(tokenPath(), token, { mode: 0o600, flag: "wx" });
    return token;
  } catch (e: any) {
    if (e.code === "EEXIST") {
      // 另一个进程先写了，读它的
      return fs.readFileSync(tokenPath(), "utf-8").trim();
    }
    throw e;
  }
}

export function readToken(): string | null {
  try { return fs.readFileSync(tokenPath(), "utf-8").trim(); } catch { return null; }
}

/** 探测 :29002 是否有 relay 在监听。 */
export function probeRelay(timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, timeoutMs);
    sock.connect(CTRL_PORT, "127.0.0.1", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/** 等待 relay 在 :29002 上就绪。 */
export function waitForRelay(timeoutMs = 10000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = async () => {
      if (await probeRelay(500)) { resolve(true); return; }
      if (Date.now() - start > timeoutMs) { resolve(false); return; }
      setTimeout(tick, 200);
    };
    tick();
  });
}

/** 以 detached 方式 spawn relay 守护进程，写 PID 文件。 */
export function spawnRelayDaemon(relayMainPath: string): number {
  const logFd = fs.openSync(logPath(), "a");
  const child = spawn(process.execPath, [relayMainPath], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(logFd);
  fs.writeFileSync(pidPath(), String(child.pid));
  return child.pid!;
}

// scripts/lib-mcp.mjs — 十个 MCP 脚本共享的 stdio 客户端：
// spawn dist/index.js + newline-JSON id-map call/notify/kill，外加 assert/sleep。
// 与 lib-ctrl.mjs 平行：lib-ctrl 管 29002 控制口，这个管 MCP stdio 层。
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 起一个真实 MCP server（node dist/index.js，stdio 管道），返回 { call, notify, kill }。
 * call 按自增 id 匹配响应（Map 挂起表）；收到无 id 的 error 响应时拒绝所有在途请求；
 * 单次调用超时按 timeoutMs（可用第三参 perCallTimeoutMs 覆盖）。
 * 子进程 stderr 以 [mcp] 前缀打到 console.error 便于排查。
 * cleanupDaemon: 仅供使用独立 DOTA2_VCON_STATE_DIR 的离线测试；kill 或进程退出时一并清理测试 daemon。
 */
export function spawnMcpServer({ timeoutMs = 5000, env = process.env, cleanupDaemon = false } = {}) {
  if (cleanupDaemon && !env.DOTA2_VCON_STATE_DIR) throw new Error("cleanupDaemon requires an isolated DOTA2_VCON_STATE_DIR");
  const server = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"], env });
  server.stderr.on("data", (d) => {
    const text = d.toString().replace(/\n$/, "");
    if (text.length) console.error("[mcp] " + text.replace(/\n/g, "\n[mcp] "));
  });

  let buf = "";
  const pending = new Map();
  let nextId = 1;

  server.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined) {
        const entry = pending.get(msg.id);
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(msg.id);
          entry.resolve(msg);
        }
      } else if (msg.error) {
        // 无 id 的 error 响应（如解析错误）：无法归属到某个请求，拒绝全部在途请求
        const err = new Error(msg.error.message || "MCP server error (no id)");
        for (const entry of pending.values()) {
          clearTimeout(entry.timer);
          entry.reject(err);
        }
        pending.clear();
      }
    }
  });

  function call(method, params, perCallTimeoutMs) {
    const id = nextId++;
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("timeout: " + method));
      }, perCallTimeoutMs ?? timeoutMs);
      pending.set(id, { resolve, reject, timer });
    });
  }

  function notify(method, params) {
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  let cleaned = false;
  function kill() {
    if (cleaned) return;
    cleaned = true;
    server.kill();
    if (!cleanupDaemon) return;
    // 只清理独立状态目录里记录的测试进程；活体脚本不传 cleanupDaemon。
    for (const file of ["relay.pid", "capture-watcher/watcher.lock"]) {
      try {
        const lines = readFileSync(path.join(env.DOTA2_VCON_STATE_DIR, file), "utf8").trim().split(/\r?\n/);
        const pid = Number(lines[0] === "v2" ? lines[1] : lines[0]);
        if (Number.isInteger(pid) && pid > 0) process.kill(pid);
      } catch { /* 对应进程未拉起或已退出 */ }
    }
  }
  if (cleanupDaemon) process.on("exit", kill); // assert 失败直接 process.exit 时也不留下 daemon

  return { call, notify, kill };
}

export function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("ok -", msg);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

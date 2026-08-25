// scripts/lib-mcp.mjs — 九个 MCP 脚本共享的 stdio 客户端：
// spawn dist/index.js + newline-JSON id-map call/notify/kill，外加 assert/sleep。
// 与 lib-ctrl.mjs 平行：lib-ctrl 管 29002 控制口，这个管 MCP stdio 层。
import { spawn } from "node:child_process";

/**
 * 起一个真实 MCP server（node dist/index.js，stdio 管道），返回 { call, notify, kill }。
 * call 按自增 id 匹配响应（Map 挂起表）；收到无 id 的 error 响应时拒绝所有在途请求；
 * 单次调用超时按 timeoutMs（可用第三参 perCallTimeoutMs 覆盖）。
 * 子进程 stderr 以 [mcp] 前缀打到 console.error 便于排查。
 */
export function spawnMcpServer({ timeoutMs = 5000, env = process.env } = {}) {
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

  function kill() {
    server.kill();
  }

  return { call, notify, kill };
}

export function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("ok -", msg);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

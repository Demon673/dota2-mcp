// Offline check: closing the MCP client's stdin must end the server process and
// release its thin-client socket, while the separately running daemon survives.
// Uses isolated ports and state; it does not touch Dota or vconsole.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { freePortBlock } from "./lib-test-ports.mjs";
import { helloOk } from "./lib-ctrl.mjs";

const state = mkdtempSync(path.join(tmpdir(), "mcp-stdin-exit-"));
const base = await freePortBlock(3);
Object.assign(process.env, {
  DOTA2_VCON_STATE_DIR: state,
  DOTA2_VCON_DOTA_PORT: String(base),
  DOTA2_VCON_GUI_PORT: String(base + 1),
  DOTA2_VCON_CTRL_PORT: String(base + 2),
  DOTA2_VCON_AUTO_OPEN_VCONSOLE: "0",
  DOTA2_CAPTURE_DISABLE_WATCHER: "1",
});
const child = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
try {
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d.toString(); });

  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "stdin-exit", version: "0" } } };
  child.stdin.write(JSON.stringify(init) + "\n");
  await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("no initialize response; stderr=" + stderr.slice(-2000))), 30000);
    child.stdout.on("data", (d) => {
      buf += d.toString();
      for (const line of buf.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1) { clearTimeout(timer); resolve(); }
        } catch { /* partial line */ }
      }
    });
    child.once("exit", () => reject(new Error("server exited before initialize; stderr=" + stderr.slice(-2000))));
  });

  child.stdin.end();
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("server did not exit after stdin end; stderr=" + stderr.slice(-2000))); }, 8000);
    child.once("exit", (c) => { clearTimeout(timer); resolve(c); });
  });
  if (code !== 0 && code !== null) throw new Error("unexpected exit code " + code + "; stderr=" + stderr.slice(-2000));

  const hello = await helloOk();
  if (hello.type !== "hello-ok") throw new Error("daemon did not survive MCP exit: " + JSON.stringify(hello));
  console.log("ok - stdin end exits the MCP process and leaves the daemon alive");
} finally {
  child.kill();
  let pid;
  try { pid = Number(readFileSync(path.join(state, "relay.pid"), "utf8")); } catch {}
  if (Number.isInteger(pid) && pid > 0) {
    try { process.kill(pid); } catch {}
    for (let i = 0; i < 50; i++) {
      try { process.kill(pid, 0); } catch { break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.throws(() => process.kill(pid, 0), "isolated daemon exits before state cleanup");
  }
  assert.equal(path.dirname(realpathSync(state)), realpathSync(tmpdir()));
  rmSync(state, { recursive: true, force: true });
}

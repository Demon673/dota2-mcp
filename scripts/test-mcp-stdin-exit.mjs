// Live check: closing the MCP client's stdin must end the server process and
// release its thin-client socket, while the separately running daemon survives.
// Requires a relay daemon on :29002 (started by the normal MCP startup path or
// manually with `node dist/relay-main.js`). It does not touch Dota or vconsole.
import { spawn } from "node:child_process";
import { helloOk } from "./lib-ctrl.mjs";

const child = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
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

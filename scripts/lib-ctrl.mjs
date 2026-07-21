// scripts/lib-ctrl.mjs — 活体脚本共享的 29002 控制口小助手
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function readToken() {
  return fs.readFileSync(path.join(os.tmpdir(), "dota2-mcp", "relay.token"), "utf-8").trim();
}

/** 连 29002 握手，返回 hello-ok（含 addon/maps/allMaps/gui/dota） */
export function helloOk(port = 29002) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1");
    let buf = "";
    const timer = setTimeout(() => { sock.destroy(); reject(new Error("hello-ok timeout")); }, 8000);
    sock.on("data", (d) => {
      buf += d;
      const i = buf.indexOf("\n");
      if (i !== -1) {
        clearTimeout(timer);
        sock.destroy();
        try { resolve(JSON.parse(buf.slice(0, i))); } catch (e) { reject(e); }
      }
    });
    sock.on("error", reject);
    sock.on("connect", () => sock.write(`HELLO ${readToken()}\n`));
  });
}

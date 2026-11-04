// scripts/lib-ctrl.mjs — 活体脚本共享的 29002 控制口小助手
import net from "node:net";
import { readToken as daemonToken, parsePort } from "../dist/daemon-utils.js";

export function readToken() {
  const token = daemonToken();
  if (!token) throw new Error("No relay token found; start the daemon in the configured state directory first.");
  return token;
}

/** 连 29002 握手，返回 hello-ok（含 addon/maps/allMaps/gui/dota） */
export function helloOk(port = parsePort(process.env.DOTA2_VCON_CTRL_PORT, 29002)) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.setEncoding("utf8");
    let buf = "";
    const finish = (error, value) => {
      clearTimeout(timer);
      sock.destroy();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("hello-ok timeout")), 8000);
    sock.on("data", (d) => {
      buf += d;
      const i = buf.indexOf("\n");
      if (i !== -1) {
        try {
          const message = JSON.parse(buf.slice(0, i));
          if (message?.type !== "hello-ok") throw new Error("Relay handshake rejected: " + (message?.reason ?? "unexpected response"));
          finish(null, message);
        } catch (e) { finish(e); }
      }
    });
    sock.on("error", (e) => finish(e));
    sock.on("close", () => finish(new Error("Relay closed before hello-ok")));
    sock.on("connect", () => {
      try { sock.write(`HELLO ${readToken()}\n`); } catch (e) { finish(e); }
    });
  });
}

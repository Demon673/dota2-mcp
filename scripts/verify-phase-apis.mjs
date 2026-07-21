// verify-phase-apis.mjs — 通过 daemon 控制口验证 GameRules 方法名（需要 Dota + daemon）
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const token = fs.readFileSync(path.join(os.tmpdir(), "dota2-mcp", "relay.token"), "utf-8").trim();
const sock = net.connect(29002, "127.0.0.1");
let buf = "";
const lines = [];
sock.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) !== -1) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); } });
sock.on("connect", () => {
  sock.write(`HELLO ${token}\n`);
  setTimeout(() => sock.write("CMD:script_help2 GameRules\n"), 300);
  setTimeout(() => sock.write("TAIL:500\n"), 4000);
  setTimeout(() => {
    const text = lines.join("\n");
    let missing = 0;
    for (const n of ["FinishCustomGameSetup", "SetPreGameTime", "SetHeroSelectionTime", "SetStrategyTime", "SetShowcaseTime"]) {
      const ok = text.includes(n);
      if (!ok) missing++;
      console.log(n, ok ? "OK" : "MISSING");
    }
    process.exit(missing > 0 ? 1 : 0);
  }, 5500);
});

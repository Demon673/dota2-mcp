#!/usr/bin/env node
// Offline smoke: the packaged Node SEA executable starts and exits cleanly on stdin EOF.
// Run after `npm run package`; the release workflow runs it on every platform before uploading.
// A failure here means the artifact is dead on arrival (e.g. a module-load exception in the bundle).
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import assert from "node:assert/strict";
import { freePortBlock } from "./lib-test-ports.mjs";

const platform = process.platform;
const defaultName = platform === "win32" ? "dota2-mcp.exe" : "dota2-mcp";
let outputName = process.env.SEA_OUTPUT_NAME || defaultName;
// sea-package.mjs appends .exe on Windows; mirror it so SEA_OUTPUT_NAME=...-win finds the file.
if (platform === "win32" && !outputName.toLowerCase().endsWith(".exe")) outputName += ".exe";
const exe = path.join("dist", outputName);

if (!fs.existsSync(exe)) {
  console.error(`smoke-sea-package: missing ${exe}; run npm run package first`);
  process.exit(1);
}

const state = fs.mkdtempSync(path.join(os.tmpdir(), "sea-smoke-"));
const base = await freePortBlock(3);
try {
  const r = spawnSync(exe, [], {
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 30000,
    env: {
      ...process.env,
      DOTA2_VCON_STATE_DIR: state,
      DOTA2_VCON_DOTA_PORT: String(base),
      DOTA2_VCON_GUI_PORT: String(base + 1),
      DOTA2_VCON_CTRL_PORT: String(base + 2),
      DOTA2_VCON_AUTO_OPEN_VCONSOLE: "0",
      DOTA2_CAPTURE_DISABLE_WATCHER: "1",
    },
  });
  const stderr = (r.stderr || "").toString().trim();

  if (r.error) {
    console.error(`smoke-sea-package: could not run ${exe}: ${r.error.message}${stderr ? `\n${stderr}` : ""}`);
    throw new Error("packaged executable did not run");
  }
  if (r.status !== 0) {
    console.error(`smoke-sea-package: ${exe} exited ${r.status}${stderr ? `\n${stderr}` : ""}`);
    throw new Error("packaged executable failed");
  }
  console.log(`smoke-sea-package: PASS ${exe} starts and exits on stdin EOF`);
} finally {
  let pid;
  try { pid = Number(fs.readFileSync(path.join(state, "relay.pid"), "utf8")); } catch {}
  if (Number.isInteger(pid) && pid > 0) {
    try { process.kill(pid); } catch {}
    for (let i = 0; i < 50; i++) {
      try { process.kill(pid, 0); } catch { break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.throws(() => process.kill(pid, 0), "isolated daemon exits before state cleanup");
  }
  assert.equal(path.dirname(fs.realpathSync(state)), fs.realpathSync(os.tmpdir()));
  fs.rmSync(state, { recursive: true, force: true });
}

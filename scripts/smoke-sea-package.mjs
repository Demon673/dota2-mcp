#!/usr/bin/env node
// Offline smoke: the packaged Node SEA executable starts and exits cleanly on stdin EOF.
// Run after `npm run package`; the release workflow runs it on every platform before uploading.
// A failure here means the artifact is dead on arrival (e.g. a module-load exception in the bundle).
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

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

const r = spawnSync(exe, [], {
  stdio: ["ignore", "ignore", "pipe"],
  timeout: 30000,
});
const stderr = (r.stderr || "").toString().trim();

if (r.error) {
  console.error(`smoke-sea-package: could not run ${exe}: ${r.error.message}${stderr ? `\n${stderr}` : ""}`);
  process.exit(1);
}
if (r.status !== 0) {
  console.error(`smoke-sea-package: ${exe} exited ${r.status}${stderr ? `\n${stderr}` : ""}`);
  process.exit(1);
}
console.log(`smoke-sea-package: PASS ${exe} starts and exits on stdin EOF`);

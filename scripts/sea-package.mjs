import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

const platform = process.platform;
const isWin = platform === "win32";
const defaultName = isWin ? "dota2-mcp.exe" : "dota2-mcp";
const outputName = process.env.SEA_OUTPUT_NAME || defaultName;
const outputPath = path.join("dist", outputName);
const nodeBinary = process.execPath;

console.log(`[sea-package] Platform: ${platform}`);
console.log(`[sea-package] Node binary: ${nodeBinary}`);
console.log(`[sea-package] Output: ${outputPath}`);

// Copy the Node binary that is currently running the script.
fs.copyFileSync(nodeBinary, outputPath);

// Generate the SEA blob.
const blobResult = spawnSync("node", ["--experimental-sea-config", "sea-config.json"], {
  stdio: "inherit",
  shell: true,
});
if (blobResult.status !== 0) {
  console.error("[sea-package] Failed to generate SEA blob");
  process.exit(blobResult.status || 1);
}

// Inject the blob into the copied Node binary with postject.
const postjectArgs = [
  outputPath,
  "NODE_SEA_BLOB",
  "sea-prep.blob",
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
];

if (platform === "darwin") {
  postjectArgs.push("--macho-segment-name", "NODE_SEA");
}

const postjectResult = spawnSync("npx", ["postject", ...postjectArgs], {
  stdio: "inherit",
  shell: true,
});
if (postjectResult.status !== 0) {
  console.error("[sea-package] postject failed");
  process.exit(postjectResult.status || 1);
}

// macOS: ad-hoc sign the resulting binary so Gatekeeper allows it to run.
if (platform === "darwin") {
  const signResult = spawnSync("codesign", ["--sign", "-", "--force", outputPath], {
    stdio: "inherit",
  });
  if (signResult.status !== 0) {
    console.error("[sea-package] codesign failed");
    process.exit(signResult.status || 1);
  }
}

console.log(`[sea-package] Packaged ${outputPath}`);

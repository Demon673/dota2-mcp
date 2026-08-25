// 离线 vrf_ensure 冒烟：fake GitHub Release API + 真 zip fixture（adm-zip 生成）
// 断言：下载→解压→缓存、二次调用 cached、sha256 篡改拒绝、资产缺失报错。
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { ensureVrf } from "../dist/tools/vrf-ensure.js";

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("ok -", msg);
}

// 1. 生成假 CLI zip（含一个可执行脚本）与篡改 zip
const goodZip = new AdmZip();
goodZip.addFile("Source2Viewer-CLI", Buffer.from("#!/bin/sh\\necho fake-vrf\\n"));
const goodBuf = goodZip.toBuffer();
const badZip = new AdmZip();
badZip.addFile("Source2Viewer-CLI", Buffer.from("#!/bin/sh\\necho tampered\\n"));
const badBuf = badZip.toBuffer();
const goodSha = createHash("sha256").update(goodBuf).digest("hex");

// 2. fake Release API server
const server = createServer((req, res) => {
  const url = req.url || "";
  if (url.includes("/releases/tags/9.9.9")) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      tag_name: "9.9.9",
      assets: [{
        name: "cli-linux-x64.zip",
        browser_download_url: "http://127.0.0.1:" + PORT + "/good.zip",
        size: goodBuf.length,
        digest: "sha256:" + goodSha,
      }],
    }));
  } else if (url.includes("/releases/tags/8.8.8")) {
    // 篡改 zip：digest 对不上
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      tag_name: "8.8.8",
      assets: [{
        name: "cli-linux-x64.zip",
        browser_download_url: "http://127.0.0.1:" + PORT + "/bad.zip",
        size: badBuf.length,
        digest: "sha256:" + goodSha,
      }],
    }));
  } else if (url.includes("/releases/tags/7.7.7")) {
    // 无本平台资产
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ tag_name: "7.7.7", assets: [{ name: "cli-freebsd-x64.zip", browser_download_url: "http://x/", size: 1 }] }));
  } else if (url.includes("/releases/tags/6.6.6")) {
    res.statusCode = 404;
    res.end("not found");
  } else if (url.endsWith("/good.zip")) {
    res.end(goodBuf);
  } else if (url.endsWith("/bad.zip")) {
    res.end(badBuf);
  } else {
    res.statusCode = 404;
    res.end("unknown");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const API = "http://127.0.0.1:" + PORT;
const cache = mkdtempSync(path.join(tmpdir(), "vrf-test-"));

try {
  // 首次：下载 + 解压 + 缓存
  const r1 = await ensureVrf({ version: "9.9.9", cacheDir: cache, apiBase: API });
  assert(r1.ok, "first ensure downloads: " + r1.message);
  assert(!r1.cached && r1.sha256Ok, "first ensure is fresh + sha256 verified");
  assert(r1.executable && existsSync(r1.executable), "executable exists after install");
  const exeContent = readFileSync(r1.executable, "utf8");
  assert(exeContent.includes("fake-vrf"), "extracted the zip payload");

  // 二次：缓存命中
  const r2 = await ensureVrf({ version: "9.9.9", cacheDir: cache, apiBase: API });
  assert(r2.ok && r2.cached, "second ensure is cached");

  // 篡改：sha256 拒绝
  const r3 = await ensureVrf({ version: "8.8.8", cacheDir: cache, apiBase: API });
  assert(!r3.ok && r3.message.includes("sha256 mismatch"), "tampered zip rejected: " + r3.message);

  // 无匹配资产
  const r4 = await ensureVrf({ version: "7.7.7", cacheDir: cache, apiBase: API });
  assert(!r4.ok && r4.message.includes("No asset"), "missing platform asset reported");

  // 版本不存在
  const r5 = await ensureVrf({ version: "6.6.6", cacheDir: cache, apiBase: API });
  assert(!r5.ok && r5.message.includes("404"), "unknown version reported: " + r5.message);

  console.log("PASS");
} finally {
  server.close();
  rmSync(cache, { recursive: true, force: true });
}
process.exit(0);

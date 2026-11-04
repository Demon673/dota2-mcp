// 离线 vrf_ensure 冒烟：fake GitHub Release API + 真 zip fixture（adm-zip 生成）
// 断言：下载→解压→缓存、二次调用 cached、sha256 篡改拒绝、资产缺失报错。
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { ensureVrf } from "../dist/tools/vrf-ensure.js";

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("ok -", msg);
}

// 1. 生成假 CLI zip（含一个可执行脚本）与篡改 zip
// 两个平台的可执行名都放进去：win32 的 EXE_BASE 带 .exe（vrf-ensure.ts:27）
const CLI_FILE_NAMES = ["Source2Viewer-CLI", "Source2Viewer-CLI.exe"];
const goodZip = new AdmZip();
for (const name of CLI_FILE_NAMES) goodZip.addFile(name, Buffer.from("#!/bin/sh\\necho fake-vrf\\n"));
const goodBuf = goodZip.toBuffer();
const badZip = new AdmZip();
for (const name of CLI_FILE_NAMES) badZip.addFile(name, Buffer.from("#!/bin/sh\\necho tampered\\n"));
const badBuf = badZip.toBuffer();

// 资产名由 platformAssetName() 按本机平台算（cli-{windows,linux,macos}-{x64,arm64,arm}.zip）；
// fixture 把九个都摆上，测试就不再绑死在某个平台上。
const ASSET_NAMES = ["windows", "linux", "macos"].flatMap((os) =>
  ["x64", "arm64", "arm"].map((arch) => `cli-${os}-${arch}.zip`));
const goodSha = createHash("sha256").update(goodBuf).digest("hex");
const incompleteZip = new AdmZip();
incompleteZip.addFile("unrelated.txt", Buffer.from("incomplete"));
const incompleteBuf = incompleteZip.toBuffer();
let concurrentLookups = 0;

// 2. fake Release API server
const server = createServer((req, res) => {
  const url = req.url || "";
  if (url.includes("/releases/tags/9.9.9")) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      tag_name: "9.9.9",
      assets: ASSET_NAMES.map((name) => ({
        name,
        browser_download_url: "http://127.0.0.1:" + PORT + "/good.zip",
        size: goodBuf.length,
        digest: "sha256:" + goodSha,
      })),
    }));
  } else if (url.includes("/releases/tags/8.8.8")) {
    // 篡改 zip：digest 对不上
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      tag_name: "8.8.8",
      assets: ASSET_NAMES.map((name) => ({
        name,
        browser_download_url: "http://127.0.0.1:" + PORT + "/bad.zip",
        size: badBuf.length,
        digest: "sha256:" + goodSha,
      })),
    }));
  } else if (url.includes("/releases/tags/7.7.7")) {
    // 无本平台资产
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ tag_name: "7.7.7", assets: [{ name: "cli-freebsd-x64.zip", browser_download_url: "http://x/", size: 1 }] }));
  } else if (url.includes("/releases/tags/6.6.6")) {
    res.statusCode = 404;
    res.end("not found");
  } else if (url.includes("/releases/tags/2.2.2")) {
    res.end(JSON.stringify({ assets: ASSET_NAMES.map((name) => ({ name, browser_download_url: `http://127.0.0.1:${PORT}/good.zip`, digest: "sha256:" + goodSha })) }));
  } else if (url.includes("/releases/tags/5.5.5")) {
    res.end(JSON.stringify({ assets: ASSET_NAMES.map((name) => ({ name, browser_download_url: `http://127.0.0.1:${PORT}/good.zip` })) }));
  } else if (url.includes("/releases/tags/4.4.4")) {
    const incomplete = concurrentLookups++ > 0;
    res.end(JSON.stringify({ assets: ASSET_NAMES.map((name) => ({ name, browser_download_url: `http://127.0.0.1:${PORT}/${incomplete ? "incomplete" : "good"}.zip`, digest: "sha256:" + (incomplete ? createHash("sha256").update(incompleteBuf).digest("hex") : goodSha) })) }));
  } else if (url.includes("/releases/tags/3.3.3")) {
    res.end(JSON.stringify({ message: "malformed release metadata" }));
  } else if (url.endsWith("/incomplete.zip")) {
    setTimeout(() => res.end(incompleteBuf), 100);
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

  const noDigest = await ensureVrf({ version: "5.5.5", cacheDir: cache, apiBase: API });
  assert(!noDigest.ok && /digest/.test(noDigest.message), "VRF refuses an executable archive without a checksum");
  const malformed = await ensureVrf({ version: "3.3.3", cacheDir: cache, apiBase: API });
  assert(!malformed.ok && /metadata/.test(malformed.message), "malformed release JSON is a structured lookup failure");
  const invalid = await ensureVrf({ version: "../../../outside", cacheDir: path.join(cache, "nested"), apiBase: API });
  assert(!invalid.ok && /Invalid.*version/.test(invalid.message), "release versions cannot traverse outside the cache");
  const concurrent = await Promise.all([0, 1].map(() => ensureVrf({ version: "4.4.4", cacheDir: cache, apiBase: API })));
  assert(concurrent[0].ok && !concurrent[1].ok && existsSync(concurrent[0].executable), "a failed concurrent extraction preserves the successful install");
  mkdirSync(path.join(cache, "v2.2.2"));
  writeFileSync(path.join(cache, "v2.2.2", "partial.txt"), "legacy incomplete cache");
  const recovered = await ensureVrf({ version: "2.2.2", cacheDir: cache, apiBase: API });
  assert(recovered.ok && existsSync(recovered.executable), "an incomplete legacy cache does not block a verified install");

  console.log("PASS");
} finally {
  server.close();
  rmSync(cache, { recursive: true, force: true });
}
process.exit(0);

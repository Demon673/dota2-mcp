// 离线 dota_perf 冒烟：假 PresentMon 写固定 CSV。
// 断言：分位数/样本数/采集时长、基线差值、空 CSV 与缺失二进制的失败路径、
// 以及注入二进制时不会触碰 release API（下载助手只在本地假服务器上验证）。
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runPerf, ensurePresentMon } from "../dist/tools/perf.js";

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("ok -", msg);
}

const work = mkdtempSync(path.join(tmpdir(), "perf-test-"));
process.env.DOTA2_PERF_DIR = path.join(work, "perf");

// 计数服务器：注入 DOTA2_PRESENTMON 后，任何一次采集都不应该访问 release API。
let apiHits = 0;
const counting = createServer((req, res) => { apiHits++; res.statusCode = 500; res.end("unexpected"); });
await new Promise((r) => counting.listen(0, "127.0.0.1", r));
process.env.DOTA2_PRESENTMON_API_BASE = "http://127.0.0.1:" + counting.address().port;

// 假 GitHub Release API：只服务测试用版本，验证固定版本下载与 sha256 校验，不触网。
const goodBinary = Buffer.from("fake-presentmon-binary");
const goodSha = createHash("sha256").update(goodBinary).digest("hex");
const fakeApi = createServer((req, res) => {
  const url = req.url || "";
  const base = "http://127.0.0.1:" + fakeApi.address().port;
  const json = (body) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };
  const release = (version, assets) => ({ tag_name: "v" + version, assets });
  const asset = (version, pathname, digest) => ({
    name: `PresentMon-${version}-x64.exe`,
    browser_download_url: base + pathname,
    size: 1,
    ...(digest ? { digest } : {}),
  });
  if (url.includes("/releases/tags/v9.9.9")) json(release("9.9.9", [asset("9.9.9", "/good.exe", "sha256:" + goodSha)]));
  else if (url.includes("/releases/tags/v8.8.8")) json(release("8.8.8", [asset("8.8.8", "/tampered.exe", "sha256:" + goodSha)]));
  else if (url.includes("/releases/tags/v7.7.7")) json(release("7.7.7", [{ name: "other.zip", browser_download_url: base + "/other.zip", size: 1 }]));
  else if (url.includes("/releases/tags/v6.6.6")) json(release("6.6.6", [asset("6.6.6", "/missing.exe", "sha256:" + goodSha)]));
  else if (url.includes("/releases/tags/v5.5.5")) json(release("5.5.5", [asset("5.5.5", "/good.exe", null)]));
  else if (url === "/good.exe") res.end(goodBinary);
  else if (url === "/tampered.exe") res.end(Buffer.from("tampered"));
  else { res.statusCode = 404; res.end("not found"); }
});
await new Promise((r) => fakeApi.listen(0, "127.0.0.1", r));
const API = "http://127.0.0.1:" + fakeApi.address().port;

// 假 PresentMon：--output_file 指向的 CSV 里写 100 帧；MsBetweenPresents=1..100，
// MsInPresentAPI=0.01..1.00，TimeInSeconds 每帧 +0.01（首尾差 0.99s）。
const HEADER = "Application,ProcessID,SwapChainAddress,PresentRuntime,SyncInterval,PresentFlags,AllowsTearing,PresentMode,FrameType,TimeInSeconds,MSBetweenSimulationStart,MsBetweenPresents,MsBetweenDisplayChange,MsInPresentAPI,MsRenderPresentLatency,MsUntilDisplayed,MsPCLatency,CPUStartTime";
const fake = path.join(work, "fake-presentmon.mjs");
writeFileSync(fake, [
  'import { writeFileSync } from "node:fs";',
  'const args = process.argv.slice(2);',
  'const at = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };',
  'const header = ' + JSON.stringify(HEADER) + ';',
  'const rows = [];',
  'for (let i = 1; i <= 100; i++) {',
  '  rows.push(["dota2.exe", 1, "0x0", "DXGI", 1, 0, 0, "Composed", "Application", (i - 1) / 100, 0, i, i / 100, i / 100, 0, 0, 0, (i - 1) * 10].join(","));',
  '}',
  'writeFileSync(at("--output_file"), header + "\\n" + rows.join("\\n") + "\\n");',
  'writeFileSync(at("--output_file") + ".args.json", JSON.stringify(args));',
].join("\n"));

// 基线 CSV：同结构，MsBetweenPresents=11..110（p50=60、p95=105、p99=109）。
const baselineCsv = path.join(work, "baseline.csv");
const baselineRows = [];
for (let i = 1; i <= 100; i++) {
  baselineRows.push(["dota2.exe", 1, "0x0", "DXGI", 1, 0, 0, "Composed", "Application", (i - 1) / 100, 0, i + 10, (i + 10) / 100, (i + 10) / 100, 0, 0, 0, (i - 1) * 10].join(","));
}
writeFileSync(baselineCsv, HEADER + "\n" + baselineRows.join("\n") + "\n");

process.env.DOTA2_PRESENTMON = fake;

try {
  // 1. 正常采集：分位数、样本数、时长、MsInPresentAPI
  const r = await runPerf({ seconds: 15 });
  assert(r.ok, "perf run succeeds with an injected PresentMon: " + (r.ok ? "" : r.message));
  assert(r.data.process === "dota2.exe", "default process is dota2.exe");
  assert(r.data.samples === 100, "sample count counts CSV rows with a valid MsBetweenPresents");
  assert(r.data.p50_ms === 50 && r.data.p95_ms === 95 && r.data.p99_ms === 99,
    "nearest-rank percentiles: " + JSON.stringify([r.data.p50_ms, r.data.p95_ms, r.data.p99_ms]));
  assert(r.data.duration_s === 0.99, "captured duration comes from the CSV timestamps");
  assert(r.data.in_present?.p50_ms === 0.5 && r.data.in_present?.p95_ms === 0.95 && r.data.in_present?.p99_ms === 0.99,
    "MsInPresentAPI is summarized when present");
  assert(existsSync(r.data.csv_path), "measured CSV path is returned and exists");
  assert(r.text.includes("p95") && r.text.includes("dota2.exe"), "text summary names the process and percentiles");
  const forwarded = JSON.parse(readFileSync(r.data.csv_path + ".args.json", "utf8"));
  assert(forwarded.includes("--process_name") && forwarded.includes("dota2.exe")
    && forwarded.includes("--timed") && forwarded.includes("15") && forwarded.includes("--output_file"),
    "the pinned invocation flags are forwarded to PresentMon");

  // 2. 进程名覆盖
  const custom = await runPerf({ seconds: 5, processName: "custom.exe" });
  assert(custom.ok && custom.data.process === "custom.exe", "process_name override is reported back");
  const customArgs = JSON.parse(readFileSync(custom.data.csv_path + ".args.json", "utf8"));
  assert(customArgs.includes("custom.exe") && customArgs.includes("5"), "process_name and duration reach PresentMon");

  // 3. 基线：上次的指标对象
  const byMetrics = await runPerf({ baseline: { p50_ms: 40, p95_ms: 80, p99_ms: 90 } });
  assert(byMetrics.ok && byMetrics.data.baseline?.source === "metrics", "metrics baseline is accepted");
  assert(byMetrics.data.baseline.delta_p50_ms === 10 && byMetrics.data.baseline.delta_p95_ms === 15
    && byMetrics.data.baseline.delta_p99_ms === 9,
    "baseline deltas are current minus metrics baseline: " + JSON.stringify(byMetrics.data.baseline));

  // 4. 基线：上次返回的 CSV 路径（p50=60、p95=105、p99=109）
  const byCsv = await runPerf({ baseline: baselineCsv });
  assert(byCsv.ok && byCsv.data.baseline?.source === "csv", "CSV baseline is accepted");
  assert(byCsv.data.baseline.delta_p50_ms === -10 && byCsv.data.baseline.delta_p95_ms === -10
    && byCsv.data.baseline.delta_p99_ms === -10,
    "baseline deltas subtract CSV percentiles: " + JSON.stringify(byCsv.data.baseline));
  assert(byCsv.text.includes("Baseline"), "text summary mentions the baseline delta");

  // 5. 基线路径不存在：契约错误而不是静默忽略
  const badBaseline = await runPerf({ baseline: path.join(work, "missing.csv") });
  assert(!badBaseline.ok && badBaseline.code === "invalid_arg" && badBaseline.message.includes("Baseline"),
    "unreadable baseline is invalid_arg: " + JSON.stringify(badBaseline));

  // 6. 空 CSV（只有表头）——管理员权限缺失时 ETW 起不来的典型结果
  const empty = path.join(work, "empty-presentmon.mjs");
  writeFileSync(empty, [
    'import { writeFileSync } from "node:fs";',
    'const args = process.argv.slice(2);',
    'writeFileSync(args[args.indexOf("--output_file") + 1], ' + JSON.stringify(HEADER + "\n") + ');',
  ].join("\n"));
  process.env.DOTA2_PRESENTMON = empty;
  const emptyRun = await runPerf({ seconds: 5 });
  assert(!emptyRun.ok && emptyRun.code === "internal" && emptyRun.message.includes("elevated terminal"),
    "empty CSV reports the elevated-terminal requirement: " + JSON.stringify(emptyRun));

  // 7. CSV 完全缺失（PresentMon 提前失败）
  const noCsv = path.join(work, "no-csv-presentmon.mjs");
  writeFileSync(noCsv, "process.exit(1);\n");
  process.env.DOTA2_PRESENTMON = noCsv;
  const noCsvRun = await runPerf({ seconds: 5 });
  assert(!noCsvRun.ok && noCsvRun.code === "internal" && noCsvRun.message.includes("elevated terminal"),
    "missing CSV reports the elevated-terminal requirement: " + JSON.stringify(noCsvRun));

  // 8. 二进制缺失（获取/缓存后文件不在）：报错而不是 spawn 失败
  process.env.DOTA2_PRESENTMON = path.join(work, "missing", "PresentMon.exe");
  const missing = await runPerf({ seconds: 5 });
  assert(!missing.ok && missing.code === "internal" && missing.message.includes("not found"),
    "missing PresentMon binary fails before sampling: " + JSON.stringify(missing));

  // 9. 时长越界
  const badSeconds = await runPerf({ seconds: 0 });
  assert(!badSeconds.ok && badSeconds.code === "invalid_arg", "seconds outside 1..600 is invalid_arg");

  // 10. 固定版本下载：sha256 校验、缓存命中、拒绝篡改/缺资产/失败下载/缺摘要
  delete process.env.DOTA2_PRESENTMON;
  const cache = path.join(work, "presentmon-cache");
  const first = await ensurePresentMon({ version: "9.9.9", cacheDir: cache, apiBase: API });
  assert(first.ok && !first.cached && first.sha256Ok === true, "pinned download verifies sha256: " + first.message);
  assert(first.executable && existsSync(first.executable) && readFileSync(first.executable).equals(goodBinary),
    "downloaded binary is cached with the release bytes");
  const cachedAgain = await ensurePresentMon({ version: "9.9.9", cacheDir: cache, apiBase: API });
  assert(cachedAgain.ok && cachedAgain.cached, "second ensure hits the cache");
  const tampered = await ensurePresentMon({ version: "8.8.8", cacheDir: cache, apiBase: API });
  assert(!tampered.ok && tampered.message.includes("sha256 mismatch"), "tampered download is rejected: " + tampered.message);
  const noAsset = await ensurePresentMon({ version: "7.7.7", cacheDir: cache, apiBase: API });
  assert(!noAsset.ok && noAsset.message.includes("No asset"), "missing release asset is reported: " + noAsset.message);
  const failedDownload = await ensurePresentMon({ version: "6.6.6", cacheDir: cache, apiBase: API });
  assert(!failedDownload.ok && failedDownload.message.includes("download failed (HTTP 404)"),
    "failed download is reported: " + failedDownload.message);
  assert(!existsSync(path.join(cache, "v6.6.6", "PresentMon.exe")), "failed download leaves no binary behind");
  const unverified = await ensurePresentMon({ version: "5.5.5", cacheDir: cache, apiBase: API });
  assert(!unverified.ok && unverified.message.includes("sha256"), "a release without a digest is refused as unverified");

  // 11. 注入二进制时，runPerf 从未访问 release API
  assert(apiHits === 0, "no release API request while DOTA2_PRESENTMON is injected (hits=" + apiHits + ")");

  console.log("PASS");
} finally {
  counting.close();
  fakeApi.close();
  rmSync(work, { recursive: true, force: true });
}
process.exit(0);

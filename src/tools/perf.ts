// dota_perf：用 PresentMon 采样进程帧时间，返回 p50/p95/p99。Windows only（ETW）。
// PresentMon 与 VRF 一样固定版本获取；DOTA2_PRESENTMON 可注入现成二进制（离线测试）。
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { runCommand, nodeInvocation } from "./exec.js";
import { fetchPinnedReleaseAsset } from "./pinned-release.js";

export const DEFAULT_SECONDS = 15;
const MAX_SECONDS = 600;
/** 固定版本：PresentMon release 资产为单文件 exe，GitHub API 提供 sha256 digest。 */
export const PRESENTMON_VERSION = "2.6.0";
const PRESENTMON_REPO = "GameTechDev/PresentMon";

/** 分位数（毫秒，保留三位小数）；也直接充当 baseline 指标对象。 */
export interface PerfPercentiles {
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
}

export interface PerfOptions {
  seconds?: number;
  processName?: string;
  baseline?: string | PerfPercentiles;
}

export interface PerfData extends PerfPercentiles {
  process: string;
  duration_s: number;
  samples: number;
  csv_path: string;
  in_present?: PerfPercentiles;
  /** 当前值减基线值；正数表示这次更慢。 */
  baseline?: PerfBaselineDelta;
}

export interface PerfBaselineDelta {
  source: string;
  delta_p50_ms: number;
  delta_p95_ms: number;
  delta_p99_ms: number;
}

export type PerfOutcome =
  | { ok: true; data: PerfData; text: string }
  | { ok: false; code: "invalid_arg" | "internal"; message: string };

export interface PresentMonInfo {
  ok: boolean;
  executable: string | null;
  version: string | null;
  cached: boolean;
  sha256Ok?: boolean;
  message: string;
}

interface CsvData {
  between: number[];
  inPresent: number[];
  duration: number | null;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** nearest-rank 分位数：第 ceil(p%×N) 个升序样本。固定样本下结果可手算复核。 */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return round3(sorted[rank - 1]);
}

function num(raw: string | undefined): number {
  const text = raw?.trim();
  return text ? Number(text) : NaN;
}

/** 最小 CSV 行切分：PresentMode 等字段可能带引号，按引号外的逗号切。 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) {
      out.push(cell);
      cell = "";
    } else cell += c;
  }
  out.push(cell);
  return out;
}

/** 解析 PresentMon CSV。列名大小写随版本/文档写法不一，统一小写比较；NA/空值跳过。 */
function parsePerfCsv(text: string): CsvData | null {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return null;
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const betweenIdx = header.indexOf("msbetweenpresents");
  const inPresentIdx = header.findIndex((h) => h === "msinpresentapi" || h === "msinpresent");
  const timeIdx = header.indexOf("timeinseconds");
  const cpuIdx = header.indexOf("cpustarttime");
  if (betweenIdx < 0) return null;

  const between: number[] = [];
  const inPresent: number[] = [];
  const times: number[] = [];
  const cpuStart: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const b = num(cells[betweenIdx]);
    if (!Number.isFinite(b)) continue;
    between.push(b);
    if (inPresentIdx >= 0) {
      const v = num(cells[inPresentIdx]);
      if (Number.isFinite(v)) inPresent.push(v);
    }
    if (timeIdx >= 0) {
      const v = num(cells[timeIdx]);
      if (Number.isFinite(v)) times.push(v);
    }
    if (cpuIdx >= 0) {
      const v = num(cells[cpuIdx]);
      if (Number.isFinite(v)) cpuStart.push(v);
    }
  }

  let duration: number | null = null;
  if (times.length >= 2) duration = times[times.length - 1] - times[0];
  else if (cpuStart.length >= 2) duration = (cpuStart[cpuStart.length - 1] - cpuStart[0]) / 1000;
  else if (between.length > 0) duration = between.reduce((a, b) => a + b, 0) / 1000;
  return { between, inPresent, duration };
}

/** 解析一个 PresentMon CSV 文件；失败返回 null。 */
function readPerfCsv(file: string): CsvData | null {
  try { return parsePerfCsv(readFileSync(file, "utf8")); } catch { return null; }
}

export interface EnsurePresentMonOptions {
  version?: string;
  cacheDir?: string;
  apiBase?: string;
}

/** 确保 PresentMon 可用：DOTA2_PRESENTMON 注入优先（测试/手工安装），否则按固定版本下载并校验 sha256。 */
export async function ensurePresentMon(opts: EnsurePresentMonOptions = {}): Promise<PresentMonInfo> {
  const override = process.env.DOTA2_PRESENTMON;
  if (override) {
    if (!existsSync(override)) {
      return { ok: false, executable: null, version: null, cached: false, message: `PresentMon binary not found at ${override} (DOTA2_PRESENTMON).` };
    }
    return { ok: true, executable: override, version: null, cached: true, message: `PresentMon (${override})` };
  }

  const version = opts.version ?? PRESENTMON_VERSION;
  const cacheRoot = opts.cacheDir ?? path.join(tmpdir(), "dota2-mcp", "presentmon");
  const apiBase = opts.apiBase ?? process.env.DOTA2_PRESENTMON_API_BASE ?? "https://api.github.com";
  const installDir = path.join(cacheRoot, "v" + version);
  const exe = path.join(installDir, "PresentMon.exe");
  if (existsSync(exe)) {
    return { ok: true, executable: exe, version, cached: true, message: `PresentMon v${version} (cached at ${exe})` };
  }

  const assetName = `PresentMon-${version}-x64.exe`;
  const got = await fetchPinnedReleaseAsset({ apiBase, repo: PRESENTMON_REPO, version: "v" + version, assetName });
  if (!got.ok) {
    const message =
      got.stage === "lookup"
        ? got.status !== undefined
          ? `PresentMon release v${version} lookup failed (HTTP ${got.status}).`
          : `PresentMon release lookup failed: ${got.error}`
        : got.stage === "asset"
          ? `No asset ${assetName} in PresentMon release v${version}. Available: ${got.available.join(", ")}`
          : got.stage === "download"
            ? got.status !== undefined
              ? `PresentMon download failed (HTTP ${got.status})`
              : `PresentMon download failed: ${got.error}`
            : `PresentMon sha256 mismatch: expected ${got.expected} got ${got.actual}. Download not trusted; nothing cached.`;
    return { ok: false, executable: null, version, cached: false, message };
  }
  if (!got.sha256Ok) {
    return { ok: false, executable: null, version, cached: false, message: `PresentMon release v${version} has no sha256 digest; refusing to install an unverified binary.` };
  }

  let tmp = "";
  try {
    mkdirSync(installDir, { recursive: true });
    tmp = path.join(installDir, `PresentMon.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
    writeFileSync(tmp, got.data);
    renameSync(tmp, exe);
  } catch (e) {
    try { if (tmp) rmSync(tmp, { force: true }); } catch { /* 已被 rename 或从未创建 */ }
    return { ok: false, executable: null, version, cached: false, message: `PresentMon install failed: ${(e as Error).message}` };
  }
  return { ok: true, executable: exe, version, cached: false, sha256Ok: true, message: `PresentMon v${version} installed at ${exe} (sha256 verified)` };
}

/** 基线在接受采样前解析：路径写错时不必先等 N 秒。 */
function resolveBaseline(baseline: string | PerfPercentiles | undefined):
  { ok: true; values: PerfPercentiles; source: string } | { ok: false; message: string } | null {
  if (baseline === undefined) return null;
  if (typeof baseline === "string") {
    const parsed = readPerfCsv(baseline);
    if (!parsed || parsed.between.length === 0) {
      return { ok: false, message: `Baseline CSV has no MsBetweenPresents samples: ${baseline}` };
    }
    return {
      ok: true,
      source: "csv",
      values: {
        p50_ms: percentile(parsed.between, 50),
        p95_ms: percentile(parsed.between, 95),
        p99_ms: percentile(parsed.between, 99),
      },
    };
  }
  const values = [baseline.p50_ms, baseline.p95_ms, baseline.p99_ms];
  if (!values.every((v) => Number.isFinite(v))) {
    return { ok: false, message: "Baseline metrics must contain numeric p50_ms, p95_ms and p99_ms." };
  }
  return { ok: true, source: "metrics", values: baseline };
}

/** 采样一次并解析；失败时返回契约错误而不是空分位数。 */
export async function runPerf(opts: PerfOptions = {}): Promise<PerfOutcome> {
  const seconds = opts.seconds ?? DEFAULT_SECONDS;
  const processName = opts.processName?.trim() || "dota2.exe";
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SECONDS) {
    return { ok: false, code: "invalid_arg", message: `seconds must be an integer between 1 and ${MAX_SECONDS}.` };
  }
  const baseline = resolveBaseline(opts.baseline);
  if (baseline && !baseline.ok) return { ok: false, code: "invalid_arg", message: baseline.message };
  if (process.platform !== "win32" && !process.env.DOTA2_PRESENTMON) {
    return { ok: false, code: "internal", message: "dota_perf is Windows-only: PresentMon samples through ETW and has no build for this platform. Nothing was measured." };
  }

  const mon = await ensurePresentMon();
  if (!mon.ok || !mon.executable) return { ok: false, code: "internal", message: mon.message };

  // DOTA2_PERF_DIR 供离线测试隔离产物；默认 os.tmpdir()/dota2-mcp/perf
  const dir = process.env.DOTA2_PERF_DIR || path.join(tmpdir(), "dota2-mcp", "perf");
  mkdirSync(dir, { recursive: true });
  const csvPath = path.join(dir, `perf-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(2).toString("hex")}.csv`);
  const args = ["--process_name", processName, "--timed", String(seconds), "--output_file", csvPath, "--terminate_after_timed"];
  const invocation = nodeInvocation(mon.executable, args);
  const r = await runCommand(invocation.cmd, invocation.args, (seconds + 20) * 1000, 4 * 1024 * 1024);

  const parsed = readPerfCsv(csvPath);
  if (!parsed || parsed.between.length === 0) {
    const detail = (r.stderr || r.error?.message || "").trim().slice(0, 800);
    return {
      ok: false,
      code: "internal",
      message: `PresentMon captured no samples for ${processName} in ${seconds}s. An empty or missing CSV means the ETW capture never started: PresentMon needs an elevated terminal (run the MCP server from an Administrator shell). Confirm Dota 2 is running under that process name.${detail ? ` PresentMon output: ${detail}` : ""}`,
    };
  }

  const data: PerfData = {
    process: processName,
    duration_s: round3(parsed.duration ?? seconds),
    samples: parsed.between.length,
    p50_ms: percentile(parsed.between, 50),
    p95_ms: percentile(parsed.between, 95),
    p99_ms: percentile(parsed.between, 99),
    csv_path: csvPath,
  };
  if (parsed.inPresent.length > 0) {
    data.in_present = {
      p50_ms: percentile(parsed.inPresent, 50),
      p95_ms: percentile(parsed.inPresent, 95),
      p99_ms: percentile(parsed.inPresent, 99),
    };
  }
  if (baseline?.ok) {
    data.baseline = {
      source: baseline.source,
      delta_p50_ms: round3(data.p50_ms - baseline.values.p50_ms),
      delta_p95_ms: round3(data.p95_ms - baseline.values.p95_ms),
      delta_p99_ms: round3(data.p99_ms - baseline.values.p99_ms),
    };
  }

  const lines = [
    `Frame time for ${data.process}: ${data.samples} samples over ${data.duration_s}s.`,
    `p50 ${data.p50_ms} ms, p95 ${data.p95_ms} ms, p99 ${data.p99_ms} ms.`,
    data.in_present ? `In-Present API: p50 ${data.in_present.p50_ms} ms, p95 ${data.in_present.p95_ms} ms, p99 ${data.in_present.p99_ms} ms.` : "",
    data.baseline
      ? `Baseline (${data.baseline.source}): p50 ${data.baseline.delta_p50_ms >= 0 ? "+" : ""}${data.baseline.delta_p50_ms} ms, p95 ${data.baseline.delta_p95_ms >= 0 ? "+" : ""}${data.baseline.delta_p95_ms} ms, p99 ${data.baseline.delta_p99_ms >= 0 ? "+" : ""}${data.baseline.delta_p99_ms} ms (positive = slower).`
      : "",
    `CSV: ${data.csv_path}`,
  ].filter(Boolean);
  return { ok: true, data, text: lines.join("\n") };
}

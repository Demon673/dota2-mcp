// vrf_ensure：检测/下载/校验/缓存 ValveResourceFormat CLI（Source2Viewer-CLI）
// 半集成策略（wayfinder #6/#7 决议）：pin 版本、按 release assets[] 动态匹配平台、sha256 校验、自包含无需 .NET。
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

export interface VrfInfo {
  ok: boolean;
  executable: string | null;
  version: string | null;
  cached: boolean;
  downloadedBytes?: number;
  sha256Ok?: boolean;
  message: string;
}

export interface VrfOptions {
  version?: string;   // pin 版本覆盖（默认 env VRF_VERSION 或 "20.0"）
  cacheDir?: string;  // 缓存目录覆盖（默认 env VRF_CACHE_DIR 或 os.tmpdir()/dota2-mcp/vrf）
  apiBase?: string;   // 测试注入（默认 https://api.github.com）
}

const REPO = "ValveResourceFormat/ValveResourceFormat";
const DEFAULT_VERSION = "20.0";
const EXE_BASE = process.platform === "win32" ? "Source2Viewer-CLI.exe" : "Source2Viewer-CLI";

// TODO(drop-export): 仅 ensureVrf 内部使用，可去掉 export
/** 本机平台 → VRF release 资产名（cli-{os}-{arch}.zip）。 */
export function platformAssetName(): string {
  const os = process.platform === "win32" ? "windows"
    : process.platform === "darwin" ? "macos" : "linux";
  const arch = process.arch === "x64" ? "x64"
    : process.arch === "arm64" ? "arm64" : "arm";
  return `cli-${os}-${arch}.zip`;
}

function normDigest(digest: string | null | undefined): string | null {
  if (!digest) return null;
  const m = digest.toLowerCase().match(/^sha256[:=]?([0-9a-f]{64})$/);
  return m ? m[1] : null;
}

function sha256Of(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** 解压 zip 到目录（zip -9j 扁平结构，exe 在根）。 */
function extractZip(zipPath: string, destDir: string): void {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, true);
  const exe = path.join(destDir, EXE_BASE);
  if (!existsSync(exe)) {
    throw new Error(`archive has no ${EXE_BASE} at its root (unexpected archive layout)`);
  }
  if (process.platform !== "win32") {
    try { chmodSync(exe, 0o755); } catch { /* 忽略（有些文件系统不支持） */ }
  }
}

/** 确保 Source2Viewer-CLI 可用：缓存命中直接返回；否则下载、校验 sha256、解压、缓存。 */
export async function ensureVrf(opts: VrfOptions = {}): Promise<VrfInfo> {
  const version = opts.version ?? process.env.VRF_VERSION ?? DEFAULT_VERSION;
  const cacheRoot = opts.cacheDir ?? process.env.VRF_CACHE_DIR ?? path.join(tmpdir(), "dota2-mcp", "vrf");
  const apiBase = opts.apiBase ?? process.env.VRF_API_BASE ?? "https://api.github.com";
  const installDir = path.join(cacheRoot, "v" + version);
  const exe = path.join(installDir, EXE_BASE);

  if (existsSync(exe)) {
    return { ok: true, executable: exe, version, cached: true, message: `Source2Viewer-CLI v${version} (cached at ${exe})` };
  }

  let release: { tag_name: string; assets: { name: string; browser_download_url: string; size: number; digest?: string | null }[] };
  try {
    const res = await fetch(`${apiBase}/repos/${REPO}/releases/tags/${version}`, {
      signal: AbortSignal.timeout(30000),
      headers: { "User-Agent": "dota2-mcp" },
    });
    if (!res.ok) {
      return { ok: false, executable: null, version, cached: false, message: `VRF release v${version} lookup failed (HTTP ${res.status}). Set VRF_VERSION or install Source2Viewer-CLI manually.` };
    }
    release = await res.json() as typeof release;
  } catch (e) {
    return { ok: false, executable: null, version, cached: false, message: `VRF release lookup failed: ${(e as Error).message}` };
  }

  const want = platformAssetName();
  const asset = release.assets.find((a) => a.name === want);
  if (!asset) {
    return { ok: false, executable: null, version, cached: false, message: `No asset ${want} in release v${version}. Available: ${release.assets.map((a) => a.name).join(", ")}` };
  }

  let data: Buffer;
  try {
    const res = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(600000), headers: { "User-Agent": "dota2-mcp" } });
    if (!res.ok) {
      return { ok: false, executable: null, version, cached: false, message: `VRF download failed (HTTP ${res.status})` };
    }
    data = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return { ok: false, executable: null, version, cached: false, message: `VRF download failed: ${(e as Error).message}` };
  }

  const digest = normDigest((asset as { digest?: string | null }).digest ?? null);
  const actual = sha256Of(data);
  if (digest && digest !== actual) {
    return { ok: false, executable: null, version, cached: false, message: `sha256 mismatch: expected ${digest} got ${actual}. Download not trusted; nothing cached.` };
  }
  const sha256Ok = !!digest && digest === actual;

  const zipPath = path.join(cacheRoot, `${want}.tmp-${randomBytes(4).toString("hex")}`);
  try {
    mkdirSync(path.dirname(zipPath), { recursive: true });
    writeFileSync(zipPath, data);
    extractZip(zipPath, installDir);
    rmSync(zipPath, { force: true });
  } catch (e) {
    try { rmSync(zipPath, { force: true }); } catch { /* ignore */ }
    return { ok: false, executable: null, version, cached: false, message: `VRF extraction failed: ${(e as Error).message}` };
  }

  return { ok: true, executable: exe, version, cached: false, downloadedBytes: data.length, sha256Ok, message: `Source2Viewer-CLI v${version} installed at ${exe} (sha256 ${sha256Ok ? "verified" : "unverified — release digest missing"})` };
}

// vrf_ensure：检测/下载/校验/缓存 ValveResourceFormat CLI（Source2Viewer-CLI）
// 半集成策略（wayfinder #6/#7 决议）：pin 版本、按 release assets[] 动态匹配平台、sha256 校验、自包含无需 .NET。
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, chmodSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { fetchPinnedReleaseAsset } from "./pinned-release.js";

export interface VrfInfo {
  ok: boolean;
  executable: string | null;
  version: string | null;
  cached: boolean;
  sha256Ok?: boolean;
  message: string;
}

export interface VrfOptions {
  version?: string;   // pin 版本覆盖（默认 env VRF_VERSION 或 DEFAULT_VERSION）
  cacheDir?: string;  // 缓存目录覆盖（默认 env VRF_CACHE_DIR 或 os.tmpdir()/dota2-mcp/vrf）
  apiBase?: string;   // 测试注入（默认 https://api.github.com）
}

const REPO = "ValveResourceFormat/ValveResourceFormat";
/** 版本 pin，唯一真源：scripts/check-vrf-version.mjs 只读这一行并与上游最新 release 比对。 */
export const DEFAULT_VERSION = "20.1";
const EXE_BASE = process.platform === "win32" ? "Source2Viewer-CLI.exe" : "Source2Viewer-CLI";

/** 本机平台 → VRF release 资产名（cli-{os}-{arch}.zip）。 */
function platformAssetName(): string {
  const os = process.platform === "win32" ? "windows"
    : process.platform === "darwin" ? "macos" : "linux";
  const arch = process.arch === "x64" ? "x64"
    : process.arch === "arm64" ? "arm64" : "arm";
  return `cli-${os}-${arch}.zip`;
}

/** 解压 zip 到目录（zip -9j 扁平结构，exe 在根）。 */
function extractZip(zipPath: string, destDir: string): void {
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
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version)) {
    return { ok: false, executable: null, version, cached: false, message: "Invalid VRF version: use a single release tag without path separators." };
  }
  const cacheRoot = opts.cacheDir ?? process.env.VRF_CACHE_DIR ?? path.join(tmpdir(), "dota2-mcp", "vrf");
  const apiBase = opts.apiBase ?? process.env.VRF_API_BASE ?? "https://api.github.com";
  const installDir = path.join(cacheRoot, "v" + version);
  const exe = path.join(installDir, "bin", EXE_BASE);
  const cachedExe = [exe, path.join(installDir, EXE_BASE)].find((p) => existsSync(p));

  if (cachedExe) {
    return { ok: true, executable: cachedExe, version, cached: true, message: `Source2Viewer-CLI v${version} (cached at ${cachedExe})` };
  }

  const want = platformAssetName();
  const got = await fetchPinnedReleaseAsset({ apiBase, repo: REPO, version, assetName: want });
  if (!got.ok) {
    const message =
      got.stage === "lookup"
        ? got.status !== undefined
          ? `VRF release v${version} lookup failed (HTTP ${got.status}). Set VRF_VERSION or install Source2Viewer-CLI manually.`
          : `VRF release lookup failed: ${got.error}`
        : got.stage === "asset"
          ? `No asset ${want} in release v${version}. Available: ${got.available.join(", ")}`
          : got.stage === "download"
            ? got.status !== undefined
              ? `VRF download failed (HTTP ${got.status})`
              : `VRF download failed: ${got.error}`
            : `sha256 mismatch: expected ${got.expected} got ${got.actual}. Download not trusted; nothing cached.`;
    return { ok: false, executable: null, version, cached: false, message };
  }
  const { data, sha256Ok } = got;
  if (!sha256Ok) {
    return { ok: false, executable: null, version, cached: false, message: `VRF release v${version} has no sha256 digest; refusing to install an unverified binary.` };
  }

  let staging = "";
  try {
    mkdirSync(installDir, { recursive: true });
    staging = mkdtempSync(path.join(cacheRoot, ".vrf-"));
    const zipPath = path.join(staging, "download.zip");
    const unpacked = path.join(staging, "unpacked");
    writeFileSync(zipPath, data);
    extractZip(zipPath, unpacked);
    try { renameSync(unpacked, path.dirname(exe)); }
    catch (e) {
      if (!existsSync(exe)) throw e;
      return { ok: true, executable: exe, version, cached: true, message: `Source2Viewer-CLI v${version} (cached at ${exe})` };
    }
  } catch (e) {
    return { ok: false, executable: null, version, cached: false, message: `VRF extraction failed: ${(e as Error).message}` };
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
  }

  return { ok: true, executable: exe, version, cached: false, sha256Ok, message: `Source2Viewer-CLI v${version} installed at ${exe} (sha256 verified)` };
}

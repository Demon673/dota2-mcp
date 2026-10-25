// 固定版本 GitHub release 资产的下载 + sha256 校验：vrf_ensure 与 dota_perf 共用。
// 只负责取回字节并校验；缓存/解压格式由调用方决定（VRF 解 zip，PresentMon 直接落 exe）。
import { createHash } from "node:crypto";

export interface PinnedReleaseOptions {
  apiBase: string;
  repo: string;
  version: string; // release tag，调用方负责是否带 v 前缀
  assetName: string;
}

/** 分阶段失败：调用方据此保留自己的错误文案（VRF 与 PresentMon 的提示不同）。 */
export type PinnedReleaseFetch =
  | { ok: true; data: Buffer; sha256Ok: boolean }
  | { ok: false; stage: "lookup"; status?: number; error?: string }
  | { ok: false; stage: "asset"; available: string[] }
  | { ok: false; stage: "download"; status?: number; error?: string }
  | { ok: false; stage: "sha256"; expected: string; actual: string };

function normDigest(digest: string | null | undefined): string | null {
  if (!digest) return null;
  const m = digest.toLowerCase().match(/^sha256[:=]?([0-9a-f]{64})$/);
  return m ? m[1] : null;
}

function sha256Of(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function fetchPinnedReleaseAsset(opts: PinnedReleaseOptions): Promise<PinnedReleaseFetch> {
  let release: { tag_name: string; assets: { name: string; browser_download_url: string; size: number; digest?: string | null }[] };
  try {
    const res = await fetch(`${opts.apiBase}/repos/${opts.repo}/releases/tags/${opts.version}`, {
      signal: AbortSignal.timeout(30000),
      headers: { "User-Agent": "dota2-mcp" },
    });
    if (!res.ok) return { ok: false, stage: "lookup", status: res.status };
    release = await res.json() as typeof release;
  } catch (e) {
    return { ok: false, stage: "lookup", error: (e as Error).message };
  }

  const asset = release.assets.find((a) => a.name === opts.assetName);
  if (!asset) return { ok: false, stage: "asset", available: release.assets.map((a) => a.name) };

  let data: Buffer;
  try {
    const res = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(600000), headers: { "User-Agent": "dota2-mcp" } });
    if (!res.ok) return { ok: false, stage: "download", status: res.status };
    data = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return { ok: false, stage: "download", error: (e as Error).message };
  }

  const expected = normDigest(asset.digest ?? null);
  const actual = sha256Of(data);
  if (expected && expected !== actual) return { ok: false, stage: "sha256", expected, actual };
  return { ok: true, data, sha256Ok: !!expected && expected === actual };
}

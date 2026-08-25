// asset_check_refs：单资产递归引用完整性检查（wayfinder #10 契约）
// 两级解析：addon（content 源 + game 产物）→ game/dota（引擎资产）；编译状态单列 uncompiled。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureVrf } from "./vrf-ensure.js";
import { extractRefs } from "./asset-inspect.js";

export interface RefReport {
  ref: string;
  from: string;      // 引用方（资产路径）
  resolved: string | null;
  issue: string | null;
}

export interface CheckResult {
  ok: boolean;
  text: string;
}

const ASSET_RE = /\.(vmdl|vmat|vtex|vpcf)$/i;

function isAssetRef(ref: string): boolean {
  return ASSET_RE.test(ref);
}

/** 编译产物路径：materials/x.vmat → materials/x.vmat_c（源无 _c，产物带 _c）。 */
function compiledOf(sourcePath: string): string {
  const m = sourcePath.match(/^(.*)(\.vmdl|\.vmat|\.vtex|\.vpcf)$/i);
  return m ? m[1] + m[2] + "_c" : sourcePath + "_c";
}

/** 引用解析：
 *  1. addon 源存在 + 产物存在 → ok
 *  2. addon 源存在 + 产物缺失 → uncompiled
 *  3. addon 不存在 → game/dota 存在（源或产物）→ engine_ref
 *  4. 都不存在 → broken
 */
function resolveOneRef(dotaPath: string, addon: string, ref: string, from: string,): { report: RefReport; kind: "ok" | "uncompiled" | "engine" | "broken"; nextSource: string | null } {
  const clean = ref.replace(/^resource:/, "").replace(/\\/g, "/");
  const addonSrc = path.join(dotaPath, "content", "dota_addons", addon, clean);
  const addonOut = compiledOf(path.join(dotaPath, "game", "dota_addons", addon, clean));
  if (existsSync(addonSrc)) {
    if (existsSync(addonOut)) {
      return { report: { ref: clean, from, resolved: addonOut, issue: null }, kind: "ok", nextSource: addonSrc };
    }
    return { report: { ref: clean, from, resolved: addonSrc, issue: "源存在但编译产物缺失（改了没编译？）" }, kind: "uncompiled", nextSource: addonSrc };
  }
  const engineOut = compiledOf(path.join(dotaPath, "game", "dota", clean));
  if (existsSync(engineOut) || existsSync(path.join(dotaPath, "game", "dota", clean))) {
    return { report: { ref: clean, from, resolved: path.join(dotaPath, "game", "dota", clean), issue: null }, kind: "engine", nextSource: null };
  }
  return { report: { ref: clean, from, resolved: null, issue: "not_found" }, kind: "broken", nextSource: null };
}

function sortKeys<T>(v: T): T {
  if (Array.isArray(v)) return v.map(sortKeys) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
    return out as T;
  }
  return v;
}

/** 反编译一个资产（文本；vtex 跳过——纹理无引用）。 */
function decompileText(exe: string, p: string): string {
  try {
    // 反编译文本走 -o 文件（stdout 是分析摘要）；.NET 无 libicu 时需 invariant 全球化
    const tmp = path.join(tmpdir(), "dota2-mcp", "checkrefs", path.basename(p) + "." + process.pid + ".txt");
    mkdirSync(path.dirname(tmp), { recursive: true });
    execFileSync(exe, ["-i", p, "-o", tmp], {
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1" },
    });
    const text = readFileSync(tmp, "utf-8");
    rmSync(tmp, { force: true });
    return text;
  } catch { return ""; }
}

/** 单资产递归引用检查。 */
export async function checkRefs(dotaPath: string, addon: string, resolvedPath: string, opts: { maxDepth?: number } = {}): Promise<CheckResult> {
  const vrf = await ensureVrf();
  if (!vrf.ok || !vrf.executable) {
    return { ok: false, text: "asset_check_refs needs the VRF CLI: " + vrf.message };
  }
  const maxDepth = opts.maxDepth ?? 3;
  const ok: RefReport[] = [];
  const uncompiled: RefReport[] = [];
  const engineRefs: RefReport[] = [];
  const broken: RefReport[] = [];
  const visited = new Set<string>();
  const queue: { src: string; depth: number }[] = [{ src: resolvedPath, depth: 0 }];

  while (queue.length > 0) {
    const { src, depth } = queue.shift()!;
    if (visited.has(src) || depth > maxDepth) continue;
    visited.add(src);
    const text = decompileText(vrf.executable, src);
    if (!text) continue;
    for (const ref of extractRefs(text)) {
      if (!isAssetRef(ref)) continue;
      const r = resolveOneRef(dotaPath, addon, ref, src);
      if (r.kind === "ok") ok.push(r.report);
      else if (r.kind === "uncompiled") uncompiled.push(r.report);
      else if (r.kind === "engine") engineRefs.push(r.report);
      else broken.push(r.report);
      if (r.nextSource && depth + 1 <= maxDepth && !visited.has(r.nextSource)) {
        queue.push({ src: r.nextSource, depth: depth + 1 });
      }
    }
  }

  const out = {
    asset: resolvedPath,
    checked: ok.length + uncompiled.length + engineRefs.length + broken.length,
    broken: broken.map((r) => ({ ref: r.ref, from: r.from, issue: r.issue })),
    uncompiled: uncompiled.map((r) => ({ ref: r.ref, from: r.from, resolved: r.resolved })),
    engine_refs: engineRefs.map((r) => r.ref),
    ok: ok.map((r) => ({ ref: r.ref, from: r.from, resolved: r.resolved })),
  };
  return { ok: true, text: JSON.stringify(sortKeys(out), null, 2) };
}

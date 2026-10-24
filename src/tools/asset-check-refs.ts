// asset_check_refs：单资产递归引用完整性检查（wayfinder #10 契约）
// 引用解析：addon（content 源 + game 产物）→ game/dota → 共享 addon 产物 → 核心 VPK；编译状态单列 uncompiled。
import { existsSync, rmSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureVrf } from "./vrf-ensure.js";
import { extractRefs, sortKeys, decompileToText } from "./asset-inspect.js";
import { scrubbedEnv } from "./process-env.js";

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

const packedRefCache = new Map<string, boolean>();
/** 核心 VPK 里的资源在磁盘上没有独立文件；用 VRF 精确查询，避免把官方引用误报为 broken。 */
function packedEngineRef(dotaPath: string, clean: string, exe: string): { found: boolean; error: string | null } {
  const vpk = path.join(dotaPath, "game", "dota", "pak01_dir.vpk");
  if (!existsSync(vpk)) return { found: false, error: null };
  const compiled = compiledOf(clean).replace(/\\/g, "/");
  let key: string;
  try { key = `${vpk}|${statSync(vpk).mtimeMs}|${compiled}`; }
  catch (e) { return { found: false, error: (e as Error).message }; }
  const cached = packedRefCache.get(key);
  if (cached !== undefined) return { found: cached, error: null };
  try {
    const workDir = path.join(tmpdir(), "dota2-mcp", "checkrefs");
    mkdirSync(workDir, { recursive: true });
    const stdout = execFileSync(exe, ["-i", vpk, "--vpk_list", "-f", compiled], {
      encoding: "utf-8", windowsHide: true, cwd: workDir, timeout: 15000, maxBuffer: 1024 * 1024,
      env: scrubbedEnv({ DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1" }),
    });
    const found = stdout.split(/\r?\n/).some(line => line.startsWith(compiled + " "));
    if (packedRefCache.size >= 1000) packedRefCache.delete(packedRefCache.keys().next().value!); // 有界 FIFO，避免长期驻留无限增长
    packedRefCache.set(key, found);
    return { found, error: null };
  } catch (e) {
    return { found: false, error: `engine VPK lookup failed: ${(e as Error).message.split("\n")[0]}` };
  }
}

/** 引用解析：
 *  1. addon 源存在 + 产物存在 → ok
 *  2. addon 源存在 + 产物缺失 → uncompiled
 *  3. addon 不存在 → game/dota 存在（源或产物）→ engine_ref
 *  4. 上述都缺失 → 其他 addon 的编译产物存在 → engine_ref
 *  5. 再查核心 pak01_dir.vpk → engine_ref
 *  6. 都不存在 → broken
 */
function resolveOneRef(dotaPath: string, addon: string, ref: string, from: string, sharedRoots: string[], vrfExe: string): { report: RefReport; kind: "ok" | "uncompiled" | "engine" | "broken"; nextSource: string | null } {
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
  // 引擎也能加载其他 addon 已编译的共享资源（实见于官方模板的基础材质）。
  for (const root of sharedRoots) {
    const sharedOut = compiledOf(path.join(root, clean));
    if (existsSync(sharedOut)) {
      return { report: { ref: clean, from, resolved: sharedOut, issue: null }, kind: "engine", nextSource: null };
    }
  }
  const packed = packedEngineRef(dotaPath, clean, vrfExe);
  if (packed.found) {
    return { report: { ref: clean, from, resolved: path.join(dotaPath, "game", "dota", "pak01_dir.vpk"), issue: null }, kind: "engine", nextSource: null };
  }
  return { report: { ref: clean, from, resolved: null, issue: packed.error ?? "not_found" }, kind: "broken", nextSource: null };
}

/** 反编译一个资产为文本。失败返回 null（与「成功但无内容」的空串区分开）。 */
function decompileText(exe: string, p: string): string | null {
  try {
    const tmp = path.join(tmpdir(), "dota2-mcp", "checkrefs", path.basename(p) + "." + process.pid + ".txt");
    const text = decompileToText(exe, p, tmp);
    rmSync(tmp, { force: true });
    return text;
  } catch { return null; }
}

/** 单资产递归引用检查。 */
export async function checkRefs(dotaPath: string, addon: string, resolvedPath: string, opts: { maxDepth?: number } = {}): Promise<CheckResult> {
  const vrf = await ensureVrf();
  if (!vrf.ok || !vrf.executable) {
    return { ok: false, text: "asset_check_refs needs the VRF CLI: " + vrf.message };
  }
  const maxDepth = opts.maxDepth ?? 3;
  const addonsRoot = path.join(dotaPath, "game", "dota_addons");
  let sharedRoots: string[] = [];
  try {
    sharedRoots = readdirSync(addonsRoot, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => path.join(addonsRoot, e.name))
      .sort();
  } catch { /* 没有共享 addon 目录时仍可用 game/dota 解析 */ }
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
    // 根资产都打不开（路径错/文件坏）不能报成「0 个问题」；子资产打不开按无引用跳过
    if (text === null && src === resolvedPath) {
      return { ok: false, text: "asset_check_refs: VRF CLI could not decompile " + resolvedPath + " (wrong path or unreadable asset)" };
    }
    if (!text) continue;
    for (const ref of extractRefs(text)) {
      if (!isAssetRef(ref)) continue;
      const r = resolveOneRef(dotaPath, addon, ref, src, sharedRoots, vrf.executable);
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

// asset_inspect：VRF 反编译 + 轻量 KV1/KV3 文本扫描 → 结构化摘要（wayfinder #8 schema）
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureVrf } from "./vrf-ensure.js";

export interface InspectOptions {
  includeRaw?: boolean;
  rawMaxChars?: number;
}

export interface InspectResult {
  ok: boolean;
  text: string;  // 给 MCP 的完整文本输出
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

/** 提取 KV3 resource 引用与裸 materials/ 路径（去重排序）。 */
function extractRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const m of text.matchAll(/resource:"([^"]+)"/g)) refs.add(m[1]);
  for (const m of text.matchAll(/\b(materials\/[A-Za-z0-9_/. -]+)/g)) refs.add(m[1]);
  return [...refs].sort();
}

function count(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

function pick(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1] : null;
}

/** 从 VRF 反编译文本提取各类型的 summary（未知类型返回 null）。 */
function buildSummary(assetType: string, text: string, pngInfo: { width: number; height: number; format: string } | null): Record<string, unknown> | null {
  const refs = extractRefs(text);
  const materialRefs = refs.filter((r) => /^materials\//.test(r) || r.endsWith(".vmat") || r.endsWith(".vtex"));
  switch (assetType) {
    case "vpcf": return {
      particle_system_count: count(text, /_class\s*=\s*"CParticleSystemDefinition"/g),
      emitter_count: count(text, /_class\s*=\s*"C_OP_InstantaneousEmitter"/g),
      operator_count: count(text, /_class\s*=\s*"C_OP_[A-Za-z0-9_]*"/g),
      initializer_count: count(text, /_class\s*=\s*"C_INIT_[A-Za-z0-9_]*"/g),
      child_refs: refs.filter((r) => r.endsWith(".vpcf")),
      material_refs: materialRefs,
      max_particles: pick(text, /m_nMaxParticles\s*=\s*(\d+)/) ? Number(pick(text, /m_nMaxParticles\s*=\s*(\d+)/)) : null,
    };
    case "vmdl": {
      const lod = pick(text, /m_refLODGroup\s*=\s*resource:"([^"]+)"/);
      return {
        mesh_count: count(text, /_class\s*=\s*"CMesh"/g) || count(text, /m_meshList\s*=\s*\[/g),
        material_refs: materialRefs,
        lod_group_ref: lod ?? null,
        skeleton_ref: refs.filter((r) => r.endsWith(".vmdl")).length > 0 ? refs.filter((r) => r.endsWith(".vmdl"))[0] : null,
      };
    }
    case "vmat": {
      const textureRefs: Record<string, string> = {};
      for (const m of text.matchAll(/([A-Za-z0-9_]+)\s*=\s*resource:"([^"]+\.(?:vtex|png|tga))"/g)) {
        textureRefs[m[1]] = m[2];
      }
      return {
        shader: pick(text, /m_shader\s*=\s*"([^"]+)"/) ?? "unknown",
        texture_refs: textureRefs,
        param_count: count(text, /^[\t ]*[A-Za-z][A-Za-z0-9_]*\s*=/gm),
      };
    }
    case "vtex": return pngInfo ? { width: pngInfo.width, height: pngInfo.height, format: pngInfo.format, mip_count: null } : null;
    default: return null;
  }
}

function pngHead(path_: string): { width: number; height: number; format: string } | null {
  try {
    const buf = readFileSync(path_);
    if (buf.length < 26 || buf.toString("latin1", 1, 4) !== "PNG") return null;
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    const bitDepth = buf[24];
    const colorType = buf[25];
    const names: Record<number, string> = { 0: "Grayscale", 2: "RGB", 3: "Palette", 4: "Grayscale+Alpha", 6: "RGBA" };
    return { width, height, format: (names[colorType] ?? "colorType" + colorType) + "-" + bitDepth + "bit" };
  } catch { return null; }
}

/** 反编译并摘要单个资产。 */
export async function inspectAsset(dotaPath: string, resolvedPath: string, opts: InspectOptions = {}): Promise<InspectResult> {
  const vrf = await ensureVrf();
  if (!vrf.ok || !vrf.executable) {
    return { ok: false, text: "asset_inspect needs the VRF CLI: " + vrf.message };
  }
  const ext = path.extname(resolvedPath).toLowerCase();
  const assetType = ext.replace(/^\./, "").replace(/_c$/, "") || "unknown";
  const isVtex = ext === ".vtex_c" || ext === ".vtex";

  let stdout = "";
  let pngPath: string | null = null;
  try {
    if (isVtex) {
      const outDir = path.join(tmpdir(), "dota2-mcp", "inspect");
      mkdirSync(outDir, { recursive: true });
      pngPath = path.join(outDir, path.basename(resolvedPath).replace(/_c$/, "") + ".png");
      execFileSync(vrf.executable, ["-i", resolvedPath, "-o", pngPath, "-d"], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
    } else {
      stdout = execFileSync(vrf.executable, ["-i", resolvedPath, "-d"], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
    }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    stdout = (err.stdout ?? "") + (err.stderr ?? "") + (err.message ?? "");
    if (!stdout.trim()) {
      return { ok: false, text: "asset_inspect failed to run the VRF CLI" };
    }
  }

  const pngInfo = pngPath && existsSync(pngPath) ? pngHead(pngPath) : null;
  const summary = buildSummary(assetType, stdout, pngInfo);
  const notes: string[] = [];
  if (isVtex && pngInfo) notes.push("mip_count 无法从 PNG 输出提取（VRF 纹理解码为单层 PNG）");
  if (isVtex && pngInfo) notes.push("PNG 导出: " + pngPath);
  if (!summary) notes.push("未知资产类型，仅透传反编译文本");

  const out: Record<string, unknown> = {
    asset_type: assetType,
    source: resolvedPath,
    ...(summary ? { summary } : {}),
    notes,
  };
  if (opts.includeRaw) {
    const cap = opts.rawMaxChars ?? 4000;
    out.raw_decompiled = stdout.slice(0, cap);
    if (stdout.length > cap) out.raw_truncated = true;
  }
  return { ok: true, text: JSON.stringify(sortKeys(out), null, 2) };
}

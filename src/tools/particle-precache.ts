// 粒子预缓存判定：客户端只绘制加载期 precache 过的粒子，未声明的资产 CreateParticle 照样返回
// 有效 id 却什么都不画。vfx_preview 用它把"看不见"这个症状直接指到根因。
import * as fs from "fs";
import * as path from "path";

const MAX_FILES = 2000;
const MAX_BYTES = 2 * 1024 * 1024;

/** 递归收集 .lua（编译产物与源码都可能承载 Precache） */
function luaFiles(dir: string, out: string[] = []): string[] {
  if (out.length >= MAX_FILES) return out;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) luaFiles(p, out);
    else if (/\.lua$/i.test(e.name)) out.push(p);
  }
  return out;
}

function declares(file: string, pathLower: string): boolean {
  try {
    if (fs.statSync(file).size > MAX_BYTES) return false;
    const text = fs.readFileSync(file, "utf8").toLowerCase();
    return text.includes("precache") && text.includes(pathLower);
  } catch { return false; }
}

/**
 * 判断 particlePath 能否被客户端绘制，返回一行给人/agent 读的结论。
 * addon 未知（未连接、无法推断）时返回空串：判不了就不猜。
 */
export function particlePrecacheNote(dotaPath: string, addon: string | null, particlePath: string): string {
  if (!addon) return "";
  const rel = particlePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const lower = rel.toLowerCase();
  const roots = ["game", "content"].map((r) => path.join(dotaPath, r, "dota_addons", addon));
  const inAddon = roots.some((base) =>
    [rel, rel + "_c"].some((p) => { try { return fs.statSync(path.join(base, p)).isFile(); } catch { return false; } }));

  if (!inAddon) {
    return `precache: ${rel} is not an addon asset — engine assets load from the game's own packages, `
      + `while a new addon asset reads this way until resourcecompiler has produced ${rel}_c.`;
  }
  for (const base of roots) {
    for (const file of luaFiles(path.join(base, "scripts", "vscripts"))) {
      if (declares(file, lower)) return `precache: declared in ${path.relative(dotaPath, file).replace(/\\/g, "/")}.`;
    }
  }
  return `precache: MISSING — ${rel} lives in the addon but no PrecacheResource in scripts/vscripts names it, `
    + `so the client draws nothing even though CreateParticle returns a valid id. `
    + `Add PrecacheResource("particle", "${rel}", context) to the addon's Precache(context) and reload the map; `
    + `a runtime PrecacheResource call leaves the client without the asset.`;
}

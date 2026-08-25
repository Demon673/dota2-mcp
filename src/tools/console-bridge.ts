/**
 * Dota 2 环境探测与工具执行辅助。
 *
 * - detectDotaPath：Steam appid 570 自动检测（find-steam-app → 注册表 → 库扫描 → 默认位置），
 *   非 win32 平台自动映射到 /mnt/<drive> 挂载（WSL 兼容）。
 * - resolveDotaToolPath / toWindowsPath / isProcessRunning / spawnVconsole：
 *   Dota 2 工具目录按存在性探测，spawn 参数在 WSL 下转换为 Windows 路径。
 * 控制台 I/O 走 VConRelay（29000/29001/29002），本文件不再提供 console.log 回退。
 */

import * as fs from "fs";
import * as path from "path";
import { execSync, spawn } from "child_process";
import { findSteamAppById } from "find-steam-app";

/** 非 win32 平台（WSL 等）把 Windows 盘符路径映射到 /mnt/<drive>/ 挂载，使 fs 可访问；win32 原样返回。 */
function toHostPath(p: string | null): string | null {
  if (!p) return null;
  if (process.platform === "win32") return p;
  const m = p.match(/^([A-Za-z]):[/\\]?(.*)$/);
  if (!m) return p; // 已是 host 路径（如 /mnt/d/...）
  return "/mnt/" + m[1].toLowerCase() + "/" + m[2];
}

/** 尝试自动检测 Dota 2 路径（通过 Steam appid 570） */
export async function detectDotaPath(): Promise<string | null> {
  // 先试 find-steam-app
  try {
    const appPath = await findSteamAppById(570);
    if (appPath && fs.existsSync(path.join(appPath, "game", "dota"))) {
      return toHostPath(appPath);
    }
  } catch {
    // find-steam-app 1.0.2 无法解析新版 libraryfolders.vdf（条目是对象不是字符串），
    // 抛 TypeError。fall through 到手动解析。
  }
  const manual = detectDotaPathManual();
  if (!manual) {
    console.error(
      "[dota2-mcp] Failed to detect Dota 2 path. Tried: find-steam-app, " +
      "HKCU registry SteamPath, STEAM_PATH env, platform default Steam locations. " +
      "Asset compilation and addon map scanning will be unavailable."
    );
  }
  return toHostPath(manual);
}

/** 从 Windows 注册表读 Steam 安装路径（Steam 自己记录的，比猜默认位置可靠）。 */
function steamPathFromRegistry(): string | null {
  // WSL 下 reg.exe 经 interop 可用；纯 Linux 上 execSync 抛错走 catch 返回 null。
  try {
    const out = execSync(
      'reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath',
      { encoding: "utf-8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+?)\s*$/m);
    return m ? m[1].replace(/\\/g, "/") : null;
  } catch { return null; }
}

/** 解析 libraryfolders.vdf 提取所有库路径，兼容新旧两种格式。 */
function parseLibraryFolders(vdfPath: string): string[] {
  try {
    const content = fs.readFileSync(vdfPath, "utf-8");
    const libPaths: string[] = [];
    // 匹配 "path"		"D:\SteamLibrary"（新格式）或 "0"		"D:\SteamLibrary"（旧格式）
    for (const m of content.matchAll(/"(?:path|\d+)"\s+"([^"]+)"/g)) {
      libPaths.push(m[1].replace(/\\\\/g, "/"));
    }
    return libPaths;
  } catch { return []; }
}

/** 在候选 Steam 根及其 libraryfolders 列出的所有库中查找 Dota 2。 */
function findDotaInLibraries(steamRoot: string): string | null {
  // Steam 根本身也是一个库（Windows 路径在非 win32 下转 /mnt 挂载，fs 才可访问）
  const hostRoot = toHostPath(steamRoot) ?? steamRoot;
  const candidates = [hostRoot];
  const vdfPath = path.join(hostRoot, "steamapps", "libraryfolders.vdf");
  candidates.push(...parseLibraryFolders(vdfPath).map((p) => toHostPath(p) ?? p));

  for (const lib of candidates) {
    const dota = path.join(lib, "steamapps", "common", "dota 2 beta");
    if (fs.existsSync(path.join(dota, "game", "dota"))) {
      return dota;
    }
  }
  return null;
}

/** 手动检测：注册表 → 环境变量 → 默认位置，每个都展开 libraryfolders.vdf。 */
function detectDotaPathManual(): string | null {
  const steamRoots = [
    steamPathFromRegistry(),
    process.env.STEAM_PATH,
    "C:/Program Files (x86)/Steam",
    "C:/Program Files/Steam",
    process.platform === "linux" ? "~/.steam/steam" : null,
    process.platform === "darwin" ? "~/Library/Application Support/Steam" : null,
  ].filter((p): p is string => !!p);

  for (const root of steamRoots) {
    const found = findDotaInLibraries(root);
    if (found) return found;
  }
  return null;
}

/** 指定镜像名的进程是否在跑。
 *  win32 用 tasklist（恒退出码 0，解析输出）；其他平台 pgrep（无匹配时非零退出）。
 *  WSL 下 pgrep 查不到 Windows 进程（如 dota2.exe），再经 tasklist.exe interop 兜底查询。 */
export function isProcessRunning(imageName: string): boolean {
  try {
    if (process.platform === "win32") {
      const out = execSync(`tasklist /FI "IMAGENAME eq ${imageName}" /NH`, { encoding: "utf-8" });
      return out.includes(imageName);
    }
    try {
      execSync(`pgrep -x ${imageName}`, { stdio: ["pipe", "pipe", "pipe"] });
      return true;
    } catch {
      // pgrep 无匹配：WSL 下可能是 Windows 进程（tasklist.exe interop 可见）
      try {
        const out = execSync(`tasklist.exe /FI "IMAGENAME eq ${imageName}" /NH`, {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return out.includes(imageName);
      } catch {
        return false;
      }
    }
  } catch {
    return true; // 检查本身失败：保守视为在跑
  }
}

/** Dota 2 进程是否在跑（守护进程空闲退出守卫：Dota 在跑 = 用户在开发，不退）。 */
export function isDotaProcessRunning(): boolean {
  return isProcessRunning(process.platform === "win32" ? "dota2.exe" : "dota2");
}

/** Dota 2 工具二进制目录（index.ts 与 relay 共用）。
 *  按目录存在性探测而非 platform：WSL 里 process.platform 是 linux，但 Dota 是
 *  Windows 安装（只有 win64）；原生 Linux/Windows 安装各自命中自己的目录。 */
function getDotaBinDir(dotaRoot: string): string {
  const candidates = process.platform === "darwin"
    ? ["osx64", "win64", "linuxsteamrt64"]
    : process.platform === "linux"
      ? ["linuxsteamrt64", "win64", "osx64"]
      : ["win64", "linuxsteamrt64", "osx64"];
  const base = path.join(dotaRoot, "game", "bin");
  for (const d of candidates) {
    if (fs.existsSync(path.join(base, d))) return path.join(base, d);
  }
  return path.join(base, candidates[0]);
}

/** WSL 下 /mnt/<drive>/... → <Drive>:\...（spawn Windows 工具时参数必须是 Windows 路径）。 */
export function toWindowsPath(p: string): string {
  if (process.platform === "win32") return p;
  const m = p.match(/^\/mnt\/([a-z])\/(.*)$/);
  if (!m) return p;
  return m[1].toUpperCase() + ":\\" + m[2].replace(/\//g, "\\");
}

/** 完整工具路径：目录按存在性探测；win64 目录（Windows 安装，WSL 常见）下带 .exe。 */
export function resolveDotaToolPath(dotaRoot: string, baseName: string): string {
  const dir = getDotaBinDir(dotaRoot);
  const isWinDir = path.basename(dir) === "win64";
  const name = process.platform === "win32" || isWinDir ? `${baseName}.exe` : baseName;
  return path.join(dir, name);
}

/** 拉起 vconsole2 GUI（detached，不等待）。exe 不存在或 spawn 失败返回 false。 */
export function spawnVconsole(dotaPath: string): boolean {
  const exe = resolveDotaToolPath(dotaPath, "vconsole2");
  if (!fs.existsSync(exe)) return false;
  try {
    const p = spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: false });
    p.unref();
    return true;
  } catch {
    return false;
  }
}

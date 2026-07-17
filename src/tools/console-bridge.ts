/**
 * ConsoleBridge — Dota 2 Console 双向通信（实用方案）
 *
 * 写命令：生成 .cfg 文件 → Dota 2 exec 执行
 * 读输出：tail console.log（-condebug 模式）
 *
 * ## 已验证
 * - console.log 路径: {dota 2 beta}/game/dota/console.log
 * - 格式: MM/DD HH:MM:SS [Module] Message
 * - 实时写入: ✅ （实测 862 行含 478 条错误）
 * - 内容: ResourceSystem/MaterialSystem/Lua 错误全部捕获
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { findSteamAppById } from "find-steam-app";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsoleBridgeConfig {
  /** Dota 2 beta 根目录，如 "D:/SteamLibrary/steamapps/common/dota 2 beta" */
  dotaPath: string;
  /** addon 名称，如 "tui12" */
  addonName: string;
}

export interface ConsoleLogEntry {
  timestamp: string;   // "MM/DD HH:MM:SS"
  module: string;      // "[ResourceSystem]"
  message: string;     // 实际消息内容
  raw: string;         // 原始行
  isError: boolean;    // 是否为错误
}

// ---------------------------------------------------------------------------
// Log parsing
// ---------------------------------------------------------------------------

const LOG_LINE_RE = /^(\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+(\[[^\]]+\])\s+(.+)$/;
const ERROR_PATTERNS = [
  /Failed loading resource/i,
  /Error creating/i,
  /Parse error/i,
  /ERROR_FILEOPEN/i,
  /Unknown Morph/i,
  /can't solve quadratic/i,
];

function parseLogLine(line: string): ConsoleLogEntry | null {
  const m = line.match(LOG_LINE_RE);
  if (!m) return null;

  const message = m[3];
  const isError = ERROR_PATTERNS.some((re) => re.test(message));

  return {
    timestamp: m[1],
    module: m[2],
    message,
    raw: line,
    isError,
  };
}

// ---------------------------------------------------------------------------
// Console output reading
// ---------------------------------------------------------------------------

export function getConsoleLogPath(config: ConsoleBridgeConfig): string {
  return path.join(config.dotaPath, "game", "dota", "console.log");
}

/** 读取 console.log 尾部 N 行 */
export function tailConsoleLog(
  config: ConsoleBridgeConfig,
  lines: number = 50
): ConsoleLogEntry[] {
  const logPath = getConsoleLogPath(config);
  if (!fs.existsSync(logPath)) return [];

  const content = fs.readFileSync(logPath, "utf-8");
  const allLines = content.split(/\r?\n/).filter(Boolean);
  const tail = allLines.slice(-lines);

  return tail.map(parseLogLine).filter((e): e is ConsoleLogEntry => e !== null);
}

/** 读取 console.log 中匹配模式的行 */
export function grepConsoleLog(
  config: ConsoleBridgeConfig,
  pattern: RegExp,
  maxResults: number = 50
): ConsoleLogEntry[] {
  const logPath = getConsoleLogPath(config);
  if (!fs.existsSync(logPath)) return [];

  const content = fs.readFileSync(logPath, "utf-8");
  const results: ConsoleLogEntry[] = [];

  for (const line of content.split(/\r?\n/)) {
    if (!line) continue;
    if (pattern.test(line)) {
      const entry = parseLogLine(line);
      if (entry) results.push(entry);
      if (results.length >= maxResults) break;
    }
  }

  return results;
}

/** 只读错误行 */
export function readErrors(
  config: ConsoleBridgeConfig,
  maxResults: number = 50
): ConsoleLogEntry[] {
  return grepConsoleLog(
    config,
    /Failed loading|Error creating|Parse error|ERROR_FILEOPEN|Unknown Morph|can't solve quadratic/i,
    maxResults
  );
}

// ---------------------------------------------------------------------------
// Default config (auto-detected)
// ---------------------------------------------------------------------------

/** 尝试自动检测 Dota 2 路径（通过 Steam appid 570） */
export async function detectDotaPath(): Promise<string | null> {
  // 先试 find-steam-app
  try {
    const appPath = await findSteamAppById(570);
    if (appPath && fs.existsSync(path.join(appPath, "game", "dota"))) {
      return appPath;
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
  return manual;
}

/** 从 Windows 注册表读 Steam 安装路径（Steam 自己记录的，比猜默认位置可靠）。 */
function steamPathFromRegistry(): string | null {
  if (process.platform !== "win32") return null;
  try {
    const out = execSync(
      'reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath',
      { encoding: "utf-8", windowsHide: true }
    );
    const m = out.match(/SteamPath\s+REG_SZ\s+(\S+)/);
    return m ? m[1].replace(/\\/g, "/") : null;
  } catch { return null; }
}

/** 解析 libraryfolders.vdf 提取所有库路径，兼容新旧两种格式。 */
function parseLibraryFolders(vdfPath: string): string[] {
  try {
    const content = fs.readFileSync(vdfPath, "utf-8");
    const libPaths: string[] = [];
    // 匹配 "path"		"D:\\SteamLibrary"（新格式）或 "0"		"D:\\SteamLibrary"（旧格式）
    for (const m of content.matchAll(/"(?:path|\d+)"\s+"([^"]+)"/g)) {
      libPaths.push(m[1].replace(/\\\\/g, "/"));
    }
    return libPaths;
  } catch { return []; }
}

/** 在候选 Steam 根及其 libraryfolders 列出的所有库中查找 Dota 2。 */
function findDotaInLibraries(steamRoot: string): string | null {
  // Steam 根本身也是一个库
  const candidates = [steamRoot];
  const vdfPath = path.join(steamRoot, "steamapps", "libraryfolders.vdf");
  candidates.push(...parseLibraryFolders(vdfPath));

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
    process.platform === "win32" ? "C:/Program Files (x86)/Steam" : null,
    process.platform === "win32" ? "C:/Program Files/Steam" : null,
    process.platform === "linux" ? "~/.steam/steam" : null,
    process.platform === "darwin" ? "~/Library/Application Support/Steam" : null,
  ].filter((p): p is string => !!p);

  for (const root of steamRoots) {
    const found = findDotaInLibraries(root);
    if (found) return found;
  }
  return null;
}

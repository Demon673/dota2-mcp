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
import { findSteamAppByName } from "find-steam-app";

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
// Command sending (via cfg file)
// ---------------------------------------------------------------------------

/**
 * 通过 cfg 文件向 Dota 2 发送 console 命令。
 *
 * 将命令写入 addon 目录下的临时 .cfg 文件，
 * 然后 Dota 2 通过 exec 执行。
 *
 * 注意：此方法需要游戏内 Lua 调用 SendToServerConsole("exec <file>")
 * 或用户手动在 console 中输入 exec 命令。
 * 完全自动化需要配合 HTTP bridge（见 http-bridge.ts）。
 */
export function writeCfgCommand(
  config: ConsoleBridgeConfig,
  commands: string[],
  cfgName: string = "mcp_cmd.cfg"
): string {
  const cfgDir = path.join(config.dotaPath, "game", "dota_addons", config.addonName);
  if (!fs.existsSync(cfgDir)) {
    fs.mkdirSync(cfgDir, { recursive: true });
  }

  const cfgPath = path.join(cfgDir, cfgName);
  const content = commands.map((c) => `// MCP command @ ${new Date().toISOString()}\n${c}\n`).join("\n");
  fs.writeFileSync(cfgPath, content, "utf-8");

  return cfgPath;
}

/** 生成 exec 命令字符串，供 Lua SendToServerConsole 或手动输入 */
export function buildExecCommand(cfgName: string = "mcp_cmd.cfg"): string {
  return `exec ${cfgName}`;
}

// ---------------------------------------------------------------------------
// Default config (auto-detected)
// ---------------------------------------------------------------------------

/** 尝试自动检测 Dota 2 路径 */
export async function detectDotaPath(): Promise<string | null> {
  try {
    const appPath = await findSteamAppByName("dota 2 beta");
    if (appPath && fs.existsSync(path.join(appPath, "game", "dota"))) {
      return appPath;
    }
  } catch {
    // ignore and fall through
  }
  return null;
}

// dota_screenshot：游戏截图（game screenshot）——从游戏外部经 Windows.Graphics.Capture 截取 Dota 2 游戏视口窗口，
// 不经控制台、不给游戏发消息。截图辅助程序是下方内嵌的 C# 源码：首次使用时用 Windows 自带的 .NET Framework csc
// 异步编译，按源码哈希缓存在 os.tmpdir()/dota2-mcp/capture/（仓库不附带二进制）。常驻助手以锁文件保证单例，
// 持续缓存最后一帧；卡死时返回带 captured_at/stale 标记的缓存，而不是等待永远不到达的新帧。
// 决策与备选方案见 .agents/notes/implemented/feature/2026-10-18-dota-screenshot.md。
import { randomBytes, createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, renameSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { scrubbedEnv } from "./process-env.js";

export interface ScreenshotOptions {
  maxWidth: number;
  format: "jpeg" | "png";
  restore: boolean;
  dotaPath: string | null;
}

export interface ScreenshotResult {
  ok: boolean;
  text: string;
  image?: { data: string; mimeType: string };
}

const TIMEOUT_MS = 5000;
const KEEP = 20;
/** 本工具生成的文件名；prune 只删匹配它的文件（DOTA2_SCREENSHOT_DIR 可能指向用户自己的目录） */
const SHOT_NAME = /^dota-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{4}\.(jpg|png)$/;

/** 常驻协议：helper --watch <dir> <helperPath>，v2 锁记录 PID+路径；请求为 <id>.request（四行），
 *  回复为 <id>.reply（JSON；可先写 accepted/restoring 进度）。helper --minimize 用于助手丢失后的补最小化。 */
interface HelperReply {
  ok?: boolean;
  width?: number;
  height?: number;
  hung?: boolean;
  restored?: boolean;
  restoring?: boolean;
  accepted?: boolean;
  stale?: boolean;
  captured_at?: string;
  error?: string;
  message?: string;
}

interface RunResult { stdout: string; stderr: string; timedOut: boolean; error: string | null }

function run(cmd: string, args: string[], timeout: number): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, encoding: "utf8", env: scrubbedEnv() }, (err, stdout, stderr) => {
      const e = err as (Error & { killed?: boolean; code?: unknown }) | null;
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "", timedOut: !!e?.killed, error: e ? e.message : null });
    });
  });
}

/** 编译（或复用缓存的）截图辅助程序，返回 exe 路径。异步执行：冷编译不阻塞 MCP 主进程。编译失败抛错（含 csc 输出）。 */
async function ensureHelper(): Promise<string> {
  const hash = createHash("sha256").update(HELPER_SOURCE).digest("hex").slice(0, 12);
  const dir = path.join(tmpdir(), "dota2-mcp", "capture", hash);
  const exe = path.join(dir, "dota-capture.exe");
  if (existsSync(exe)) return exe;
  mkdirSync(dir, { recursive: true });
  // 每个编译者用自己的源文件与产物名：并发会话不会读到别人写了一半的 .cs
  const tag = `${process.pid}.${randomBytes(3).toString("hex")}`;
  const src = path.join(dir, `dota-capture.${tag}.cs`);
  const tmpExe = path.join(dir, `dota-capture.${tag}.exe`);
  writeFileSync(src, HELPER_SOURCE);
  const root = process.env.SystemRoot || "C:\\Windows";
  const gac = (name: string) => path.join(root, "Microsoft.NET", "assembly", "GAC_MSIL", name, "v4.0_4.0.0.0__b03f5f7f11d50a3a", name + ".dll");
  const winmd = (name: string) => path.join(root, "System32", "WinMetadata", name + ".winmd");
  // 只引用每台 Windows 10/11 都有的 GAC facade 与拆分 winmd；SDK 才有的合并版 Windows.winmd 不可用
  const refs = [gac("System.Runtime"), gac("System.Threading.Tasks"), winmd("Windows.Foundation"), winmd("Windows.Graphics"), winmd("Windows.Storage")];
  const r = await run(path.join(root, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    ["-nologo", "-optimize", "-platform:x64", `-out:${tmpExe}`, ...refs.map((x) => `-r:${x}`), src], 60000);
  rmSync(src, { force: true });
  if (existsSync(exe)) { rmSync(tmpExe, { force: true }); return exe; } // 别的会话先编译好了
  if (r.error || !existsSync(tmpExe)) {
    rmSync(tmpExe, { force: true });
    throw new Error((r.stdout || r.error || "csc failed").trim().slice(0, 1500));
  }
  try { renameSync(tmpExe, exe); } catch { rmSync(tmpExe, { force: true }); if (!existsSync(exe)) throw new Error("could not cache the compiled helper"); }
  return exe;
}

/** 独占全屏下恢复最小化窗口会切换显示模式（整屏黑闪），不恢复。
 *  shortcut: 读的是保存的视频设置（setting.fullscreen "1"），游戏内改了未保存时不准；需要时改为查询窗口/显示模式 */
function isExclusiveFullscreen(dotaPath: string): boolean {
  try {
    return /"setting\.fullscreen"\s+"1"/.test(readFileSync(path.join(dotaPath, "game", "dota", "cfg", "video.txt"), "utf8"));
  } catch { return false; }
}

/** 只保留本工具生成的最近 KEEP 张（文件名以 ISO 时间戳开头，按名排序即按时间排序） */
function prune(dir: string): void {
  const files = readdirSync(dir).filter((f) => SHOT_NAME.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) rmSync(path.join(dir, f), { force: true });
}

function errorText(reply: HelperReply, exclusive: boolean, dotaPath: string | null): string {
  switch (reply.error) {
    case "no_window": {
      const exe = dotaPath ? path.join(dotaPath, "game", "bin", "win64", "dota2.exe") : "dota2.exe";
      return `No Dota 2 game window found. Start Dota 2 first (${exe} -addon <addon> -tools). Nothing was captured.`;
    }
    case "minimized":
      return exclusive
        ? "The Dota 2 window is minimized and the game runs in exclusive fullscreen, where restoring it would switch display modes. Switch Dota 2 to windowed or borderless mode, or restore the window yourself."
        : "The Dota 2 window is minimized (restore: false). Call again with restore: true to restore it without focus, capture, and minimize it again.";
    case "no_frame":
      return reply.hung
        ? "The Dota 2 window is not responding, and Windows.Graphics.Capture supplied no frame for this call. Nothing was captured. A sustained hang can stop frame delivery even if an earlier capture succeeded."
        : "The Dota 2 window produced no frame to capture. It may be hidden on another desktop or still starting.";
    default:
      return `Capture failed: ${reply.message ?? reply.error ?? "unknown error"}`;
  }
}

interface WatchOutcome {
  reply: HelperReply | null;
  timedOut: boolean;
  error: string | null;
  note: string;
}

function watchDir(): string {
  const root = process.env.DOTA2_VCON_STATE_DIR
    ? path.resolve(process.env.DOTA2_VCON_STATE_DIR)
    : path.join(tmpdir(), "dota2-mcp");
  return path.join(root, "capture-watcher");
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

interface WatcherInfo { raw: string; pid: number; source: string; version: number }
function readWatcherInfo(dir: string): WatcherInfo | null {
  try {
    const raw = readFileSync(path.join(dir, "watcher.lock"), "utf8");
    const lines = raw.trim().split(/\r?\n/);
    if (lines[0] === "v2") {
      return { raw, pid: Number(lines[1]), source: lines.slice(2).join("\n"), version: 2 };
    }
    // v1 只有 PID，来源在独立文件；读取它只为安全替换旧助手。
    let source = "";
    try { source = readFileSync(path.join(dir, "watcher.source"), "utf8"); } catch { }
    return { raw, pid: Number(raw.trim()), source, version: 1 };
  } catch { return null; }
}

function validPid(pid: number): boolean { return Number.isInteger(pid) && pid > 0; }
function fakeWatcher(source: string): boolean { return /\.m?js$/i.test(source); }
function sameHelper(a: string, b: string): boolean {
  const left = path.resolve(a), right = path.resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

// 正式 C# 助手在整个生命周期内以 FileShare.Read 持有锁；申请写打开成功即说明锁已随进程死亡释放。
// 这样即使 Windows 已复用锁里的 PID，也不会把无关进程当成助手杀掉。假 Node 助手只用于测试，走 PID 检查。
function lockHeld(lock: string): boolean {
  try { const fd = openSync(lock, "r+"); closeSync(fd); return false; }
  catch (e) { return (e as NodeJS.ErrnoException).code !== "ENOENT"; }
}
function ownerAlive(dir: string, info: WatcherInfo): boolean {
  const lock = path.join(dir, "watcher.lock");
  if (process.platform === "win32" && !validPid(info.pid) && lockHeld(lock)) return true;
  if (info.source && fakeWatcher(info.source)) return validPid(info.pid) && processAlive(info.pid);
  if (process.platform === "win32") {
    if (!lockHeld(lock)) return false;
    return validPid(info.pid) ? processAlive(info.pid) : true; // CreateNew 后、PID 写入前也算启动中
  }
  return validPid(info.pid) && processAlive(info.pid);
}
function liveWatcher(dir: string): number | null {
  const info = readWatcherInfo(dir);
  if (!info || !validPid(info.pid) || (info.version === 2 && !info.source)) return null;
  return ownerAlive(dir, info) ? info.pid : null;
}

function removeWatcherLock(dir: string, expectedRaw: string): boolean {
  const current = readWatcherInfo(dir);
  if (!current) return true;
  if (current.raw !== expectedRaw || ownerAlive(dir, current)) return false;
  const lock = path.join(dir, "watcher.lock");
  const stale = `${lock}.stale-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    // 先原子改名再删除：另一个会话即使在清理后立刻创建新锁，也不会被本进程误删。
    renameSync(lock, stale);
    rmSync(stale, { force: true });
    return true;
  } catch { return !existsSync(lock); }
}

async function stopWatcher(dir: string): Promise<boolean> {
  const info = readWatcherInfo(dir);
  if (!info) return true;
  const lock = path.join(dir, "watcher.lock");
  const heldMode = process.platform === "win32" && !(info.source && fakeWatcher(info.source));
  let killed = false;
  if (validPid(info.pid) && ownerAlive(dir, info)) {
    try { process.kill(info.pid); killed = true; } catch { /* 已退出 */ }
  }
  for (let i = 0; killed && i < 80; i++) {
    if (heldMode ? !lockHeld(lock) : !processAlive(info.pid)) break;
    await new Promise(r => setTimeout(r, 25));
  }
  const stopped = heldMode ? !lockHeld(lock) : !validPid(info.pid) || !processAlive(info.pid);
  return stopped && removeWatcherLock(dir, info.raw);
}

function helperInvocation(helper: string, args: string[]): { cmd: string; args: string[] } {
  return fakeWatcher(helper)
    ? { cmd: process.execPath, args: [helper, ...args] }
    : { cmd: helper, args };
}

function watcherLog(dir: string): string {
  try { return readFileSync(path.join(dir, "watcher.log"), "utf8").slice(-1000).trim(); } catch { return ""; }
}

/** 全机共享一个常驻助手。v2 锁把 PID 与助手路径绑定到同一次启动，来源判断不再依赖独立文件的写入时序。 */
async function ensureWatcher(helper: string): Promise<void> {
  const dir = watchDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const desiredSource = path.resolve(helper);
  const invocation = helperInvocation(helper, ["--watch", dir, desiredSource]);
  const state: { error: Error | null; exited: boolean } = { error: null, exited: false };
  let child: import("node:child_process").ChildProcess | null = null;

  for (let i = 0; i < 100; i++) {
    const info = readWatcherInfo(dir);
    if (info && liveWatcher(dir)) {
      if (sameHelper(info.source, desiredSource)) return;
      if (!await stopWatcher(dir)) throw new Error("The previous capture helper could not be stopped.");
      continue;
    }
    if (info && ownerAlive(dir, info)) {
      await new Promise(r => setTimeout(r, 50)); // 另一个会话已创建锁，等它写完并就绪
      continue;
    }
    if (info && !removeWatcherLock(dir, info.raw)) {
      await new Promise(r => setTimeout(r, 50));
      continue;
    }
    if (!child) {
      const logFd = openSync(path.join(dir, "watcher.log"), "a");
      const env = scrubbedEnv();
      try {
        child = spawn(invocation.cmd, invocation.args, { detached: true, stdio: ["ignore", logFd, logFd], windowsHide: true, env });
      } finally { closeSync(logFd); }
      child.once("error", (e) => { state.error = e; });
      child.once("exit", () => { state.exited = true; });
      child.unref();
    }
    if (state.error) throw state.error;
    if (state.exited) {
      const why = watcherLog(dir);
      throw new Error(`Capture helper exited before it was ready.${why ? `\n${why}` : ""}`);
    }
    await new Promise(r => setTimeout(r, 50));
  }
  try { child?.kill(); } catch { /* 已退出 */ }
  const why = watcherLog(dir);
  throw new Error(`Capture helper did not become ready within 5s.${why ? `\n${why}` : ""}`);
}

export async function startScreenshotWatcher(): Promise<void> {
  const override = process.env.DOTA2_CAPTURE_HELPER;
  if (!override && process.platform !== "win32") return;
  const helper = override || await ensureHelper();
  await ensureWatcher(helper);
}

function readReply(file: string): HelperReply | null {
  try {
    const text = readFileSync(file, "utf8");
    return text.trim() ? JSON.parse(text) as HelperReply : null;
  } catch { return null; }
}

async function minimizeAfterRestore(helper: string, restoring: boolean): Promise<string> {
  if (!restoring) return "";
  const invocation = helperInvocation(helper, ["--minimize"]);
  const m = await run(invocation.cmd, invocation.args, TIMEOUT_MS);
  return m.timedOut || m.error
    ? " The window had been restored and could not be minimized again."
    : " The window had been restored; it was minimized again.";
}

async function watchCapture(helper: string, out: string, maxWidth: number, format: string, restore: boolean): Promise<WatchOutcome> {
  await ensureWatcher(helper);
  const dir = watchDir();
  const id = randomBytes(8).toString("hex");
  const request = path.join(dir, `${id}.request`);
  const replyFile = path.join(dir, `${id}.reply`);
  const tmp = path.join(dir, `${id}.${process.pid}.tmp`);
  const cleanup = () => { rmSync(request, { force: true }); rmSync(replyFile, { force: true }); rmSync(tmp, { force: true }); };
  writeFileSync(tmp, [out, String(maxWidth), format, restore ? "1" : "0"].join("\n"), { mode: 0o600 });
  renameSync(tmp, request);

  let restoring = false;
  let accepted = false;
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    const reply = readReply(replyFile);
    if (reply?.accepted) accepted = true;
    if (reply?.restoring) { restoring = true; accepted = true; }
    if (reply && (reply.ok !== undefined || reply.error)) {
      cleanup();
      return { reply, timedOut: false, error: null, note: "" };
    }
    if (!liveWatcher(dir)) {
      cleanup();
      const why = watcherLog(dir);
      const note = await minimizeAfterRestore(helper, restoring);
      return { reply: null, timedOut: false, error: `Capture helper exited while capturing.${why ? `\n${why}` : ""}`, note };
    }
    await new Promise(r => setTimeout(r, 25));
  }

  // 只有已开始处理的请求才可能卡死助手；仍在串行队列中的请求超时不能杀掉别人的共享助手。
  let note = "";
  if (accepted) {
    const stopped = await stopWatcher(dir);
    note = stopped ? " The capture helper was stopped." : " The capture helper could not be stopped cleanly.";
  } else {
    note = " The request was still queued; the shared capture helper was left running.";
  }
  cleanup();
  note += await minimizeAfterRestore(helper, restoring);
  return { reply: null, timedOut: true, error: null, note };
}

export async function captureScreenshot(opts: ScreenshotOptions): Promise<ScreenshotResult> {
  // DOTA2_CAPTURE_HELPER：替换截图辅助程序（离线测试用；.js/.mjs 用当前 node 运行）
  const override = process.env.DOTA2_CAPTURE_HELPER;
  if (!override && process.platform !== "win32") {
    return { ok: false, text: "dota_screenshot supports Windows only (it captures the Dota 2 window through Windows.Graphics.Capture)." };
  }
  let helper: string;
  try {
    helper = override || await ensureHelper();
  } catch (e) {
    return { ok: false, text: `Could not build the capture helper with the system C# compiler, so no screenshot is available:\n${(e as Error).message}` };
  }

  const dir = process.env.DOTA2_SCREENSHOT_DIR || path.join(tmpdir(), "dota2-mcp", "screenshots");
  mkdirSync(dir, { recursive: true });
  const ext = opts.format === "png" ? "png" : "jpg";
  const out = path.join(dir, `dota-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(2).toString("hex")}.${ext}`);
  const exclusive = opts.restore && !!opts.dotaPath && isExclusiveFullscreen(opts.dotaPath);
  const fail = (text: string): ScreenshotResult => { rmSync(out, { force: true }); return { ok: false, text }; };

  let r: WatchOutcome;
  try {
    r = await watchCapture(helper, out, opts.maxWidth, opts.format, opts.restore && !exclusive);
  } catch (e) {
    return fail(`Capture helper gave no result.\n${(e as Error).message}`);
  }
  if (r.timedOut) {
    return fail(`Screenshot timed out after ${TIMEOUT_MS / 1000}s; the capture helper did not respond. Nothing was captured.${r.note}`);
  }
  if (r.error) return fail(`Capture helper gave no result.\n${r.error}${r.note}`);
  const reply = r.reply;
  if (!reply) return fail("Capture helper gave no result.");
  if (!reply.ok) return fail(errorText(reply, exclusive, opts.dotaPath));

  let data: string;
  try { data = readFileSync(out).toString("base64"); } catch (e) {
    return fail(`Capture helper reported success but the image could not be read: ${(e as Error).message}`);
  }
  prune(dir);
  const lines = [`Saved: ${out}`, `Size: ${reply.width}x${reply.height}`];
  if (reply.stale) {
    const when = reply.captured_at || "an earlier time";
    lines.push(`stale: true — no newer frame was available; this image was captured at ${when}.`);
  }
  if (reply.hung) lines.push("hung: true — Windows reports the Dota 2 window as not responding.");
  if (reply.restored) lines.push("The window was minimized: restored without focus, captured, and minimized again.");
  return { ok: true, text: lines.join("\n"), image: { data, mimeType: opts.format === "png" ? "image/png" : "image/jpeg" } };
}

const HELPER_SOURCE = String.raw`// dota2-mcp game screenshot helper: Windows.Graphics.Capture on the Dota 2 game window.
// Usage: dota-capture <outPath> <maxWidth> <jpeg|png> <restore 0|1>   |   dota-capture --minimize
//        dota-capture --watch <requestDir> <helperPath>  (persistent frame cache; *.request / *.reply files)
// Prints JSON lines; the last is the result: {"ok":true,...} or {"ok":false,"error":"<code>","message":"..."}.
// Before restoring a minimized window it prints {"restoring":true}.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text;
using System.Threading.Tasks;
using Windows.Foundation;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

static class DotaCapture {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsHungAppWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("d3d11.dll")] static extern int D3D11CreateDevice(IntPtr adapter, int driverType, IntPtr software, uint flags,
    IntPtr levels, uint numLevels, uint sdk, out IntPtr device, out int level, out IntPtr context);
  [DllImport("d3d11.dll")] static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr inspectable);

  [ComImport, Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IGraphicsCaptureItemInterop {
    IntPtr CreateForWindow([In] IntPtr window, [In] ref Guid iid);
  }

  const int SW_SHOWNOACTIVATE = 4, SW_SHOWMINNOACTIVE = 7;

  static int Main(string[] args) {
    try { Console.OutputEncoding = new UTF8Encoding(false); } catch { } // detached watch 模式没有控制台 stdout
    try {
      if (args.Length == 3 && args[0] == "--watch") return Watch(args[1], args[2]).GetAwaiter().GetResult();
      // --minimize: the caller killed a capture that had restored the window; put it back.
      if (args.Length == 1 && args[0] == "--minimize") {
        IntPtr w = FindGameWindow();
        if (w == IntPtr.Zero) { Fail("no_window", "No Dota 2 game window found."); return 2; }
        if (!IsIconic(w)) ShowWindow(w, SW_SHOWMINNOACTIVE);
        Console.WriteLine("{\"ok\":true}");
        return 0;
      }
      return Run(args).GetAwaiter().GetResult();
    }
    catch (Exception e) { Fail("internal", e.GetType().Name + ": " + e.Message); return 1; }
  }

  static void Fail(string code, string message, bool hung = false) {
    Console.WriteLine("{\"ok\":false,\"error\":\"" + code + "\",\"message\":\"" + Esc(message) + "\"" + (hung ? ",\"hung\":true" : "") + "}");
  }

  static string Esc(string s) {
    var sb = new StringBuilder();
    foreach (char c in s) {
      if (c == '\\' || c == '"') sb.Append('\\').Append(c);
      else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
      else sb.Append(c);
    }
    return sb.ToString();
  }

  static IntPtr FindGameWindow() {
    uint ignored;
    return FindGameWindow(out ignored);
  }

  static IntPtr FindGameWindow(out uint windowPid) {
    windowPid = 0;
    var pids = new System.Collections.Generic.HashSet<uint>();
    foreach (var p in Process.GetProcessesByName("dota2")) { pids.Add((uint)p.Id); p.Dispose(); }
    IntPtr found = IntPtr.Zero;
    uint foundPid = 0;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid) || !IsWindowVisible(h)) return true;
      var sb = new StringBuilder(64); GetWindowText(h, sb, 64);
      if (sb.ToString() == "Dota 2") { found = h; foundPid = pid; return false; }
      return true;
    }, IntPtr.Zero);
    windowPid = foundPid;
    return found;
  }

  static async Task<int> Run(string[] args) {
    string outPath = args[0];
    int maxWidth = int.Parse(args[1]);
    bool png = args[2] == "png";
    bool allowRestore = args[3] == "1";

    IntPtr hwnd = FindGameWindow();
    if (hwnd == IntPtr.Zero) { Fail("no_window", "No Dota 2 game window found."); return 2; }
    bool hung = IsHungAppWindow(hwnd);
    bool restored = false;
    if (IsIconic(hwnd)) {
      if (!allowRestore) { Fail("minimized", "The Dota 2 window is minimized."); return 2; }
      // Announce before restoring: if the caller kills us on timeout, finally never runs and it must re-minimize.
      Console.WriteLine("{\"restoring\":true}");
      ShowWindow(hwnd, SW_SHOWNOACTIVATE);
      restored = true;
    }
    try {
      var item = CreateItem(hwnd);
      var device = CreateDevice();
      using (var pool = Direct3D11CaptureFramePool.CreateFreeThreaded(device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, item.Size))
      using (var session = pool.CreateCaptureSession(item)) {
        // Set by reflection: older Windows 10 metadata lacks these properties, and naming them would fail compilation there.
        TrySet(session, "IsCursorCaptureEnabled", false);
        TrySet(session, "IsBorderRequired", false);
        session.StartCapture();
        // Poll the free-threaded pool (WinRT event += needs System.Runtime.WindowsRuntime, unavailable without the SDK).
        var start = DateTime.UtcNow;
        // A restored window gets 300 ms for a newer frame, keeping the latest; Dota restored without focus
        // usually renders none, and the frame DWM hands over at once is the window's content (measured live).
        int settleMs = restored ? 300 : 0;
        Direct3D11CaptureFrame got = null;
        while ((DateTime.UtcNow - start).TotalMilliseconds < 2000) {
          var f = pool.TryGetNextFrame();
          if (f != null) { if (got != null) got.Dispose(); got = f; }
          if (got != null && (DateTime.UtcNow - start).TotalMilliseconds >= settleMs) break;
          if (f == null) await Task.Delay(5);
        }
        if (got == null) { Fail("no_frame", "No frame arrived from the Dota 2 window.", hung); return 3; }
        using (var frame = got) {
          var size = await EncodeFrame(frame, outPath, maxWidth, png);
          Console.WriteLine("{\"ok\":true,\"width\":" + size[0] + ",\"height\":" + size[1] +
            ",\"hung\":" + (hung ? "true" : "false") + ",\"restored\":" + (restored ? "true" : "false") + "}");
          return 0;
        }
      }
    } finally {
      if (restored) ShowWindow(hwnd, SW_SHOWMINNOACTIVE);
    }
  }

  static async Task<int[]> EncodeFrame(Direct3D11CaptureFrame frame, string outPath, int maxWidth, bool png) {
    using (var bmp = await AsTask(SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface, BitmapAlphaMode.Ignore)))
    using (var stream = new InMemoryRandomAccessStream()) {
      int w = bmp.PixelWidth, h = bmp.PixelHeight;
      int ow = w, oh = h;
      if (maxWidth > 0 && w > maxWidth) { ow = maxWidth; oh = (int)Math.Round((double)h * maxWidth / w); }
      BitmapEncoder enc;
      if (png) enc = await AsTask(BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream));
      else {
        var props = new BitmapPropertySet();
        props.Add("ImageQuality", new BitmapTypedValue(0.8f, PropertyType.Single));
        enc = await AsTask(BitmapEncoder.CreateAsync(BitmapEncoder.JpegEncoderId, stream, props));
      }
      enc.SetSoftwareBitmap(bmp);
      enc.BitmapTransform.ScaledWidth = (uint)ow;
      enc.BitmapTransform.ScaledHeight = (uint)oh;
      enc.BitmapTransform.InterpolationMode = BitmapInterpolationMode.Fant;
      await AsTask(enc.FlushAsync());
      stream.Seek(0);
      using (var reader = new DataReader(stream.GetInputStreamAt(0))) {
        uint size = (uint)stream.Size;
        await AsTask(reader.LoadAsync(size));
        var bytes = new byte[size];
        reader.ReadBytes(bytes);
        File.WriteAllBytes(outPath, bytes);
      }
      return new[] { ow, oh };
    }
  }

  sealed class CaptureReply {
    public bool Ok, Hung, Restored, Stale;
    public int Width, Height;
    public string Error, Message, CapturedAt;
    public string Json() {
      if (!Ok) return "{\"ok\":false,\"error\":\"" + Error + "\",\"message\":\"" + Esc(Message) + "\"" + (Hung ? ",\"hung\":true" : "") + "}";
      return "{\"ok\":true,\"width\":" + Width + ",\"height\":" + Height +
        ",\"hung\":" + (Hung ? "true" : "false") + ",\"restored\":" + (Restored ? "true" : "false") +
        ",\"stale\":" + (Stale ? "true" : "false") + ",\"captured_at\":\"" + Esc(CapturedAt) + "\"}";
    }
  }

  sealed class CaptureRequest {
    public string Id, OutPath;
    public int MaxWidth;
    public bool Png, AllowRestore;
  }

  sealed class CaptureState : IDisposable {
    IntPtr hwnd;
    uint pid;
    GraphicsCaptureItem item;
    IDirect3DDevice device;
    Direct3D11CaptureFramePool pool;
    GraphicsCaptureSession session;
    Direct3D11CaptureFrame last;
    DateTime capturedAt;
    int version, sizeW, sizeH, lastW, lastH;

    public bool HasPool { get { return pool != null; } }

    void Open() {
      // 窗口和 D3D 设备不变时复用，避免会话重建分配本机资源。
      if (item == null) item = CreateItem(hwnd);
      if (device == null) device = CreateDevice();
      var initial = item.Size;
      sizeW = initial.Width; sizeH = initial.Height;
      pool = Direct3D11CaptureFramePool.CreateFreeThreaded(device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 3, initial);
      session = pool.CreateCaptureSession(item);
      TrySet(session, "IsCursorCaptureEnabled", false);
      TrySet(session, "IsBorderRequired", false);
      session.StartCapture();
    }

    public void Ensure(IntPtr h, uint p) {
      if (hwnd != h || pid != p) { Dispose(); hwnd = h; pid = p; }
      if (pool != null) {
        var size = item.Size;
        if (size.Width != sizeW || size.Height != sizeH) {
          pool.Recreate(device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 3, size);
          sizeW = size.Width; sizeH = size.Height;
        }
        return;
      }
      Open();
    }

    public void CloseSession() {
      if (session != null) session.Dispose();
      if (pool != null) pool.Dispose();
      session = null; pool = null;
    }

    public void Pump() {
      if (pool == null) return;
      for (int i = 0; i < 16; i++) {
        var frame = pool.TryGetNextFrame();
        if (frame == null) break;
        if (last != null) last.Dispose();
        last = frame;
        lastW = frame.ContentSize.Width; lastH = frame.ContentSize.Height;
        capturedAt = DateTime.UtcNow;
        version++;
      }
    }

    async Task<bool> WaitForNew(int baseline, int settleMs) {
      var start = DateTime.UtcNow;
      while ((DateTime.UtcNow - start).TotalMilliseconds < 2000) {
        Pump();
        if (last != null && version > baseline && (DateTime.UtcNow - start).TotalMilliseconds >= settleMs) return true;
        await Task.Delay(5);
      }
      Pump();
      return last != null && version > baseline;
    }

    static CaptureReply Error(string code, string message, bool hung) {
      return new CaptureReply { Ok = false, Error = code, Message = message, Hung = hung };
    }

    public async Task<CaptureReply> Capture(CaptureRequest req, string progressDir) {
      uint p;
      IntPtr h = FindGameWindow(out p);
      if (h == IntPtr.Zero) return Error("no_window", "No Dota 2 game window found.", false);
      bool hung = IsHungAppWindow(h);
      bool restored = false;
      if (IsIconic(h)) {
        if (!req.AllowRestore) return Error("minimized", "The Dota 2 window is minimized.", hung);
        if (progressDir != null) WriteWatchReply(progressDir, req.Id, "{\"restoring\":true}");
        ShowWindow(h, SW_SHOWNOACTIVATE);
        restored = true;
      }
      try {
        Ensure(h, p);
        int baseline = version;
        Pump();
        bool fresh = last != null;
        if (restored) fresh = await WaitForNew(baseline, 300);
        else if (last == null) fresh = await WaitForNew(baseline, 0);
        hung = IsHungAppWindow(h);
        if (last == null) return Error("no_frame", "No frame arrived from the Dota 2 window.", hung);
        var size = await EncodeFrame(last, req.OutPath, req.MaxWidth, req.Png);
        return new CaptureReply {
          Ok = true, Width = size[0], Height = size[1], Hung = hung, Restored = restored,
          Stale = (restored && !fresh) || lastW != sizeW || lastH != sizeH ||
            (DateTime.UtcNow - capturedAt).TotalMilliseconds > 1000, CapturedAt = capturedAt.ToString("o")
        };
      } finally {
        if (restored) ShowWindow(h, SW_SHOWMINNOACTIVE);
      }
    }

    public void Dispose() {
      CloseSession();
      if (last != null) last.Dispose();
      last = null; item = null; device = null;
      hwnd = IntPtr.Zero; pid = 0; capturedAt = DateTime.MinValue; version = 0;
      sizeW = 0; sizeH = 0; lastW = 0; lastH = 0;
    }
  }

  static void WriteWatchReply(string dir, string id, string json) {
    string tmp = Path.Combine(dir, id + ".reply.tmp");
    string reply = Path.Combine(dir, id + ".reply");
    File.WriteAllText(tmp, json, new UTF8Encoding(false));
    if (File.Exists(reply)) File.Replace(tmp, reply, null);
    else File.Move(tmp, reply);
  }

  static void CleanupWatchFiles(string dir) {
    var cutoff = DateTime.UtcNow.AddMinutes(-1);
    foreach (string pattern in new[] { "*.request", "*.reply", "*.tmp" }) {
      foreach (string file in Directory.GetFiles(dir, pattern)) {
        try { if (File.GetLastWriteTimeUtc(file) < cutoff) File.Delete(file); } catch { }
      }
    }
  }

  static async Task<int> Watch(string dir, string source) {
    string lockPath = Path.Combine(dir, "watcher.lock");
    FileStream lockStream;
    try {
      lockStream = new FileStream(lockPath, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read);
    } catch (IOException) { return 0; } // 另一个会话已经持有常驻助手
    int ownPid = Process.GetCurrentProcess().Id;
    string lockText = "v2\n" + ownPid + "\n" + source;
    var lockBytes = Encoding.UTF8.GetBytes(lockText);
    lockStream.Write(lockBytes, 0, lockBytes.Length);
    lockStream.Flush(true);
    var state = new CaptureState();
    DateTime lastRequest = DateTime.UtcNow;
    DateTime nextWindowCheck = DateTime.MinValue;
    DateTime nextCleanup = DateTime.MinValue;
    try {
      while (true) {
        foreach (string file in Directory.GetFiles(dir, "*.request")) {
          if (File.GetLastWriteTimeUtc(file) < DateTime.UtcNow.AddSeconds(-10)) {
            try { File.Delete(file); } catch { }
            continue; // 请求方已超时，不能在之后突然恢复窗口或写图
          }
          lastRequest = DateTime.UtcNow;
          CaptureRequest req;
          try {
            var lines = File.ReadAllLines(file);
            if (lines.Length < 4) { File.Delete(file); continue; }
            req = new CaptureRequest {
              Id = Path.GetFileNameWithoutExtension(file), OutPath = lines[0], MaxWidth = int.Parse(lines[1]),
              Png = lines[2] == "png", AllowRestore = lines[3] == "1"
            };
          } catch { try { File.Delete(file); } catch { } continue; }
          try { File.Delete(file); } catch { }
          try { WriteWatchReply(dir, req.Id, "{\"accepted\":true}"); }
          catch (Exception e) { Console.Error.WriteLine(e.Message); continue; }
          CaptureReply reply;
          try { reply = await state.Capture(req, dir); }
          catch (Exception e) {
            state.Dispose();
            reply = new CaptureReply { Ok = false, Error = "internal", Message = e.GetType().Name + ": " + e.Message };
          }
          try { WriteWatchReply(dir, req.Id, reply.Json()); }
          catch (Exception e) { Console.Error.WriteLine(e.Message); } // 单次回复写失败不能拖死共享 watcher
        }
        try { if (state.HasPool) state.Pump(); } catch { state.CloseSession(); }
        if (DateTime.UtcNow >= nextWindowCheck) {
          nextWindowCheck = DateTime.UtcNow.AddSeconds(1);
          uint p;
          IntPtr h = FindGameWindow(out p);
          if (h == IntPtr.Zero) state.Dispose();
          else if (!IsIconic(h)) {
            try { state.Ensure(h, p); }
            catch (Exception e) { state.CloseSession(); Console.Error.WriteLine(e.Message); }
          }
          var dotaProcesses = Process.GetProcessesByName("dota2");
          bool dotaRunning = dotaProcesses.Length > 0;
          foreach (var proc in dotaProcesses) proc.Dispose();
          if (!dotaRunning && DateTime.UtcNow - lastRequest > TimeSpan.FromMinutes(5)) break;
          if (DateTime.UtcNow >= nextCleanup) {
            nextCleanup = DateTime.UtcNow.AddMinutes(1);
            try { CleanupWatchFiles(dir); } catch { }
          }
        }
        await Task.Delay(25);
      }
    } finally {
      state.Dispose();
      lockStream.Dispose();
      try { if (File.ReadAllText(lockPath) == lockText) File.Delete(lockPath); } catch { }
    }
    return 0;
  }

  // WinRT async → Task without System.Runtime.WindowsRuntime (its extensions need the SDK-only unified Windows.winmd).
  static Task<T> AsTask<T>(IAsyncOperation<T> op) {
    var tcs = new TaskCompletionSource<T>();
    op.Completed = (o, st) => {
      if (st == AsyncStatus.Completed) tcs.TrySetResult(o.GetResults());
      else tcs.TrySetException(o.ErrorCode ?? new Exception("WinRT operation " + st));
    };
    return tcs.Task;
  }

  static Task AsTask(IAsyncAction op) {
    var tcs = new TaskCompletionSource<bool>();
    op.Completed = (o, st) => {
      if (st == AsyncStatus.Completed) tcs.TrySetResult(true);
      else tcs.TrySetException(o.ErrorCode ?? new Exception("WinRT action " + st));
    };
    return tcs.Task;
  }

  static void TrySet(object target, string name, object value) {
    try {
      var p = typeof(GraphicsCaptureSession).GetProperty(name);
      if (p != null) p.SetValue(target, value);
    } catch { }
  }

  static GraphicsCaptureItem CreateItem(IntPtr hwnd) {
    var factory = (IGraphicsCaptureItemInterop)WindowsRuntimeMarshal.GetActivationFactory(typeof(GraphicsCaptureItem));
    var iid = new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760");
    IntPtr ptr = factory.CreateForWindow(hwnd, ref iid);
    try { return (GraphicsCaptureItem)Marshal.GetObjectForIUnknown(ptr); } finally { Marshal.Release(ptr); }
  }

  static IDirect3DDevice CreateDevice() {
    IntPtr d3d, ctx; int level;
    // D3D_DRIVER_TYPE_HARDWARE = 1, D3D11_CREATE_DEVICE_BGRA_SUPPORT = 0x20, D3D11_SDK_VERSION = 7
    int hr = D3D11CreateDevice(IntPtr.Zero, 1, IntPtr.Zero, 0x20, IntPtr.Zero, 0, 7, out d3d, out level, out ctx);
    if (hr < 0) Marshal.ThrowExceptionForHR(hr);
    try {
      IntPtr dxgi; var iidDxgi = new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
      hr = Marshal.QueryInterface(d3d, ref iidDxgi, out dxgi);
      if (hr < 0) Marshal.ThrowExceptionForHR(hr);
      try {
        IntPtr insp;
        hr = CreateDirect3D11DeviceFromDXGIDevice(dxgi, out insp);
        if (hr < 0) Marshal.ThrowExceptionForHR(hr);
        try { return (IDirect3DDevice)Marshal.GetObjectForIUnknown(insp); } finally { Marshal.Release(insp); }
      } finally { Marshal.Release(dxgi); }
    } finally { Marshal.Release(d3d); Marshal.Release(ctx); }
  }
}
`;

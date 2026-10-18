// dota_screenshot：游戏截图（game screenshot）——从游戏外部经 Windows.Graphics.Capture 截取 Dota 2 游戏视口窗口，
// 不经控制台、不给游戏发消息，所以游戏卡死时也能拿到画面。截图辅助程序是下方内嵌的 C# 源码：首次使用时用 Windows
// 自带的 .NET Framework csc 编译，按源码哈希缓存在 os.tmpdir()/dota2-mcp/capture/（仓库不附带二进制）。
// 决策与备选方案见 .agents/notes/implemented/feature/2026-10-18-dota-screenshot.md。
import { randomBytes, createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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

/** 辅助程序协议：argv = outPath maxWidth jpeg|png restore(0|1)；stdout 一行 JSON。 */
interface HelperReply {
  ok: boolean;
  path?: string;
  width?: number;
  height?: number;
  hung?: boolean;
  restored?: boolean;
  error?: string;
  message?: string;
}

/** 编译（或复用缓存的）截图辅助程序，返回 exe 路径。编译失败抛错（含 csc 输出）。 */
function ensureHelper(): string {
  const hash = createHash("sha256").update(HELPER_SOURCE).digest("hex").slice(0, 12);
  const dir = path.join(tmpdir(), "dota2-mcp", "capture", hash);
  const exe = path.join(dir, "dota-capture.exe");
  if (existsSync(exe)) return exe;
  mkdirSync(dir, { recursive: true });
  const src = path.join(dir, "dota-capture.cs");
  writeFileSync(src, HELPER_SOURCE);
  const root = process.env.SystemRoot || "C:\\Windows";
  const gac = (name: string) => path.join(root, "Microsoft.NET", "assembly", "GAC_MSIL", name, "v4.0_4.0.0.0__b03f5f7f11d50a3a", name + ".dll");
  const winmd = (name: string) => path.join(root, "System32", "WinMetadata", name + ".winmd");
  // 只引用每台 Windows 10/11 都有的 GAC facade 与拆分 winmd；SDK 才有的合并版 Windows.winmd 不可用
  const refs = [gac("System.Runtime"), gac("System.Threading.Tasks"), winmd("Windows.Foundation"), winmd("Windows.Graphics"), winmd("Windows.Storage")];
  const tmpExe = path.join(dir, `dota-capture.${process.pid}.exe`);
  try {
    execFileSync(path.join(root, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
      ["-nologo", "-optimize", "-platform:x64", `-out:${tmpExe}`, ...refs.map((r) => `-r:${r}`), src],
      { encoding: "utf8", windowsHide: true, timeout: 60000 });
  } catch (e) {
    const err = e as { stdout?: string; message?: string };
    throw new Error((err.stdout || err.message || "csc failed").trim().slice(0, 1500));
  }
  // 并发会话可能同时编译：先到者落盘，后到者丢弃自己的产物
  try { renameSync(tmpExe, exe); } catch { if (!existsSync(exe)) throw new Error("could not cache the compiled helper"); rmSync(tmpExe, { force: true }); }
  return exe;
}

/** 独占全屏下恢复最小化窗口会切换显示模式（整屏黑闪），不恢复。
 *  shortcut: 读的是保存的视频设置（setting.fullscreen "1"），游戏内改了未保存时不准；需要时改为查询窗口/显示模式 */
function isExclusiveFullscreen(dotaPath: string): boolean {
  try {
    return /"setting\.fullscreen"\s+"1"/.test(readFileSync(path.join(dotaPath, "game", "dota", "cfg", "video.txt"), "utf8"));
  } catch { return false; }
}

/** 只保留最近 KEEP 张（文件名以 ISO 时间戳开头，按名排序即按时间排序） */
function prune(dir: string): void {
  const files = readdirSync(dir).filter((f) => f.startsWith("dota-")).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) rmSync(path.join(dir, f), { force: true });
}

function errorText(reply: HelperReply, exclusive: boolean): string {
  switch (reply.error) {
    case "no_window":
      return "No Dota 2 game window found. Start Dota 2 first ({dota2Path}/game/bin/win64/dota2.exe -addon <addon> -tools). Nothing was captured.";
    case "minimized":
      return exclusive
        ? "The Dota 2 window is minimized and the game runs in exclusive fullscreen, where restoring it would switch display modes. Switch Dota 2 to windowed or borderless mode, or restore the window yourself."
        : "The Dota 2 window is minimized (restore: false). Call again with restore: true to restore it without focus, capture, and minimize it again.";
    case "no_frame":
      return "The Dota 2 window produced no frame to capture. It may be hidden on another desktop or still starting.";
    default:
      return `Capture failed: ${reply.message ?? reply.error ?? "unknown error"}`;
  }
}

export async function captureScreenshot(opts: ScreenshotOptions): Promise<ScreenshotResult> {
  // DOTA2_CAPTURE_HELPER：替换截图辅助程序（离线测试用；.js/.mjs 用当前 node 运行）
  const override = process.env.DOTA2_CAPTURE_HELPER;
  if (!override && process.platform !== "win32") {
    return { ok: false, text: "dota_screenshot supports Windows only (it captures the Dota 2 window through Windows.Graphics.Capture)." };
  }
  let helper: string;
  try {
    helper = override || ensureHelper();
  } catch (e) {
    return { ok: false, text: `Could not build the capture helper with the system C# compiler:\n${(e as Error).message}` };
  }

  const dir = process.env.DOTA2_SCREENSHOT_DIR || path.join(tmpdir(), "dota2-mcp", "screenshots");
  mkdirSync(dir, { recursive: true });
  const ext = opts.format === "png" ? "png" : "jpg";
  const out = path.join(dir, `dota-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(2).toString("hex")}.${ext}`);
  const exclusive = opts.restore && !!opts.dotaPath && isExclusiveFullscreen(opts.dotaPath);
  const args = [out, String(opts.maxWidth), opts.format, opts.restore && !exclusive ? "1" : "0"];
  const [cmd, cmdArgs] = /\.m?js$/i.test(helper) ? [process.execPath, [helper, ...args]] : [helper, args];

  const run = await new Promise<{ stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    execFile(cmd, cmdArgs, { timeout: TIMEOUT_MS, windowsHide: true, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "", timedOut: !!(err as { killed?: boolean } | null)?.killed });
    });
  });
  if (run.timedOut) {
    return { ok: false, text: `Screenshot timed out after ${TIMEOUT_MS / 1000}s; the capture helper was killed. Nothing was captured.` };
  }
  const last = run.stdout.trim().split(/\r?\n/).pop() ?? "";
  let reply: HelperReply;
  try { reply = JSON.parse(last); } catch {
    return { ok: false, text: `Capture helper gave no result.${run.stderr ? `\n${run.stderr.trim().slice(0, 1000)}` : ""}` };
  }
  if (!reply.ok) return { ok: false, text: errorText(reply, exclusive) };

  const data = readFileSync(out).toString("base64");
  prune(dir);
  const lines = [`Saved: ${out}`, `Size: ${reply.width}x${reply.height}`];
  if (reply.hung) lines.push("hung: true — the Dota 2 window is not responding; this is its last frame.");
  if (reply.restored) lines.push("The window was minimized: restored without focus, captured, and minimized again.");
  return { ok: true, text: lines.join("\n"), image: { data, mimeType: opts.format === "png" ? "image/png" : "image/jpeg" } };
}

const HELPER_SOURCE = String.raw`// dota2-mcp game screenshot helper: Windows.Graphics.Capture on the Dota 2 game window.
// Usage: dota-capture <outPath> <maxWidth> <jpeg|png> <restore 0|1>
// Prints one JSON line: {"ok":true,...} or {"ok":false,"error":"<code>","message":"..."}.
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
    IntPtr CreateForMonitor([In] IntPtr monitor, [In] ref Guid iid);
  }

  const int SW_SHOWNOACTIVATE = 4, SW_SHOWMINNOACTIVE = 7;

  static int Main(string[] args) {
    try { return Run(args).GetAwaiter().GetResult(); }
    catch (Exception e) { Fail("internal", e.GetType().Name + ": " + e.Message); return 1; }
  }

  static void Fail(string code, string message) {
    Console.WriteLine("{\"ok\":false,\"error\":\"" + code + "\",\"message\":\"" + Esc(message) + "\"}");
  }

  static string Esc(string s) { return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " "); }

  static IntPtr FindGameWindow() {
    var pids = new System.Collections.Generic.HashSet<uint>();
    foreach (var p in Process.GetProcessesByName("dota2")) pids.Add((uint)p.Id);
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid) || !IsWindowVisible(h)) return true;
      var sb = new StringBuilder(64); GetWindowText(h, sb, 64);
      if (sb.ToString() == "Dota 2") { found = h; return false; }
      return true;
    }, IntPtr.Zero);
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
        int deadlineMs = restored ? 2000 : 1500;
        Direct3D11CaptureFrame got = null;
        while (got == null && (DateTime.UtcNow - start).TotalMilliseconds < deadlineMs) {
          var f = pool.TryGetNextFrame();
          if (f == null) { await Task.Delay(5); continue; }
          // A just-restored window can still show its pre-minimize frame: drop frames for the first 300 ms.
          if (restored && (DateTime.UtcNow - start).TotalMilliseconds < 300) { f.Dispose(); continue; }
          got = f;
        }
        if (got == null) { Fail("no_frame", "No frame arrived from the Dota 2 window."); return 3; }
        using (var frame = got) {
          var bmp = await AsTask(SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface, BitmapAlphaMode.Ignore));
          int w = bmp.PixelWidth, h = bmp.PixelHeight;
          int ow = w, oh = h;
          if (maxWidth > 0 && w > maxWidth) { ow = maxWidth; oh = (int)Math.Round((double)h * maxWidth / w); }
          var stream = new InMemoryRandomAccessStream();
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
          var reader = new DataReader(stream.GetInputStreamAt(0));
          uint size = (uint)stream.Size;
          await AsTask(reader.LoadAsync(size));
          var bytes = new byte[size];
          reader.ReadBytes(bytes);
          File.WriteAllBytes(outPath, bytes);
          Console.WriteLine("{\"ok\":true,\"path\":\"" + Esc(outPath) + "\",\"width\":" + ow + ",\"height\":" + oh +
            ",\"hung\":" + (hung ? "true" : "false") + ",\"restored\":" + (restored ? "true" : "false") + "}");
          return 0;
        }
      }
    } finally {
      if (restored) ShowWindow(hwnd, SW_SHOWMINNOACTIVE);
    }
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

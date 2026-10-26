// dota_input: OS-level mouse/keyboard input on the Dota 2 game window. Panorama
// cannot produce real activation/hover/typing, so this is the seam for those.
// The helper is an embedded C# source compiled on first use; it brings the game
// window to the foreground, maps client coordinates to the screen, sends input
// through SendInput, then optionally restores the previous foreground window and
// cursor. The helper is deliberately separate from the capture helper: it needs
// no Windows.Graphics.Capture references and compiles in a fraction of the time.
import { existsSync } from "node:fs";
import path from "node:path";
import { ensureCsharpHelper } from "./screenshot.js";
import { runCommand, nodeInvocation } from "./exec.js";

export type InputAction =
  | "window_info"
  | "move"
  | "click"
  | "down"
  | "up"
  | "drag"
  | "wheel"
  | "key_press"
  | "key_down"
  | "key_up"
  | "text";

export interface InputOptions {
  action: InputAction;
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  button?: "left" | "right" | "middle";
  count?: number;
  key?: string;
  text?: string;
  delta?: number;
  steps?: number;
  step_ms?: number;
  hold_ms?: number;
  settle_ms?: number;
  focus?: boolean;
  restore_focus?: boolean;
  restore_cursor?: boolean;
  allow_outside?: boolean;
}

export interface InputOutcome {
  ok: boolean;
  code?: string;
  message?: string;
  data?: Record<string, unknown>;
  text?: string;
}

interface HelperReply {
  ok?: boolean;
  error?: string;
  message?: string;
  action?: string;
  window?: Record<string, unknown>;
  client?: Record<string, unknown>;
  focused?: boolean;
  restored_focus?: boolean;
  restored_cursor?: boolean;
  cursor_before?: { x: number; y: number };
  cursor_after?: { x: number; y: number };
}

const TIMEOUT_MS = 15000;

function intArg(v: number | undefined, name: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${name} is required`);
  const n = Math.round(v);
  if (n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return n;
}

function buttonArg(v: string | undefined): string {
  const b = v ?? "left";
  if (b !== "left" && b !== "right" && b !== "middle") throw new Error("button must be left, right, or middle");
  return b;
}

function buildArgs(o: InputOptions): string[] {
  const args: string[] = [];
  const stateful = o.action === "down" || o.action === "up" || o.action === "key_down" || o.action === "key_up";
  if (o.action !== "window_info") {
    const keepFocus = o.restore_focus !== true;
    const keepCursor = o.restore_cursor === false || (o.restore_cursor === undefined && (stateful || o.action === "move"));
    if (o.focus === false) args.push("--no-focus");
    if (keepFocus) args.push("--keep-focus");
    if (keepCursor) args.push("--keep-cursor");
    if (o.allow_outside === true) args.push("--allow-outside");
    if (typeof o.settle_ms === "number") args.push("--settle", String(intArg(o.settle_ms, "settle_ms", 0, 5000)));
  }

  switch (o.action) {
    case "window_info":
      args.push("--window-info");
      break;
    case "move":
      args.push("--mouse", "move", String(intArg(o.x, "x", 0, 100000)), String(intArg(o.y, "y", 0, 100000)));
      break;
    case "click": {
      const count = typeof o.count === "number" ? intArg(o.count, "count", 1, 3) : 1;
      args.push("--mouse", "click", buttonArg(o.button), String(intArg(o.x, "x", 0, 100000)), String(intArg(o.y, "y", 0, 100000)), String(count));
      break;
    }
    case "down":
      args.push("--mouse", "down", buttonArg(o.button));
      break;
    case "up":
      args.push("--mouse", "up", buttonArg(o.button));
      break;
    case "drag": {
      const steps = typeof o.steps === "number" ? intArg(o.steps, "steps", 1, 100) : 12;
      const stepMs = typeof o.step_ms === "number" ? intArg(o.step_ms, "step_ms", 0, 1000) : 16;
      args.push("--mouse", "drag", buttonArg(o.button),
        String(intArg(o.x, "x", 0, 100000)), String(intArg(o.y, "y", 0, 100000)),
        String(intArg(o.x2, "x2", 0, 100000)), String(intArg(o.y2, "y2", 0, 100000)),
        String(steps), String(stepMs));
      break;
    }
    case "wheel":
      args.push("--mouse", "wheel", String(intArg(o.delta, "delta", -12000, 12000)));
      if (o.x !== undefined || o.y !== undefined) {
        args.push(String(intArg(o.x, "x", 0, 100000)), String(intArg(o.y, "y", 0, 100000)));
      }
      break;
    case "key_press": {
      if (!o.key) throw new Error("key is required");
      args.push("--key", "press", o.key,
        String(intArg(o.hold_ms ?? 30, "hold_ms", 0, 5000)));
      break;
    }
    case "key_down":
      if (!o.key) throw new Error("key is required");
      args.push("--key", "down", o.key);
      break;
    case "key_up":
      if (!o.key) throw new Error("key is required");
      args.push("--key", "up", o.key);
      break;
    case "text":
      if (typeof o.text !== "string") throw new Error("text is required");
      args.push("--text", Buffer.from(o.text, "utf8").toString("base64"));
      break;
    default:
      throw new Error(`unknown action: ${String((o as { action?: unknown }).action)}`);
  }
  return args;
}

function mapCode(error: string | undefined): string {
  switch (error) {
    case "no_window": return "no_window";
    case "minimized": return "window_minimized";
    case "focus_failed": return "focus_failed";
    case "out_of_bounds":
    case "bad_key":
    case "bad_arg": return "invalid_arg";
    default: return "internal";
  }
}

function textFor(o: InputOptions, r: HelperReply): string {
  if (o.action === "window_info") {
    const w = r.window;
    return w ? `Dota 2 window: ${JSON.stringify(w)}` : "Dota 2 window info";
  }
  const c = r.client ? ` client=${r.client.width}x${r.client.height}` : "";
  const focus = r.restored_focus ? " previous focus restored" : "";
  const cursor = r.restored_cursor ? " cursor restored" : "";
  return `${o.action} sent to the Dota 2 window${c}.${focus}${cursor}`.trimEnd();
}

/** Run one OS-input action. Never throws: helper/compile failures map to codes. */
export async function runInput(o: InputOptions): Promise<InputOutcome> {
  const override = process.env.DOTA2_INPUT_HELPER;
  if (!override && process.platform !== "win32") {
    return { ok: false, code: "no_window", message: "dota_input requires Windows (it sends OS input to the Dota 2 window)." };
  }
  let args: string[];
  try {
    args = buildArgs(o);
  } catch (e) {
    return { ok: false, code: "invalid_arg", message: (e as Error).message };
  }

  let helper: string;
  try {
    if (override) {
      helper = override;
    } else {
      const root = process.env.SystemRoot || "C:\\Windows";
      const systemDll = path.join(root, "Microsoft.NET", "Framework64", "v4.0.30319", "System.dll");
      helper = await ensureCsharpHelper(INPUT_HELPER_SOURCE, "dota-input.exe", existsSync(systemDll) ? [systemDll] : []);
    }
  } catch (e) {
    return { ok: false, code: "internal", message: `Could not build the input helper with the system C# compiler:\n${(e as Error).message}` };
  }

  const inv = nodeInvocation(helper, args);
  const r = await runCommand(inv.cmd, inv.args, TIMEOUT_MS);
  if (r.timedOut) return { ok: false, code: "timeout", message: `dota_input timed out after ${TIMEOUT_MS / 1000}s.` };
  const lines = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let reply: HelperReply | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    try { reply = JSON.parse(lines[i]) as HelperReply; break; } catch { /* find the JSON line */ }
  }
  if (!reply) {
    return { ok: false, code: "internal", message: `Input helper gave no result.${r.stderr ? `\n${r.stderr.slice(0, 1200)}` : ""}` };
  }
  if (!reply.ok) {
    return { ok: false, code: mapCode(reply.error), message: reply.message || reply.error || "input failed" };
  }
  return { ok: true, data: reply as Record<string, unknown>, text: textFor(o, reply) };
}

const INPUT_HELPER_SOURCE = String.raw`// dota2-mcp OS input helper: focus the Dota 2 window and inject mouse/keyboard input.
// Prints one JSON line: {"ok":true,...} or {"ok":false,"error":"<code>","message":"..."}.
// Client coordinates are pixels inside the game viewport; they are converted to screen coordinates.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class DotaInput {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT {
    public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Explicit)] struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }

  const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
  const uint MOVE = 0x0001, LEFTDOWN = 0x0002, LEFTUP = 0x0004, RIGHTDOWN = 0x0008,
    RIGHTUP = 0x0010, MIDDLEDOWN = 0x0020, MIDDLEUP = 0x0040, WHEEL = 0x0800,
    ABSOLUTE = 0x8000, VIRTUALDESK = 0x4000, KEYUP = 0x0002, UNICODE = 0x0004;
  const int SW_RESTORE = 9, SW_SHOW = 5, SW_SHOWNOACTIVATE = 4;
  const int SM_XVIRTUALSCREEN = 76, SM_YVIRTUALSCREEN = 77, SM_CXVIRTUALSCREEN = 78, SM_CYVIRTUALSCREEN = 79;

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint attachTo, bool fAttach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int n);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int cb);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, int dx, int dy, uint data, IntPtr extra);

  static int Main(string[] args) {
    try { Console.OutputEncoding = new UTF8Encoding(false); } catch { }
    try {
      try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { try { SetProcessDPIAware(); } catch { } }
      return Run(args);
    } catch (Exception e) {
      return Fail("internal", e.GetType().Name + ": " + e.Message);
    }
  }

  static int Fail(string code, string message) {
    Console.WriteLine("{\"ok\":false,\"error\":\"" + J(code) + "\",\"message\":\"" + J(message) + "\"}");
    return 2;
  }

  static string J(string s) {
    if (s == null) return "";
    var b = new StringBuilder();
    foreach (char c in s) {
      if (c == '\\' || c == '"') { b.Append('\\').Append(c); }
      else if (c == '\n') { b.Append("\\n"); }
      else if (c == '\r') { b.Append("\\r"); }
      else if (c == '\t') { b.Append("\\t"); }
      else if (c < 0x20) { b.Append("\\u").Append(((int)c).ToString("x4")); }
      else { b.Append(c); }
    }
    return b.ToString();
  }

  static string Title(IntPtr h) {
    var sb = new StringBuilder(256);
    GetWindowText(h, sb, sb.Capacity);
    return sb.ToString();
  }

  static IntPtr FindGameWindow(out uint pid) {
    pid = 0;
    var pids = new HashSet<uint>();
    foreach (var p in Process.GetProcessesByName("dota2")) { pids.Add((uint)p.Id); p.Dispose(); }
    IntPtr found = IntPtr.Zero;
    uint foundPid = 0;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (!pids.Contains(p) || !IsWindowVisible(h)) return true;
      if (Title(h) == "Dota 2") { found = h; foundPid = p; return false; }
      return true;
    }, IntPtr.Zero);
    pid = foundPid;
    return found;
  }

  static uint Dpi(IntPtr h) {
    try { return GetDpiForWindow(h); } catch { return 0; }
  }

  static string ClientJson(IntPtr h) {
    RECT cr; GetClientRect(h, out cr);
    POINT tl = new POINT(); ClientToScreen(h, ref tl);
    return "{\"x\":" + tl.X + ",\"y\":" + tl.Y + ",\"width\":" + cr.Right + ",\"height\":" + cr.Bottom + "}";
  }

  static string WindowJson(IntPtr h, uint pid) {
    RECT wr, cr; GetWindowRect(h, out wr); GetClientRect(h, out cr);
    POINT tl = new POINT(); ClientToScreen(h, ref tl);
    POINT cur; GetCursorPos(out cur);
    var b = new StringBuilder();
    b.Append("{\"hwnd\":\"").Append(h.ToString("x")).Append("\"")
      .Append(",\"pid\":").Append(pid)
      .Append(",\"title\":\"").Append(J(Title(h))).Append("\"")
      .Append(",\"minimized\":").Append(IsIconic(h) ? "true" : "false")
      .Append(",\"foreground\":").Append(GetForegroundWindow() == h ? "true" : "false")
      .Append(",\"dpi\":").Append(Dpi(h))
      .Append(",\"window\":{\"left\":").Append(wr.Left).Append(",\"top\":").Append(wr.Top)
      .Append(",\"right\":").Append(wr.Right).Append(",\"bottom\":").Append(wr.Bottom).Append("}")
      .Append(",\"client\":{\"x\":").Append(tl.X).Append(",\"y\":").Append(tl.Y)
      .Append(",\"width\":").Append(cr.Right).Append(",\"height\":").Append(cr.Bottom).Append("}")
      .Append(",\"cursor\":{\"x\":").Append(cur.X).Append(",\"y\":").Append(cur.Y).Append("}}");
    return b.ToString();
  }

  static bool Focus(IntPtr h, out IntPtr previous) {
    previous = GetForegroundWindow();
    if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
    if (previous == h) return true;
    ShowWindow(h, SW_SHOW);
    SetForegroundWindow(h);
    Thread.Sleep(80);
    if (GetForegroundWindow() == h) return true;
    // Foreground lock: an ALT key event unlocks SetForegroundWindow for this process.
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    SetForegroundWindow(h);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    Thread.Sleep(120);
    if (GetForegroundWindow() == h) return true;
    // Last resort: attach to the current foreground thread and retry.
    uint ignored;
    uint fgThread = previous == IntPtr.Zero ? 0 : GetWindowThreadProcessId(previous, out ignored);
    uint me = GetCurrentThreadId();
    bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
    try { SetForegroundWindow(h); } finally { if (attached) AttachThreadInput(me, fgThread, false); }
    Thread.Sleep(120);
    if (!IsWindowVisible(h)) ShowWindow(h, SW_SHOW);
    return GetForegroundWindow() == h;
  }

  static void RestoreFocus(IntPtr previous, IntPtr game) {
    if (previous == IntPtr.Zero || previous == game || !IsWindow(previous)) return;
    SetForegroundWindow(previous);
    Thread.Sleep(40);
    if (!IsWindowVisible(game)) ShowWindow(game, SW_SHOWNOACTIVATE);
  }

  static bool ToScreen(IntPtr h, int x, int y, bool allowOutside, out POINT p) {
    RECT cr; GetClientRect(h, out cr);
    p = new POINT { X = x, Y = y };
    if (!allowOutside && (x < 0 || y < 0 || x >= cr.Right || y >= cr.Bottom)) return false;
    return ClientToScreen(h, ref p);
  }

  static void SendMouse(uint flags, int dx, int dy, uint data) {
    var input = new INPUT { type = INPUT_MOUSE };
    input.u = new INPUTUNION { mi = new MOUSEINPUT { dx = dx, dy = dy, mouseData = data, dwFlags = flags } };
    SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT)));
  }

  static void MoveAbs(int sx, int sy) {
    int vx = GetSystemMetrics(SM_XVIRTUALSCREEN), vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int vw = GetSystemMetrics(SM_CXVIRTUALSCREEN), vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    SetCursorPos(sx, sy);
    if (vw < 2 || vh < 2) return;
    int nx = (int)Math.Round((sx - vx) * 65535.0 / (vw - 1));
    int ny = (int)Math.Round((sy - vy) * 65535.0 / (vh - 1));
    SendMouse(MOVE | ABSOLUTE | VIRTUALDESK, nx, ny, 0);
  }

  static void MouseButton(uint flags) { mouse_event(flags, 0, 0, 0, IntPtr.Zero); }

  static uint Button(string name, bool down) {
    if (name == "right") return down ? RIGHTDOWN : RIGHTUP;
    if (name == "middle") return down ? MIDDLEDOWN : MIDDLEUP;
    return down ? LEFTDOWN : LEFTUP;
  }

  static void SendKey(ushort vk, bool up) {
    var input = new INPUT { type = INPUT_KEYBOARD };
    input.u = new INPUTUNION { ki = new KEYBDINPUT { wVk = vk, wScan = 0, dwFlags = up ? KEYUP : 0 } };
    SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT)));
  }

  static void SendUnicode(char c, bool up) {
    var input = new INPUT { type = INPUT_KEYBOARD };
    input.u = new INPUTUNION { ki = new KEYBDINPUT { wVk = 0, wScan = c, dwFlags = UNICODE | (up ? KEYUP : 0) } };
    SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT)));
  }

  static ushort KeyCode(string raw) {
    string s = raw.ToUpperInvariant();
    if (s.Length == 1) {
      char c = s[0];
      if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return (ushort)c;
    }
    if (s.StartsWith("0X")) {
      ushort hex;
      if (ushort.TryParse(s.Substring(2), System.Globalization.NumberStyles.HexNumber, null, out hex)) return hex;
    }
    ushort num;
    if (ushort.TryParse(s, out num)) return num;
    switch (s) {
      case "SPACE": return 0x20;
      case "ENTER": case "RETURN": return 0x0D;
      case "ESC": case "ESCAPE": return 0x1B;
      case "TAB": return 0x09;
      case "BACKSPACE": return 0x08;
      case "DELETE": case "DEL": return 0x2E;
      case "INSERT": case "INS": return 0x2D;
      case "HOME": return 0x24;
      case "END": return 0x23;
      case "PAGEUP": case "PGUP": return 0x21;
      case "PAGEDOWN": case "PGDN": return 0x22;
      case "LEFT": return 0x25;
      case "UP": return 0x26;
      case "RIGHT": return 0x27;
      case "DOWN": return 0x28;
      case "SHIFT": return 0x10;
      case "CTRL": case "CONTROL": return 0x11;
      case "ALT": return 0x12;
      case "WIN": case "LWIN": return 0x5B;
      case "CAPSLOCK": return 0x14;
      case "NUMLOCK": return 0x90;
      case "SCROLLLOCK": return 0x91;
      case "PLUS": return 0xBB;
      case "MINUS": return 0xBD;
      case "COMMA": return 0xBC;
      case "PERIOD": return 0xBE;
      case "SLASH": return 0xBF;
      case "SEMICOLON": return 0xBA;
      case "QUOTE": return 0xDE;
      case "LBRACKET": return 0xDB;
      case "RBRACKET": return 0xDD;
      case "BACKSLASH": return 0xDC;
      case "TILDE": return 0xC0;
    }
    if (s.Length >= 2 && s[0] == 'F') {
      int n;
      if (int.TryParse(s.Substring(1), out n) && n >= 1 && n <= 24) return (ushort)(0x70 + n - 1);
    }
    throw new ArgumentException("unknown key: " + raw);
  }

  static int Run(string[] args) {
    var rest = new List<string>();
    bool keepFocus = false, keepCursor = false, allowOutside = false, focus = true;
    int settle = 140;
    for (int i = 0; i < args.Length; i++) {
      string a = args[i];
      if (a == "--no-focus") { focus = false; }
      else if (a == "--keep-focus") { keepFocus = true; }
      else if (a == "--keep-cursor") { keepCursor = true; }
      else if (a == "--allow-outside") { allowOutside = true; }
      else if (a == "--settle" && i + 1 < args.Length) { settle = int.Parse(args[++i]); }
      else { rest.Add(a); }
    }
    if (rest.Count == 0) return Fail("bad_arg", "usage: --window-info | --mouse move x y | --mouse click button x y [count] | --mouse down/up button | --mouse drag button x1 y1 x2 y2 [steps] [stepMs] | --mouse wheel delta [x y] | --key press key [holdMs] | --key down/up key | --text base64");

    IntPtr hwnd; uint pid;
    if (rest[0] == "--window-info") {
      hwnd = FindGameWindow(out pid);
      if (hwnd == IntPtr.Zero) return Fail("no_window", "No Dota 2 game window found.");
      Console.WriteLine("{\"ok\":true,\"window\":" + WindowJson(hwnd, pid) + "}");
      return 0;
    }

    hwnd = FindGameWindow(out pid);
    if (hwnd == IntPtr.Zero) return Fail("no_window", "No Dota 2 game window found.");
    if (IsIconic(hwnd)) return Fail("minimized", "The Dota 2 window is minimized. Restore it before sending input.");

    // Reject out-of-bounds mouse targets before taking focus, so an invalid
    // request never changes the user's foreground window.
    if (rest[0] == "--mouse" && rest.Count >= 2 && rest[1] != "down" && rest[1] != "up") {
      int[] xs, ys;
      if (rest[1] == "move" && rest.Count >= 4) { xs = new[] { int.Parse(rest[2]) }; ys = new[] { int.Parse(rest[3]) }; }
      else if (rest[1] == "click" && rest.Count >= 5) { xs = new[] { int.Parse(rest[3]) }; ys = new[] { int.Parse(rest[4]) }; }
      else if (rest[1] == "drag" && rest.Count >= 7) { xs = new[] { int.Parse(rest[3]), int.Parse(rest[5]) }; ys = new[] { int.Parse(rest[4]), int.Parse(rest[6]) }; }
      else if (rest[1] == "wheel" && rest.Count >= 5) { xs = new[] { int.Parse(rest[3]) }; ys = new[] { int.Parse(rest[4]) }; }
      else { xs = new int[0]; ys = new int[0]; }
      for (int i = 0; i < xs.Length; i++) {
        POINT check;
        if (!ToScreen(hwnd, xs[i], ys[i], allowOutside, out check)) return Fail("out_of_bounds", "Coordinates are outside the game client area.");
      }
    }

    IntPtr previous = IntPtr.Zero;
    if (focus) {
      if (!Focus(hwnd, out previous)) return Fail("focus_failed", "Could not bring the Dota 2 window to the foreground.");
    } else {
      previous = GetForegroundWindow();
    }
    POINT before; GetCursorPos(out before);
    bool input = false;
    string action = "";

    try {
    if (rest[0] == "--mouse") {
      if (rest.Count < 2) return Fail("bad_arg", "missing mouse action");
      string sub = rest[1];
      POINT p;
      if (sub == "move") {
        if (!ToScreen(hwnd, int.Parse(rest[2]), int.Parse(rest[3]), allowOutside, out p)) return Fail("out_of_bounds", "Coordinates are outside the game client area.");
        MoveAbs(p.X, p.Y); input = true; action = "move";
      } else if (sub == "click") {
        string button = rest[2];
        int x = int.Parse(rest[3]), y = int.Parse(rest[4]);
        int count = rest.Count > 5 ? int.Parse(rest[5]) : 1;
        if (!ToScreen(hwnd, x, y, allowOutside, out p)) return Fail("out_of_bounds", "Coordinates are outside the game client area.");
        MoveAbs(p.X, p.Y);
        for (int i = 0; i < count; i++) {
          MouseButton(Button(button, true));
          Thread.Sleep(30);
          MouseButton(Button(button, false));
          if (i + 1 < count) Thread.Sleep(90);
        }
        input = true; action = "click";
      } else if (sub == "down" || sub == "up") {
        MouseButton(Button(rest[2], sub == "down"));
        input = true; action = sub;
      } else if (sub == "drag") {
        string button = rest[2];
        POINT a, b;
        if (!ToScreen(hwnd, int.Parse(rest[3]), int.Parse(rest[4]), allowOutside, out a)) return Fail("out_of_bounds", "Drag start is outside the game client area.");
        if (!ToScreen(hwnd, int.Parse(rest[5]), int.Parse(rest[6]), allowOutside, out b)) return Fail("out_of_bounds", "Drag end is outside the game client area.");
        int steps = rest.Count > 7 ? int.Parse(rest[7]) : 12;
        int stepMs = rest.Count > 8 ? int.Parse(rest[8]) : 16;
        MoveAbs(a.X, a.Y);
        MouseButton(Button(button, true));
        for (int i = 1; i <= steps; i++) {
          int sx = a.X + (b.X - a.X) * i / steps;
          int sy = a.Y + (b.Y - a.Y) * i / steps;
          MoveAbs(sx, sy);
          Thread.Sleep(stepMs);
        }
        MouseButton(Button(button, false));
        input = true; action = "drag";
      } else if (sub == "wheel") {
        int delta = int.Parse(rest[2]);
        if (rest.Count >= 5) {
          if (!ToScreen(hwnd, int.Parse(rest[3]), int.Parse(rest[4]), allowOutside, out p)) return Fail("out_of_bounds", "Coordinates are outside the game client area.");
          MoveAbs(p.X, p.Y);
        }
        mouse_event(WHEEL, 0, 0, (uint)delta, IntPtr.Zero);
        input = true; action = "wheel";
      } else {
        return Fail("bad_arg", "unknown mouse action: " + sub);
      }
    } else if (rest[0] == "--key") {
      if (rest.Count < 3) return Fail("bad_arg", "missing key action");
      string sub = rest[1], combo = rest[2];
      string[] parts = combo.Split('+');
      var mods = new List<ushort>();
      for (int i = 0; i < parts.Length - 1; i++) mods.Add(KeyCode(parts[i]));
      ushort key = KeyCode(parts[parts.Length - 1]);
      if (sub == "press") {
        int hold = rest.Count > 3 ? int.Parse(rest[3]) : 30;
        for (int i = 0; i < mods.Count; i++) SendKey(mods[i], false);
        SendKey(key, false);
        Thread.Sleep(hold);
        SendKey(key, true);
        for (int i = mods.Count - 1; i >= 0; i--) SendKey(mods[i], true);
        input = true; action = "key_press";
      } else if (sub == "down" || sub == "up") {
        SendKey(key, sub == "up");
        input = true; action = "key_" + sub;
      } else {
        return Fail("bad_arg", "unknown key action: " + sub);
      }
    } else if (rest[0] == "--text") {
      string text = Encoding.UTF8.GetString(Convert.FromBase64String(rest[1]));
      foreach (char c in text) {
        SendUnicode(c, false);
        SendUnicode(c, true);
        Thread.Sleep(16);
      }
      input = true; action = "text";
    } else {
      return Fail("bad_arg", "unknown command: " + rest[0]);
    }
    } catch (Exception e) {
      if (!keepFocus) {
        RestoreFocus(previous, hwnd);
        Thread.Sleep(30);
        if (!IsWindowVisible(hwnd)) ShowWindow(hwnd, SW_SHOWNOACTIVATE);
      }
      if (!keepCursor) SetCursorPos(before.X, before.Y);
      return Fail("bad_arg", e.GetType().Name + ": " + e.Message);
    }

    if (!input) return Fail("bad_arg", "no input action");
    if (!keepFocus) { Thread.Sleep(settle); RestoreFocus(previous, hwnd); }
    if (!keepCursor) SetCursorPos(before.X, before.Y);
    POINT after; GetCursorPos(out after);
    var bld = new StringBuilder();
    bld.Append("{\"ok\":true,\"action\":\"").Append(J(action)).Append("\"")
      .Append(",\"client\":").Append(ClientJson(hwnd))
      .Append(",\"focused\":").Append(GetForegroundWindow() == hwnd ? "true" : "false")
      .Append(",\"restored_focus\":").Append(!keepFocus && previous != IntPtr.Zero && previous != hwnd ? "true" : "false")
      .Append(",\"restored_cursor\":").Append(!keepCursor ? "true" : "false")
      .Append(",\"cursor_before\":{\"x\":").Append(before.X).Append(",\"y\":").Append(before.Y).Append("}")
      .Append(",\"cursor_after\":{\"x\":").Append(after.X).Append(",\"y\":").Append(after.Y).Append("}}");
    Console.WriteLine(bld.ToString());
    return 0;
  }
}
`;

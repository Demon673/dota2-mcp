// Windows-native offline regression for #26. Uses the real embedded input helper
// against two fixture windows; never discovers or sends input to a running Dota.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { ensureCsharpHelper } from "../dist/tools/screenshot.js";
import { runCommand } from "../dist/tools/exec.js";

if (process.platform !== "win32") {
  console.log("SKIP: native input focus requires Windows");
  process.exit(0);
}

const input = readFileSync(new URL("../src/tools/input.ts", import.meta.url), "utf8");
const marker = "const INPUT_HELPER_SOURCE = String.raw`";
assert.equal(input.split(marker).length, 2, "embedded helper source exists once");
const source = input.slice(input.indexOf(marker) + marker.length, input.lastIndexOf("`;"));
assert.equal(source.split("static int Main(string[] args)").length, 2, "one production entry point");
const testSource = source.replace("static int Main(string[] args)", "static int ProductionMain(string[] args)") + String.raw`

class FocusFixture : System.Windows.Forms.Form {
  public bool HideOnDeactivate;
  public bool ObserveFocus;
  public bool HiddenDuringFocus;
  public bool HiddenOnDeactivate;
  public IntPtr Other;
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(uint pid);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  public FocusFixture() {
    Text = "Input focus fixture";
    Width = 360; Height = 220;
    var timer = new System.Windows.Forms.Timer { Interval = 10 };
    timer.Tick += delegate { if (ObserveFocus && !IsWindowVisible(Handle)) HiddenDuringFocus = true; };
    timer.Start();
    Deactivate += delegate { if (HideOnDeactivate) { HiddenOnDeactivate = true; Hide(); } };
    FormClosed += delegate { timer.Dispose(); };
  }
  protected override void WndProc(ref System.Windows.Forms.Message m) {
    if (m.Msg == 0x8001) { ObserveFocus = false; HideOnDeactivate = true; }
    base.WndProc(ref m);
  }
  public void Prepare(bool foreground) {
    HideOnDeactivate = false; ObserveFocus = false; HiddenDuringFocus = false; HiddenOnDeactivate = false;
    Show();
    SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, 0x53);
    SetForegroundWindow(foreground ? Handle : Other);
    AllowSetForegroundWindow(0xffffffff);
    ObserveFocus = true;
    Console.WriteLine("{\"game\":\"" + Handle.ToInt64() + "\",\"other\":\"" + Other.ToInt64() + "\",\"visible\":" + IsWindowVisible(Handle).ToString().ToLowerInvariant() + ",\"foreground\":" + (GetForegroundWindow() == (foreground ? Handle : Other)).ToString().ToLowerInvariant() + "}");
  }
}

static class InputFocusTest {
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO {
    public uint cb; public IntPtr reserved, desktop, title;
    public uint x, y, cx, cy, cols, rows, fill, flags;
    public ushort show, reservedSize; public IntPtr reservedData, stdin, stdout, stderr;
  }
  [DllImport("kernel32.dll")] static extern void GetStartupInfo(out STARTUPINFO info);
  static System.Reflection.MethodInfo Method(string name) {
    return typeof(DotaInput).GetMethod(name, System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
  }
  [STAThread] static int Main(string[] args) {
    if (args[0] == "fixture") {
      IntPtr original = GetForegroundWindow();
      var game = new FocusFixture();
      var other = new System.Windows.Forms.Form { Text = "Input previous foreground fixture", Width = 360, Height = 220, Left = 400 };
      game.Show(); other.Show(); game.Other = other.Handle;
      Console.WriteLine("ready");
      var reader = new Thread(delegate() {
        string line;
        while ((line = Console.ReadLine()) != null) {
          string command = line;
          game.BeginInvoke(new Action(delegate {
            if (command == "prepare" || command == "prepare_game") game.Prepare(command == "prepare_game");
            else if (command == "state") Console.WriteLine("{\"hidden_during_focus\":" + game.HiddenDuringFocus.ToString().ToLowerInvariant() + ",\"hidden_on_deactivate\":" + game.HiddenOnDeactivate.ToString().ToLowerInvariant() + "}");
            else { game.ObserveFocus = false; game.Close(); other.Close(); System.Windows.Forms.Application.ExitThread(); }
          }));
        }
      });
      reader.IsBackground = true; reader.Start();
      System.Windows.Forms.Application.Run();
      SetForegroundWindow(original);
      return 0;
    }
    STARTUPINFO startup; GetStartupInfo(out startup);
    if ((startup.flags & 1) == 0 || startup.show != 0) throw new Exception("Probe must inherit SW_HIDE");
    IntPtr target = new IntPtr(long.Parse(args[1]));
    IntPtr previous = new IntPtr(long.Parse(args[2]));
    object[] focusArgs = { target, IntPtr.Zero };
    bool focused = (bool)Method("Focus").Invoke(null, focusArgs);
    bool focusVisible = IsWindowVisible(target);
    bool actualFocus = GetForegroundWindow() == target;
    if (args[0] == "restore") {
      SendMessage(target, 0x8001, IntPtr.Zero, IntPtr.Zero);
      Method("RestoreFocus").Invoke(null, new object[] { previous, target });
    }
    Thread.Sleep(100);
    Console.WriteLine("{\"focused\":" + focused.ToString().ToLowerInvariant() + ",\"focus_visible\":" + focusVisible.ToString().ToLowerInvariant() + ",\"actual_focus\":" + actualFocus.ToString().ToLowerInvariant() + ",\"visible\":" + IsWindowVisible(target).ToString().ToLowerInvariant() + ",\"foreground_correct\":" + (GetForegroundWindow() == (args[0] == "restore" ? previous : target)).ToString().ToLowerInvariant() + "}");
    return 0;
  }
}
`;
const exe = await ensureCsharpHelper(testSource, "input-focus-test.exe", ["System.Windows.Forms.dll", "System.Drawing.dll"]);
const fixture = spawn(exe, ["fixture"], { windowsHide: true, stdio: ["pipe", "pipe", "inherit"] });
const exited = once(fixture, "exit");
const lines = createInterface({ input: fixture.stdout });
async function reply() {
  let timer;
  try {
    return await Promise.race([
      once(lines, "line").then(([line]) => line),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("fixture response timed out")), 5000); }),
    ]);
  } finally { clearTimeout(timer); }
}
async function ask(command) {
  const response = reply();
  fixture.stdin.write(command + "\n");
  return JSON.parse(await response);
}
try {
  assert.equal(await reply(), "ready");
  for (const scenario of ["keep", "restore", "foreground"]) {
    const restore = scenario === "restore";
    const before = await ask(scenario === "foreground" ? "prepare_game" : "prepare");
    assert(before.visible && before.foreground, "fixture starts visible with the expected foreground");
    const result = await runCommand(exe, [scenario, before.game, before.other], 5000);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const state = JSON.parse(result.stdout.trim());
    const observed = await ask("state");
    assert(state.focused && state.actual_focus, "real Focus takes the fixture foreground");
    assert(state.focus_visible && !observed.hidden_during_focus, "Focus never hides the visible fixture");
    assert(state.visible && state.foreground_correct, `restore_focus:${restore} preserves visibility and foreground`);
    if (restore) assert(observed.hidden_on_deactivate, "fixture hides on deactivation before RestoreFocus re-shows it");
    console.log(`ok - native ${scenario}, including visibility during focus and after restoration`);
  }
} finally {
  fixture.stdin.end("quit\n");
  const timeout = setTimeout(() => fixture.kill(), 3000);
  await exited;
  clearTimeout(timeout);
  lines.close();
}
console.log("PASS");

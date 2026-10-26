// 离线冒烟：dota_screenshot 工具（MCP 工具层，经 stdio 调真实 server）。
// 只替换截图辅助程序这一个边界：DOTA2_CAPTURE_HELPER 指向下面生成的假辅助程序（node 脚本，Windows/Linux 都能跑），
// 它按 MODE 文件里的指令处理常驻 watcher 的 request/reply 文件协议。不需要 Dota、vconsole 或 relay 连接（同时证明工具不受门控）。
// 独占全屏、辅助程序启动失败、非 Windows 三条路径在进程内直接调 captureScreenshot（要传 dotaPath / 换掉辅助程序）。
// 还覆盖启动+请求的总 5s deadline，以及到期后无法完成补最小化的明确错误；冷编译不在此预算内。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnMcpServer, assert, sleep } from "./lib-mcp.mjs";
import { freePortBlock } from "./lib-test-ports.mjs";

const work = mkdtempSync(path.join(tmpdir(), "screenshot-test-"));
const modeFile = path.join(work, "mode.txt");
const shotDir = path.join(work, "shots");
const helper = path.join(work, "fake-capture.mjs");
const minimizedMarker = path.join(work, "minimized-again.txt");
// 假辅助程序：协议同真实 helper —— argv: outPath maxWidth format restore，或 --watch dir source / --minimize；一次性模式 stdout 每行一个 JSON
writeFileSync(helper, `
import { readFileSync, writeFileSync, readdirSync, rmSync, renameSync } from "node:fs";
import path from "node:path";
const say = (o) => console.log(JSON.stringify(o));
if (process.argv[2] === "--minimize") { writeFileSync(${JSON.stringify(minimizedMarker)}, "1"); say({ ok: true }); process.exit(0); }
let cached = null;
const publicReply = () => { if (!cached) return null; const { data, ...reply } = cached; return reply; };
function respond(outPath, maxWidth, format, restore) {
  const mode = readFileSync(${JSON.stringify(modeFile)}, "utf8").trim();
  if (mode === "hang" || mode === "queue" || mode === "slow_start") return {};
  if (mode === "hang_restoring") return { progress: { restoring: true } };
  if (mode === "stale") {
    if (!cached) return { reply: { ok: false, error: "no_frame", message: "no cache", hung: true } };
    writeFileSync(outPath, cached.data);
    return { reply: { ...publicReply(), stale: true, hung: true } };
  }
  if (mode === "ok_nofile") return { reply: { ok: true, width: 1, height: 1, hung: false, restored: false } };
  if (mode === "partial_no_frame") { writeFileSync(outPath, "PARTIAL"); return { reply: { ok: false, error: "no_frame", message: "x" } }; }
  if (mode === "hung_no_frame") return { reply: { ok: false, error: "no_frame", message: "x", hung: true } };
  if (mode === "ok" || mode === "hung" || (mode === "minimized" && restore === "1")) {
    const data = "FAKEIMG " + [maxWidth, format, restore].join(" ");
    writeFileSync(outPath, data);
    cached = { ok: true, width: Number(maxWidth), height: 100, hung: mode === "hung", restored: mode === "minimized", stale: false, captured_at: new Date().toISOString(), data };
    return { progress: mode === "minimized" ? { restoring: true } : null, reply: publicReply() };
  }
  return { reply: { ok: false, error: mode, message: "fake " + mode } };
}
if (process.argv[2] === "--watch") {
  const dir = process.argv[3];
  if (readFileSync(${JSON.stringify(modeFile)}, "utf8").trim() === "slow_start") await new Promise((r) => setTimeout(r, 4000));
  const lock = path.join(dir, "watcher.lock");
  const lockText = ["v2", String(process.pid), process.argv[4]].join("\\n");
  try { writeFileSync(lock, lockText, { flag: "wx" }); } catch { process.exit(0); }
  const writeReply = (id, value) => {
    const tmp = path.join(dir, id + ".reply.tmp");
    writeFileSync(tmp, JSON.stringify(value));
    rmSync(path.join(dir, id + ".reply"), { force: true });
    renameSync(tmp, path.join(dir, id + ".reply"));
  };
  const loop = async () => {
    while (true) {
      for (const name of readdirSync(dir).filter((f) => f.endsWith(".request"))) {
        const file = path.join(dir, name);
        const id = name.slice(0, -8);
        let args;
        try { args = readFileSync(file, "utf8").split(/\\r?\\n/); rmSync(file, { force: true }); } catch { continue; }
        const queued = readFileSync(${JSON.stringify(modeFile)}, "utf8").trim() === "queue";
        if (!queued) writeReply(id, { accepted: true });
        if (readFileSync(${JSON.stringify(modeFile)}, "utf8").trim() === "die_restoring") {
          writeReply(id, { restoring: true });
          process.exit(1);
        }
        const result = respond(...args);
        if (result.progress) writeReply(id, result.progress);
        if (result.reply) writeReply(id, result.reply);
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  process.on("exit", () => { try { if (readFileSync(lock, "utf8") === lockText) rmSync(lock, { force: true }); } catch {} });
  loop().catch((e) => { console.error(e); process.exit(1); });
} else {
  const result = respond(...process.argv.slice(2));
  if (result.progress) say(result.progress);
  if (result.reply) say(result.reply);
}
`);

const BASE = await freePortBlock(2);
const env = {
  ...process.env,
  DOTA2_CAPTURE_HELPER: helper,
  DOTA2_SCREENSHOT_DIR: shotDir,
  DOTA2_VCON_STATE_DIR: path.join(work, "daemon-state"),
  DOTA2_VCON_DOTA_PORT: "1", DOTA2_VCON_GUI_PORT: String(BASE),
};
env.DOTA2_VCON_CTRL_PORT = String(Number(env.DOTA2_VCON_GUI_PORT) + 1);
const { call, notify, kill } = spawnMcpServer({ timeoutMs: 45000, env, cleanupDaemon: true });
await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "shot", version: "0" } });
notify("notifications/initialized");
await sleep(12000);

const shoot = async (mode, args = {}) => {
  writeFileSync(modeFile, mode);
  return (await call("tools/call", { name: "dota_screenshot", arguments: args })).result;
};
const text = (r) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
const envelope = (r) => JSON.parse(r.content.find((c) => c.type === "text").text);
const image = (r) => r.content.find((c) => c.type === "image");
const lockPid = (raw) => Number(raw.trim().split(/\r?\n/)[1]);
const pidAlive = (pid) => {
  try { process.kill(pid, 0); } catch { return false; }
  if (process.platform === "win32") return true;
  // A killed unref()'ed child can stay a zombie until its parent exits; it is not running.
  try { return readFileSync(`/proc/${pid}/stat`, "utf8").split(" ")[2] !== "Z"; } catch { /* macOS has no procfs */ }
  try {
    const stat = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim();
    return stat.length > 0 && !stat.startsWith("Z");
  } catch { return false; }
};

// 成功：image 内容 + 契约信封；max_width/format/restore 透传给辅助程序；不需要 vconsole
const ok = await shoot("ok", { max_width: 640, format: "png" });
assert(!ok.isError, "screenshot ok without vconsole: " + text(ok));
const okEnv = envelope(ok);
assert(ok.content.filter((c) => c.type === "text").length === 1, "success carries exactly one envelope (no duplicated raw summary)");
assert(okEnv.ok === true && okEnv.data.stale === false, "fresh success is not marked stale");
const img = image(ok);
assert(img && img.mimeType === "image/png", "returns png image content");
assert(Buffer.from(img.data, "base64").toString() === "FAKEIMG 640 png 1", "max_width/format/restore reach the helper");
assert(existsSync(okEnv.data.path) && path.resolve(okEnv.data.path).startsWith(path.resolve(shotDir) + path.sep),
  "envelope data names the saved file inside DOTA2_SCREENSHOT_DIR: " + JSON.stringify(okEnv.data));
assert(typeof okEnv.data.captured_at === "string" && okEnv.data.width === 640 && okEnv.data.height === 100,
  "envelope data carries the capture time and dimensions: " + JSON.stringify(okEnv.data));
assert(okEnv.text.includes(okEnv.data.path), "envelope text is the human summary naming the file");

const def = await shoot("ok");
assert(image(def).mimeType === "image/jpeg" && Buffer.from(image(def).data, "base64").toString() === "FAKEIMG 1280 jpeg 1", "defaults: 1280 jpeg restore");
const watcherLock = path.join(work, "daemon-state", "capture-watcher", "watcher.lock");
const watcherRaw = readFileSync(watcherLock, "utf8");
const watcherPid = lockPid(watcherRaw);
assert(watcherPid > 0, "persistent watcher is running");
const stale = await shoot("stale");
const staleEnv = envelope(stale);
assert(!stale.isError && image(stale) && staleEnv.data.stale === true && /captured at/.test(staleEnv.text),
  "cached frame is returned with an explicit stale marker: " + JSON.stringify(staleEnv));
assert(image(stale).data === image(def).data, "stale result is the previously cached image, not a different frame");
assert(readFileSync(watcherLock, "utf8") === watcherRaw, "multiple captures share one persistent helper");

// 卡死：照常返回图片并标注
const hung = await shoot("hung");
assert(!hung.isError && image(hung) && /hung: true/.test(envelope(hung).text), "hung window still returns image, flagged: " + text(hung));
const hungNoFrame = await shoot("hung_no_frame");
assert(hungNoFrame.isError && /not responding/.test(text(hungNoFrame)) && /no frame/i.test(text(hungNoFrame)) && !image(hungNoFrame), "sustained hang with no frame reports the real cause: " + text(hungNoFrame));

// 最小化：默认恢复后截图；restore:false 报已最小化
const restored = await shoot("minimized");
assert(!restored.isError && /restored/.test(envelope(restored).text), "minimized window restored and captured");
const noRestore = await shoot("minimized", { restore: false });
assert(noRestore.isError && /minimized/i.test(text(noRestore)), "restore:false reports minimized: " + text(noRestore));

// 找不到窗口：报错，不截全屏
const none = await shoot("no_window");
assert(none.isError && /No Dota 2 game window/i.test(text(none)) && !image(none), "no window -> error, no image: " + text(none));

// 超时：已开始处理的助手挂住时 5s 内返回错误，并真正停掉它
const t0 = Date.now();
const hang = await shoot("hang");
assert(hang.isError && /timed out/i.test(text(hang)) && Date.now() - t0 < 7000, "hung helper killed on timeout: " + text(hang));
assert(!pidAlive(watcherPid) && (!existsSync(watcherLock) || lockPid(readFileSync(watcherLock, "utf8")) !== watcherPid), "timed-out watcher is stopped and its lock is gone");
assert(!existsSync(minimizedMarker), "no re-minimize when the window was never restored");

// 未 accepted 的请求只是排队超时，不能杀掉健康共享助手
const queued = await shoot("queue");
assert(queued.isError && /still queued/.test(text(queued)) && existsSync(watcherLock), "queued timeout leaves the shared watcher running");
const queuePid = lockPid(readFileSync(watcherLock, "utf8"));
assert(pidAlive(queuePid), "queued watcher process is still alive");

// 超时且辅助程序已恢复过窗口：总 deadline 到期后不再额外等待补最小化，错误会明确说明
const hangRestoring = await shoot("hang_restoring");
assert(hangRestoring.isError && /could not be minimized again before the 5s deadline/.test(text(hangRestoring)) && !existsSync(minimizedMarker), "timeout after restore reports incomplete re-minimize within the total deadline: " + text(hangRestoring));
assert(!pidAlive(queuePid), "accepted restoring timeout stops the old watcher");

// 启动等待与请求共享同一个 deadline，不能叠加成 5s + 5s
const slowStarted = Date.now();
const slowStart = await shoot("slow_start");
assert(slowStart.isError && /timed out/.test(text(slowStart)) && Date.now() - slowStarted < 6500, "startup and capture share one 5s deadline: " + text(slowStart));

// 助手在 restoring 进度之后崩溃/被杀：非超时分支同样要补最小化
rmSync(minimizedMarker, { force: true });
const diedRestoring = await shoot("die_restoring");
assert(diedRestoring.isError && /exited while capturing/.test(text(diedRestoring)) && /minimized again/.test(text(diedRestoring)) && existsSync(minimizedMarker), "helper loss after restore also re-minimizes: " + text(diedRestoring));
const requestDir = path.join(work, "daemon-state", "capture-watcher");
assert(!readdirSync(requestDir).some((f) => /\.(request|reply|tmp)$/.test(f)), "completed and timed-out requests leave no protocol files");

// 失败时不留残缺文件；成功但文件读不到时返回工具错误而不是原始异常
const before = readdirSync(shotDir).length;
const partial = await shoot("partial_no_frame");
assert(partial.isError && readdirSync(shotDir).length === before, "failed capture leaves no partial file");
const nofile = await shoot("ok_nofile");
assert(nofile.isError && /could not be read/.test(text(nofile)), "missing image after ok -> tool error: " + text(nofile));

// 只保留最近 20 张，且不删目录里不是本工具生成的文件
writeFileSync(path.join(shotDir, "dota-my-notes.txt"), "keep me");
for (let i = 0; i < 22; i++) await shoot("ok");
const kept = readdirSync(shotDir).filter((f) => /\.(jpg|png)$/.test(f)).length;
assert(kept === 20, "keeps the 20 most recent screenshots (got " + kept + ")");
assert(existsSync(path.join(shotDir, "dota-my-notes.txt")), "prune leaves foreign files alone");

kill();

// ---- 进程内：直接调模块（与 MCP 测试使用不同的 watcher 状态目录） ----
const directStates = ["direct-state", "missing-state"];
const cleanupDirectWatchers = () => {
  for (const state of directStates) {
    try {
      const raw = readFileSync(path.join(work, state, "capture-watcher", "watcher.lock"), "utf8");
      const pid = lockPid(raw);
      if (pid > 0) process.kill(pid);
    } catch {}
  }
};
process.on("exit", cleanupDirectWatchers); // 进程内断言失败也不能留下永久运行的假 watcher
process.env.DOTA2_SCREENSHOT_DIR = shotDir;
process.env.DOTA2_VCON_STATE_DIR = path.join(work, "direct-state");
const { captureScreenshot } = await import("../dist/tools/screenshot.js");
const opts = { maxWidth: 1280, format: "jpeg", restore: true, dotaPath: null };

// 独占全屏（保存的视频设置 fullscreen "1"）：最小化窗口不恢复，报错建议无边框
const fakeDota = path.join(work, "dota");
mkdirSync(path.join(fakeDota, "game", "dota", "cfg"), { recursive: true });
writeFileSync(path.join(fakeDota, "game", "dota", "cfg", "video.txt"), ['"config"', "{", '\t"setting.fullscreen"\t\t"1"', "}", ""].join("\n"));
process.env.DOTA2_CAPTURE_HELPER = helper;
writeFileSync(modeFile, "minimized");
const ex = await captureScreenshot({ ...opts, dotaPath: fakeDota });
assert(!ex.ok && /exclusive fullscreen/.test(ex.text), "exclusive fullscreen: minimized window not restored: " + ex.text);
writeFileSync(modeFile, "no_window");
const nw = await captureScreenshot({ ...opts, dotaPath: fakeDota });
assert(!nw.ok && nw.text.includes(path.join(fakeDota, "game", "bin", "win64", "dota2.exe")), "no-window error names the real dota2.exe path: " + nw.text);

// 辅助程序起不来：报错里保留启动失败原因（独立目录，不能复用前面的假 watcher）
process.env.DOTA2_VCON_STATE_DIR = path.join(work, "missing-state");
mkdirSync(path.join(work, "missing-state", "capture-watcher"), { recursive: true });
writeFileSync(path.join(work, "missing-state", "capture-watcher", "watcher.lock"), "");
process.env.DOTA2_CAPTURE_HELPER = path.join(work, "missing-helper.exe");
const gone = await captureScreenshot(opts);
assert(!gone.ok && /no result/.test(gone.text) && /ENOENT|not found|cannot find/i.test(gone.text), "empty stale lock is removed and launch failure keeps its cause: " + gone.text);

// 非 Windows：不设替换时直接报只支持 Windows（只能在非 win32 上断言）
delete process.env.DOTA2_CAPTURE_HELPER;
if (process.platform !== "win32") {
  const nonWin = await captureScreenshot(opts);
  assert(!nonWin.ok && /Windows only/.test(nonWin.text), "non-Windows reports Windows only");
}

cleanupDirectWatchers();
delete process.env.DOTA2_VCON_STATE_DIR;
await sleep(300);
rmSync(work, { recursive: true, force: true });
console.log("PASS");
process.exit(0);

// 离线冒烟：dota_screenshot 工具（MCP 工具层，经 stdio 调真实 server）。
// 只替换截图辅助程序这一个边界：DOTA2_CAPTURE_HELPER 指向下面生成的假辅助程序（node 脚本，Windows/Linux 都能跑），
// 它按 MODE 文件里的指令输出协议 JSON。不需要 Dota、vconsole 或 relay 连接（同时证明工具不受门控）。
// 独占全屏、辅助程序启动失败、非 Windows 三条路径在进程内直接调 captureScreenshot（要传 dotaPath / 换掉辅助程序）。
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnMcpServer, assert, sleep } from "./lib-mcp.mjs";

const work = mkdtempSync(path.join(tmpdir(), "screenshot-test-"));
const modeFile = path.join(work, "mode.txt");
const shotDir = path.join(work, "shots");
const helper = path.join(work, "fake-capture.mjs");
const minimizedMarker = path.join(work, "minimized-again.txt");
// 假辅助程序：协议同真实 helper —— argv: outPath maxWidth format restore，或 --minimize；stdout 每行一个 JSON
writeFileSync(helper, `
import { readFileSync, writeFileSync } from "node:fs";
const [outPath, maxWidth, format, restore] = process.argv.slice(2);
const say = (o) => console.log(JSON.stringify(o));
if (outPath === "--minimize") { writeFileSync(${JSON.stringify(minimizedMarker)}, "1"); say({ ok: true }); process.exit(0); }
const mode = readFileSync(${JSON.stringify(modeFile)}, "utf8").trim();
if (mode === "hang") { setTimeout(() => {}, 60000); }
else if (mode === "hang_restoring") { say({ restoring: true }); setTimeout(() => {}, 60000); }
else if (mode === "ok_nofile") { say({ ok: true, width: 1, height: 1, hung: false, restored: false }); }
else if (mode === "partial_no_frame") { writeFileSync(outPath, "PARTIAL"); say({ ok: false, error: "no_frame", message: "x" }); }
else if (mode === "ok" || mode === "hung") {
  writeFileSync(outPath, "FAKEIMG " + [maxWidth, format, restore].join(" "));
  say({ ok: true, width: Number(maxWidth), height: 100, hung: mode === "hung", restored: false });
} else if (mode === "minimized" && restore === "1") {
  writeFileSync(outPath, "FAKEIMG restored");
  say({ restoring: true });
  say({ ok: true, width: 1280, height: 720, hung: false, restored: true });
} else {
  say({ ok: false, error: mode, message: "fake " + mode });
}
`);

const env = {
  ...process.env,
  DOTA2_CAPTURE_HELPER: helper,
  DOTA2_SCREENSHOT_DIR: shotDir,
  DOTA2_VCON_DOTA_PORT: "1", DOTA2_VCON_GUI_PORT: String(20000 + Math.floor(Math.random() * 20000)),
};
env.DOTA2_VCON_CTRL_PORT = String(Number(env.DOTA2_VCON_GUI_PORT) + 1);
const { call, notify, kill } = spawnMcpServer({ timeoutMs: 45000, env });
await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "shot", version: "0" } });
notify("notifications/initialized");
await sleep(12000);

const shoot = async (mode, args = {}) => {
  writeFileSync(modeFile, mode);
  return (await call("tools/call", { name: "dota_screenshot", arguments: args })).result;
};
const text = (r) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
const image = (r) => r.content.find((c) => c.type === "image");

// 成功：image 内容 + 文件路径；max_width/format/restore 透传给辅助程序；不需要 vconsole
const ok = await shoot("ok", { max_width: 640, format: "png" });
assert(!ok.isError, "screenshot ok without vconsole: " + text(ok));
const img = image(ok);
assert(img && img.mimeType === "image/png", "returns png image content");
assert(Buffer.from(img.data, "base64").toString() === "FAKEIMG 640 png 1", "max_width/format/restore reach the helper");
assert(text(ok).includes(shotDir), "result names the saved file");

const def = await shoot("ok");
assert(image(def).mimeType === "image/jpeg" && Buffer.from(image(def).data, "base64").toString() === "FAKEIMG 1280 jpeg 1", "defaults: 1280 jpeg restore");

// 卡死：照常返回图片并标注
const hung = await shoot("hung");
assert(!hung.isError && image(hung) && /hung: true/.test(text(hung)), "hung window still returns image, flagged: " + text(hung));

// 最小化：默认恢复后截图；restore:false 报已最小化
const restored = await shoot("minimized");
assert(!restored.isError && /restored/.test(text(restored)), "minimized window restored and captured");
const noRestore = await shoot("minimized", { restore: false });
assert(noRestore.isError && /minimized/i.test(text(noRestore)), "restore:false reports minimized: " + text(noRestore));

// 找不到窗口：报错，不截全屏
const none = await shoot("no_window");
assert(none.isError && /No Dota 2 game window/i.test(text(none)) && !image(none), "no window -> error, no image: " + text(none));

// 超时：辅助程序挂住时 5s 内返回错误
const t0 = Date.now();
const hang = await shoot("hang");
assert(hang.isError && /timed out/i.test(text(hang)) && Date.now() - t0 < 9000, "hung helper killed on timeout: " + text(hang));
assert(!existsSync(minimizedMarker), "no re-minimize when the window was never restored");

// 超时且辅助程序已恢复过窗口：它的 finally 跑不到，工具要补一次最小化
const hangRestoring = await shoot("hang_restoring");
assert(hangRestoring.isError && /minimized again/.test(text(hangRestoring)) && existsSync(minimizedMarker), "timeout after restore re-minimizes the window: " + text(hangRestoring));

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

// ---- 进程内：直接调模块 ----
process.env.DOTA2_SCREENSHOT_DIR = shotDir;
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

// 辅助程序起不来：报错里保留启动失败原因
process.env.DOTA2_CAPTURE_HELPER = path.join(work, "missing-helper.exe");
const gone = await captureScreenshot(opts);
assert(!gone.ok && /no result/.test(gone.text) && /ENOENT|not found|cannot find/i.test(gone.text), "launch failure keeps its cause: " + gone.text);

// 非 Windows：不设替换时直接报只支持 Windows（只能在非 win32 上断言）
delete process.env.DOTA2_CAPTURE_HELPER;
if (process.platform !== "win32") {
  const nonWin = await captureScreenshot(opts);
  assert(!nonWin.ok && /Windows only/.test(nonWin.text), "non-Windows reports Windows only");
}

rmSync(work, { recursive: true, force: true });
console.log("PASS");
process.exit(0);

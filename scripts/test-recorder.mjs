// 离线冒烟：dota_record 视频录制（模块层，假 WGC 录制助手 + 假 ffmpeg）。
// 只替换两个不可控边界：DOTA2_CAPTURE_HELPER 指向 Node 假助手（按 --record <dir> <fps> <ms>
// 逐帧写 PNG 并回报 JSON），DOTA2_FFMPEG 指向 Node 假 ffmpeg（记录 argv、按模式产出文件）。
// 不启动真实 ffmpeg、不需要 Dota/vconsole/relay，因此这里不做任何真实录制。
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert } from "./lib-mcp.mjs";

const work = mkdtempSync(path.join(tmpdir(), "recorder-test-"));
const helperMode = path.join(work, "helper-mode.txt");
const ffmpegMode = path.join(work, "ffmpeg-mode.txt");
const helperArgsFile = path.join(work, "helper-args.json");
const argvFile = path.join(work, "ffmpeg-args.json");
const recordDir = path.join(work, "videos");
const helper = path.join(work, "fake-record.mjs");
const ffmpeg = path.join(work, "fake-ffmpeg.mjs");

// 假录制助手：与真实 helper 同一 --record <dir> <fps> <durationMs> 契约，按模式写帧或返回错误
writeFileSync(helper, `
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
if (args[0] !== "--record") { console.log(JSON.stringify({ ok: false, error: "internal", message: "unexpected args" })); process.exit(1); }
const dir = args[1], fps = Number(args[2]), ms = Number(args[3]);
writeFileSync(${JSON.stringify(helperArgsFile)}, JSON.stringify({ dir, fps, ms }));
const mode = readFileSync(${JSON.stringify(helperMode)}, "utf8").trim();
const fail = (error, message) => { console.log(JSON.stringify({ ok: false, error, message })); process.exit(2); };
if (mode === "no_window") fail("no_window", "No Dota 2 game window found.");
if (mode === "minimized") fail("minimized", "The Dota 2 window is minimized.");
if (mode === "no_frame") fail("no_frame", "No frame arrived from the Dota 2 window.");
const frames = Math.round(ms / 1000 * fps);
if (mode === "ok_nofiles") { console.log(JSON.stringify({ ok: true, width: 1281, height: 721, frames, new_frames: frames - 1 })); process.exit(0); }
mkdirSync(dir, { recursive: true });
for (let i = 0; i < frames; i++) writeFileSync(path.join(dir, "frame-" + String(i).padStart(6, "0") + ".png"), "PNG");
if (mode === "static") fail("no_new_frames", "Windows delivered no new frames from the Dota 2 window while recording. Remedy: run 'r_always_render_all_windows 1' in the console, record again, then restore it to 0.");
console.log(JSON.stringify({ ok: true, width: 1281, height: 721, frames, new_frames: frames - 1 }));
`);

// 假 ffmpeg：记录收到的完整 argv，并模拟成功 / 无输出 / 零字节输出 / 编码失败
writeFileSync(ffmpeg, `
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(args));
const mode = readFileSync(${JSON.stringify(ffmpegMode)}, "utf8").trim();
const out = args[args.length - 1];
if (mode === "empty") process.exit(0);
if (mode === "zero_file") { writeFileSync(out, ""); process.exit(0); }
if (mode === "fail") { console.error("fake encode error"); process.exit(1); }
writeFileSync(out, "FAKEVIDEO");
`);

writeFileSync(helperMode, "ok");
writeFileSync(ffmpegMode, "ok");
process.env.DOTA2_CAPTURE_HELPER = helper;
process.env.DOTA2_FFMPEG = ffmpeg;
process.env.DOTA2_RECORD_DIR = recordDir;

const { recordVideo } = await import("../dist/tools/recorder.js");
const ffmpegArgs = () => JSON.parse(readFileSync(argvFile, "utf8"));
const helperArgs = () => JSON.parse(readFileSync(helperArgsFile, "utf8"));
const argValue = (args, flag) => args[args.indexOf(flag) + 1];

// 成功：助手逐帧写 PNG，ffmpeg 以图片序列编码；元数据来自助手与产物文件
let r = await recordVideo({ duration: 3, fps: 25 });
assert(r.ok === true && r.data, "success returns {ok:true,data}: " + JSON.stringify(r));
const helperCall = helperArgs();
assert(helperCall.fps === 25 && helperCall.ms === 3000, "fps and duration reach the capture helper: " + JSON.stringify(helperCall));
assert(!existsSync(helperCall.dir), "temporary frame directory is removed after encoding: " + helperCall.dir);
const args = ffmpegArgs();
const input = args.join(" ");
assert(input.includes("frame-%06d.png"), "ffmpeg reads the captured PNG sequence: " + input);
assert(argValue(args, "-framerate") === "25", "fps reaches ffmpeg");
assert(argValue(args, "-start_number") === "0", "image sequence starts at the first captured frame");
assert(input.includes("crop=trunc(iw/2)*2:trunc(ih/2)*2"), "odd window sizes are cropped to even dimensions for yuv420p");
assert(args[args.length - 1] === r.data.path, "ffmpeg writes the returned path");
assert(path.resolve(r.data.path).startsWith(path.resolve(recordDir)), "default output lives in the recordings dir: " + r.data.path);
assert(existsSync(r.data.path), "recorded file exists");
assert(r.data.duration_s === 3 && r.data.fps === 25 && r.data.width === 1280 && r.data.height === 720 && r.data.bytes === 9,
  "metadata describes the produced file: " + JSON.stringify(r.data));
assert(typeof r.text === "string" && r.text.includes(r.data.path), "text summary names the file");

// 默认 fps 12；duration 夹取到 1–30，fps 上限 30
r = await recordVideo({ duration: 0.2 });
assert(r.ok && r.data.fps === 12 && r.data.duration_s === 1, "defaults to 12 fps and clamps low durations to 1s");
assert(helperArgs().fps === 12 && helperArgs().ms === 1000, "default fps/clamped duration reach the helper");
assert(argValue(ffmpegArgs(), "-framerate") === "12", "default fps reaches ffmpeg");
r = await recordVideo({ duration: 99, fps: 240 });
assert(r.ok && r.data.duration_s === 30 && r.data.fps === 30, "clamps high durations to 30s and fps to 30");
assert(helperArgs().fps === 30 && helperArgs().ms === 30000, "clamped fps/duration reach the helper");

// 显式 output：相对路径解析到录制目录
r = await recordVideo({ duration: 1, output: "custom.mp4" });
assert(r.ok && r.data.path === path.resolve(recordDir, "custom.mp4"), "explicit output resolves against the recordings directory");

// 输出边界：只允许录制目录内的路径（相对子目录可以，绝对路径在外或 .. 逃逸都不行）
const outside = await recordVideo({ duration: 1, output: path.join(work, "outside.mp4") });
assert(outside.ok === false && outside.code === "invalid_arg" && /recordings directory/.test(outside.message),
  "output outside the recordings directory is invalid_arg: " + JSON.stringify(outside));
const escape = await recordVideo({ duration: 1, output: path.join("..", "escape.mp4") });
assert(escape.ok === false && escape.code === "invalid_arg", "output escaping with .. is invalid_arg: " + JSON.stringify(escape));
r = await recordVideo({ duration: 1, output: path.join("nested", "clip.mp4") });
assert(r.ok && r.data.path === path.resolve(recordDir, "nested", "clip.mp4"), "a relative subdirectory inside the recordings directory is allowed");

// 找不到窗口 / 最小化 / 无新帧 / 无首帧：都明确失败，且不启动 ffmpeg
for (const [mode, code, needle] of [
  ["no_window", "no_window", /No Dota 2 game window/i],
  ["minimized", "no_window", /minimized/i],
  ["static", "no_new_frames", /r_always_render_all_windows/],
  ["no_frame", "empty_capture", /frame/i],
]) {
  writeFileSync(helperMode, mode);
  rmSync(argvFile, { force: true });
  r = await recordVideo({ duration: 1 });
  assert(r.ok === false && r.code === code, `${mode} -> ${code}: ` + JSON.stringify(r));
  assert(needle.test(r.message), `${mode} message is actionable: ` + r.message);
  assert(!existsSync(argvFile), `ffmpeg is never started when capture fails (${mode})`);
}

// 无新帧的结果单独带 remedy 信号：工具层据此决定是否改 cvar 重试
writeFileSync(helperMode, "static");
r = await recordVideo({ duration: 1 });
assert(r.ok === false && r.code === "no_new_frames" && r.needsRemedy === "no_new_frames",
  "no_new_frames carries the structured remedy signal: " + JSON.stringify(r));

// 助手报告成功却没写帧：empty_capture，不启动 ffmpeg
writeFileSync(helperMode, "ok_nofiles");
rmSync(argvFile, { force: true });
r = await recordVideo({ duration: 1 });
assert(r.ok === false && r.code === "empty_capture", "helper success without frames -> empty_capture: " + JSON.stringify(r));
assert(!existsSync(argvFile), "ffmpeg is never started without captured frames");

// 缺 ffmpeg：明确错误码
writeFileSync(helperMode, "ok");
process.env.DOTA2_FFMPEG = path.join(work, "no-such-ffmpeg.exe");
r = await recordVideo({ duration: 1 });
assert(r.ok === false && r.code === "ffmpeg_missing", "missing ffmpeg -> ffmpeg_missing: " + JSON.stringify(r));
assert(/FFmpeg/i.test(r.message), "missing ffmpeg message names the binary class");

// 无输出 / 零字节输出 / 编码失败：都归为 empty_capture
process.env.DOTA2_FFMPEG = ffmpeg;
for (const mode of ["empty", "zero_file", "fail"]) {
  writeFileSync(ffmpegMode, mode);
  r = await recordVideo({ duration: 1 });
  assert(r.ok === false && r.code === "empty_capture", `ffmpeg ${mode} -> empty_capture: ` + JSON.stringify(r));
}

rmSync(work, { recursive: true, force: true });
console.log("PASS");

// 离线冒烟：dota_record 视频录制（模块层，假 ffmpeg + 假窗口辅助程序）。
// 只替换两个不可控边界：DOTA2_FFMPEG 指向 Node 假 ffmpeg（记录 argv、按模式产出文件），
// DOTA2_CAPTURE_HELPER 复用截图的假辅助程序协议（--rect 返回窗口矩形或 no_window）。
// 不启动真实 ffmpeg、不需要 Dota/vconsole/relay，因此这里不做任何真实录制。
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert } from "./lib-mcp.mjs";

const work = mkdtempSync(path.join(tmpdir(), "recorder-test-"));
const helperMode = path.join(work, "helper-mode.txt");
const ffmpegMode = path.join(work, "ffmpeg-mode.txt");
const argvFile = path.join(work, "ffmpeg-args.json");
const recordDir = path.join(work, "videos");
const helper = path.join(work, "fake-window.mjs");
const ffmpeg = path.join(work, "fake-ffmpeg.mjs");

// 假窗口助手：与真实截图助手同一 --rect 协议，只按模式回答矩形或 no_window
writeFileSync(helper, `
import { readFileSync } from "node:fs";
const mode = readFileSync(${JSON.stringify(helperMode)}, "utf8").trim();
if (process.argv[2] !== "--rect") { console.log(JSON.stringify({ ok: false, error: "internal", message: "unexpected args" })); process.exit(1); }
if (mode === "rect") console.log(JSON.stringify({ ok: true, x: 100, y: 50, width: 1280, height: 720 }));
else console.log(JSON.stringify({ ok: false, error: "no_window", message: "No Dota 2 game window found." }));
`);

// 假 ffmpeg：记录收到的完整 argv，并模拟成功 / 无输出 / 零字节输出
writeFileSync(ffmpeg, `
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(args));
const mode = readFileSync(${JSON.stringify(ffmpegMode)}, "utf8").trim();
const out = args[args.length - 1];
if (mode === "empty") process.exit(0);
if (mode === "zero_file") { writeFileSync(out, ""); process.exit(0); }
writeFileSync(out, "FAKEVIDEO");
`);

writeFileSync(helperMode, "rect");
writeFileSync(ffmpegMode, "ok");
process.env.DOTA2_CAPTURE_HELPER = helper;
process.env.DOTA2_FFMPEG = ffmpeg;
process.env.DOTA2_RECORD_DIR = recordDir;

const { recordVideo } = await import("../dist/tools/recorder.js");
const envelope = (r) => JSON.parse(r.content[0].text);
const ffmpegArgs = () => JSON.parse(readFileSync(argvFile, "utf8"));
const argValue = (args, flag) => args[args.indexOf(flag) + 1];

// 成功：窗口矩形换算成 video_size/offset，产物文件元数据进入 data
let raw = await recordVideo({ duration: 3, fps: 25 });
let r = envelope(raw);
assert(!raw.isError && r.ok === true && r.data, "success returns {ok:true,data}: " + JSON.stringify(r));
const args = ffmpegArgs();
const input = args.join(" ");
assert(input.includes("ddagrab"), "ffmpeg input uses ddagrab: " + input);
assert(input.includes("video_size=1280x720"), "crop size comes from the window rectangle");
assert(input.includes("offset_x=100") && input.includes("offset_y=50"), "crop offset comes from the window rectangle");
assert(input.includes("framerate=25"), "fps reaches ddagrab");
assert(argValue(args, "-t") === "3", "duration reaches ffmpeg");
assert(args[args.length - 1] === r.data.path, "ffmpeg writes the returned path");
assert(path.resolve(r.data.path).startsWith(path.resolve(recordDir)), "default output lives in the recordings dir: " + r.data.path);
assert(existsSync(r.data.path), "recorded file exists");
assert(r.data.duration_s === 3 && r.data.fps === 25 && r.data.width === 1280 && r.data.height === 720 && r.data.bytes === 9,
  "metadata describes the produced file: " + JSON.stringify(r.data));
assert(typeof r.text === "string" && r.text.includes(r.data.path), "text summary names the file");

// 默认 fps 30；duration 夹取到 1–30
r = envelope(await recordVideo({ duration: 0.2 }));
assert(r.ok && r.data.fps === 30 && r.data.duration_s === 1, "defaults to 30 fps and clamps low durations to 1s");
assert(argValue(ffmpegArgs(), "-t") === "1", "clamped low duration reaches ffmpeg");
r = envelope(await recordVideo({ duration: 99 }));
assert(r.ok && r.data.duration_s === 30, "clamps high durations to 30s");
assert(argValue(ffmpegArgs(), "-t") === "30", "clamped high duration reaches ffmpeg");

// 缺 ffmpeg：明确错误码，且不进入捕获
process.env.DOTA2_FFMPEG = path.join(work, "no-such-ffmpeg.exe");
rmSync(argvFile, { force: true });
raw = await recordVideo({ duration: 1 });
r = envelope(raw);
assert(raw.isError === true && r.ok === false && r.code === "ffmpeg_missing", "missing ffmpeg -> ffmpeg_missing: " + JSON.stringify(r));
assert(/FFmpeg/i.test(r.message) && !existsSync(argvFile), "missing ffmpeg is reported before spawning and names the binary class");

// 找不到窗口：明确错误码，且不启动 ffmpeg
process.env.DOTA2_FFMPEG = ffmpeg;
writeFileSync(helperMode, "no_window");
rmSync(argvFile, { force: true });
raw = await recordVideo({ duration: 1 });
r = envelope(raw);
assert(raw.isError === true && r.ok === false && r.code === "no_window", "no window -> no_window: " + JSON.stringify(r));
assert(!existsSync(argvFile), "ffmpeg is never started without a window rectangle");

// 无输出 / 零字节输出：都归为 empty_capture
writeFileSync(helperMode, "rect");
writeFileSync(ffmpegMode, "empty");
raw = await recordVideo({ duration: 1 });
r = envelope(raw);
assert(raw.isError === true && r.ok === false && r.code === "empty_capture", "no output file -> empty_capture: " + JSON.stringify(r));
writeFileSync(ffmpegMode, "zero_file");
raw = await recordVideo({ duration: 1 });
r = envelope(raw);
assert(raw.isError === true && r.ok === false && r.code === "empty_capture", "zero-byte output -> empty_capture: " + JSON.stringify(r));

rmSync(work, { recursive: true, force: true });
console.log("PASS");

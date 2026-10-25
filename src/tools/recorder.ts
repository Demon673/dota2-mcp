// dota_record：游戏视频录制（video recording）——复用截图的 Windows.Graphics.Capture 助手逐帧抓取
// Dota 2 游戏窗口本身（不截桌面矩形，因此窗口被遮挡或失焦也能录到游戏），帧写成 PNG 序列后交给
// FFmpeg 编码。助手找不到窗口/窗口最小化/窗口在录制中改尺寸都显式失败；不偷焦点、不前台化窗口。
// 失焦时 Dota 可能停止呈现新帧，助手以 no_new_frames 失败并给出 r_always_render_all_windows 补救。
// 外部二进制经 DOTA2_FFMPEG 替换（离线测试注入假 ffmpeg）；产物目录为 DOTA2_RECORD_DIR，
// 默认 os.tmpdir()/dota2-mcp/recordings。
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { scrubbedEnv } from "./process-env.js";
import { captureHelperCommand } from "./screenshot.js";
import { fail, ok, type ToolResult } from "./tool-result.js";

const DEFAULT_FPS = 12;
const MAX_FPS = 30;

export interface RecordOptions {
  duration: number;
  fps?: number;
  output?: string;
}

interface RunResult { stdout: string; stderr: string; timedOut: boolean; code: number | null; error: NodeJS.ErrnoException | null }

interface RecordReply {
  ok?: boolean;
  width?: number;
  height?: number;
  frames?: number;
  new_frames?: number;
  error?: string;
  message?: string;
}

function run(cmd: string, args: string[], timeout: number): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, encoding: "utf8", env: scrubbedEnv() }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "", timedOut: !!e?.killed, code: e ? (typeof e.code === "number" ? e.code : null) : 0, error: e });
    });
  });
}

/** DOTA2_FFMPEG：替换 ffmpeg 可执行文件；.js/.mjs 用当前 node 运行（离线测试注入 Node 假 ffmpeg）。 */
function ffmpegInvocation(ffmpeg: string, args: string[]): { cmd: string; args: string[] } {
  return /\.m?js$/i.test(ffmpeg)
    ? { cmd: process.execPath, args: [ffmpeg, ...args] }
    : { cmd: ffmpeg, args };
}

function helperFailure(reply: RecordReply): ToolResult {
  if (reply.error === "no_window") {
    return fail("no_window", "No Dota 2 game window found. Start Dota 2 first; nothing was recorded.");
  }
  if (reply.error === "minimized") {
    return fail("no_window", "The Dota 2 window is minimized. Restore it before recording; nothing was recorded.");
  }
  if (reply.error === "no_new_frames") {
    return fail("no_new_frames", reply.message || "Windows delivered no new frames from the game window while recording. Run 'r_always_render_all_windows 1' in the console, record again, then restore it to 0. Nothing was recorded.");
  }
  if (reply.error === "internal") {
    const why = (reply.message ?? "unknown error").replace(/\.+$/, "");
    return fail("internal", `The capture helper failed: ${why}. Nothing was recorded.`);
  }
  const why = (reply.message ?? reply.error ?? "unknown error").replace(/\.+$/, "");
  return fail("empty_capture", `The game window produced no usable frames: ${why}. Nothing was recorded.`);
}

export async function recordVideo(opts: RecordOptions): Promise<ToolResult> {
  const duration = Math.min(30, Math.max(1, opts.duration));
  const fps = Math.min(MAX_FPS, Math.max(1, Math.round(opts.fps ?? DEFAULT_FPS)));

  const dir = process.env.DOTA2_RECORD_DIR || path.join(tmpdir(), "dota2-mcp", "recordings");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = opts.output
    ? path.resolve(dir, opts.output)
    : path.join(dir, `dota-${stamp}-${randomBytes(2).toString("hex")}.mp4`);
  mkdirSync(path.dirname(out), { recursive: true });
  rmSync(out, { force: true }); // 覆盖语义：旧文件不能冒充本次产物

  let framesDir: string;
  try {
    framesDir = mkdtempSync(path.join(tmpdir(), "dota2-mcp-frames-"));
  } catch (e) {
    return fail("internal", `Could not create a temporary frame directory: ${(e as Error).message}. Nothing was recorded.`);
  }

  try {
    const helper = await captureHelperCommand(["--record", framesDir, String(fps), String(duration * 1000)]);
    if (!helper.ok) return fail(helper.code, helper.message);

    const captureTimeout = duration * 1000 + 30000;
    const capture = await run(helper.cmd, helper.args, captureTimeout);
    if (capture.error && (capture.error.code === "ENOENT" || capture.error.code === "EACCES")) {
      return fail("internal", `The capture helper could not be run (${helper.cmd}): ${capture.error.message}. Nothing was recorded.`);
    }
    if (capture.timedOut) {
      return fail("timeout", `Recording the game window timed out after ${Math.round(captureTimeout / 1000)}s and was stopped. Nothing was recorded.`);
    }
    let reply: RecordReply;
    try {
      reply = JSON.parse(capture.stdout.trim().split(/\r?\n/).pop() || "");
    } catch {
      return fail("internal", `The capture helper returned no result.${capture.stderr.trim() ? `\n${capture.stderr.trim().slice(-1500)}` : ""}`);
    }
    if (!reply.ok) return helperFailure(reply);

    const width = Math.round(Number(reply.width)), height = Math.round(Number(reply.height)), frames = Math.round(Number(reply.frames));
    if (!(width > 0 && height > 0 && frames > 0) || !existsSync(path.join(framesDir, "frame-000000.png"))) {
      return fail("empty_capture", "The capture helper reported success but wrote no frames. Nothing was recorded.");
    }

    // libx264 + yuv420p 要求宽高为偶数；窗口尺寸可能是奇数（实测 1936x1119），
    // 由 ffmpeg 裁掉一列/一行，并回报裁剪后的实际尺寸。
    const even = (n: number) => Math.max(2, n - (n % 2));
    const vw = even(width), vh = even(height);

    const ffmpeg = process.env.DOTA2_FFMPEG || "ffmpeg";
    const args = [
      "-hide_banner", "-loglevel", "error", "-y",
      "-framerate", String(fps),
      "-start_number", "0",
      "-i", path.join(framesDir, "frame-%06d.png"),
      "-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      out,
    ];
    const invocation = ffmpegInvocation(ffmpeg, args);
    const encodeTimeout = duration * 1000 + 30000;
    const r = await run(invocation.cmd, invocation.args, encodeTimeout);
    const discard = () => rmSync(out, { force: true });
    const detail = r.stderr.trim() ? `: ${r.stderr.trim().slice(-1500)}` : "";

    if (r.error && (r.error.code === "ENOENT" || r.error.code === "EACCES")) {
      discard();
      return fail("ffmpeg_missing", `FFmpeg was not found or could not be run (${ffmpeg}). Install FFmpeg and put it on PATH, or set DOTA2_FFMPEG to the executable. Nothing was recorded.`);
    }
    if (r.timedOut) {
      discard();
      return fail("timeout", `Encoding timed out after ${Math.round(encodeTimeout / 1000)}s and was stopped. Nothing was recorded.`);
    }
    if (r.error || r.code !== 0) {
      discard();
      return fail("empty_capture", `FFmpeg produced no video (exit ${r.code ?? "unknown"})${detail}. Nothing was recorded.`);
    }
    if (!existsSync(out) || statSync(out).size === 0) {
      discard();
      return fail("empty_capture", `FFmpeg exited without writing a usable video (${out}). Nothing was recorded.${detail}`);
    }

    const bytes = statSync(out).size;
    const data = { path: out, duration_s: duration, fps, width: vw, height: vh, bytes };
    return ok({ data, text: `Recorded ${out} (${duration}s at ${fps} fps, ${vw}x${vh}, ${bytes} bytes).` });
  } finally {
    rmSync(framesDir, { recursive: true, force: true });
  }
}

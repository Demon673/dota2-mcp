// dota_record：游戏视频录制（video recording）——复用截图的 Windows.Graphics.Capture 助手逐帧抓取
// Dota 2 游戏窗口本身（不截桌面矩形，因此窗口被遮挡或失焦也能录到游戏），帧写成 PNG 序列后交给
// FFmpeg 编码。助手找不到窗口/窗口最小化/窗口在录制中改尺寸都显式失败；不偷焦点、不前台化窗口。
// 失焦时 Dota 可能停止呈现新帧，助手以 no_new_frames 失败并给出 r_always_render_all_windows 补救。
// 外部二进制经 DOTA2_FFMPEG 替换（离线测试注入假 ffmpeg）；产物目录为 DOTA2_RECORD_DIR，
// 默认 os.tmpdir()/dota2-mcp/recordings，输出路径必须落在该目录内。
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCommand, nodeInvocation } from "./exec.js";
import { captureHelperCommand } from "./screenshot.js";
import type { ToolErrorCode } from "./tool-result.js";

const DEFAULT_FPS = 12;
const MAX_FPS = 30;

export interface RecordOptions {
  duration: number;
  fps?: number;
  output?: string;
}

export interface RecordMetadata {
  path: string;
  duration_s: number;
  fps: number;
  width: number;
  height: number;
  bytes: number;
}

/** 结构化结果：工具层用 ok()/fail() 包成契约信封，本模块不拼 ToolResult。
 *  needsRemedy 是 no_new_frames 的补救信号（失焦时游戏停止呈现新帧）。 */
export type RecordOutcome =
  | { ok: true; data: RecordMetadata; text: string }
  | { ok: false; code: ToolErrorCode; message: string; needsRemedy?: "no_new_frames" };

interface RecordReply {
  ok?: boolean;
  width?: number;
  height?: number;
  frames?: number;
  error?: string;
  message?: string;
}

function helperFailure(reply: RecordReply): RecordOutcome {
  if (reply.error === "no_new_frames") {
    return {
      ok: false,
      code: "no_new_frames",
      message: reply.message || "Windows delivered no new frames from the game window while recording. Run 'r_always_render_all_windows 1' in the console, record again, then restore it to 0. Nothing was recorded.",
      needsRemedy: "no_new_frames",
    };
  }
  if (reply.error === "no_window") {
    return { ok: false, code: "no_window", message: "No Dota 2 game window found. Start Dota 2 first; nothing was recorded." };
  }
  if (reply.error === "minimized") {
    return { ok: false, code: "no_window", message: "The Dota 2 window is minimized. Restore it before recording; nothing was recorded." };
  }
  if (reply.error === "internal") {
    const why = (reply.message ?? "unknown error").replace(/\.+$/, "");
    return { ok: false, code: "internal", message: `The capture helper failed: ${why}. Nothing was recorded.` };
  }
  const why = (reply.message ?? reply.error ?? "unknown error").replace(/\.+$/, "");
  return { ok: false, code: "empty_capture", message: `The game window produced no usable frames: ${why}. Nothing was recorded.` };
}

export async function recordVideo(opts: RecordOptions): Promise<RecordOutcome> {
  const duration = Math.min(30, Math.max(1, opts.duration));
  const fps = Math.min(MAX_FPS, Math.max(1, Math.round(opts.fps ?? DEFAULT_FPS)));

  const dir = path.resolve(process.env.DOTA2_RECORD_DIR || path.join(tmpdir(), "dota2-mcp", "recordings"));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  // 输出边界：录制目录内（含子目录）才允许写；绝对路径在外与 .. 逃逸都拒绝
  const out = opts.output
    ? path.resolve(dir, opts.output)
    : path.join(dir, `dota-${stamp}-${randomBytes(2).toString("hex")}.mp4`);
  const lower = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  if (!lower(out).startsWith(lower(dir) + path.sep)) {
    return { ok: false, code: "invalid_arg", message: `Output must stay inside the recordings directory (${dir}); got '${opts.output}'.` };
  }
  mkdirSync(path.dirname(out), { recursive: true });
  rmSync(out, { force: true }); // 覆盖语义：旧文件不能冒充本次产物

  let framesDir: string;
  try {
    framesDir = mkdtempSync(path.join(tmpdir(), "dota2-mcp-frames-"));
  } catch (e) {
    return { ok: false, code: "internal", message: `Could not create a temporary frame directory: ${(e as Error).message}. Nothing was recorded.` };
  }

  try {
    const helper = await captureHelperCommand(["--record", framesDir, String(fps), String(duration * 1000)]);
    if (!helper.ok) return { ok: false, code: helper.code, message: helper.message };

    const captureTimeout = duration * 1000 + 30000;
    const capture = await runCommand(helper.cmd, helper.args, captureTimeout);
    if (capture.error && (capture.error.code === "ENOENT" || capture.error.code === "EACCES")) {
      return { ok: false, code: "internal", message: `The capture helper could not be run (${helper.cmd}): ${capture.error.message}. Nothing was recorded.` };
    }
    if (capture.timedOut) {
      return { ok: false, code: "timeout", message: `Recording the game window timed out after ${Math.round(captureTimeout / 1000)}s and was stopped. Nothing was recorded.` };
    }
    let reply: RecordReply;
    try {
      reply = JSON.parse(capture.stdout.trim().split(/\r?\n/).pop() || "");
    } catch {
      return { ok: false, code: "internal", message: `The capture helper returned no result.${capture.stderr.trim() ? `\n${capture.stderr.trim().slice(-1500)}` : ""}` };
    }
    if (!reply.ok) return helperFailure(reply);

    const width = Math.round(Number(reply.width)), height = Math.round(Number(reply.height)), frames = Math.round(Number(reply.frames));
    if (!(width > 0 && height > 0 && frames > 0) || !existsSync(path.join(framesDir, "frame-000000.png"))) {
      return { ok: false, code: "empty_capture", message: "The capture helper reported success but wrote no frames. Nothing was recorded." };
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
    const invocation = nodeInvocation(ffmpeg, args);
    const encodeTimeout = duration * 1000 + 30000;
    const r = await runCommand(invocation.cmd, invocation.args, encodeTimeout);
    const discard = () => rmSync(out, { force: true });
    const detail = r.stderr.trim() ? `: ${r.stderr.trim().slice(-1500)}` : "";

    if (r.error && (r.error.code === "ENOENT" || r.error.code === "EACCES")) {
      discard();
      return { ok: false, code: "ffmpeg_missing", message: `FFmpeg was not found or could not be run (${ffmpeg}). Install FFmpeg and put it on PATH, or set DOTA2_FFMPEG to the executable. Nothing was recorded.` };
    }
    if (r.timedOut) {
      discard();
      return { ok: false, code: "timeout", message: `Encoding timed out after ${Math.round(encodeTimeout / 1000)}s and was stopped. Nothing was recorded.` };
    }
    if (r.error || r.code !== 0) {
      discard();
      return { ok: false, code: "empty_capture", message: `FFmpeg produced no video (exit ${r.code ?? "unknown"})${detail}. Nothing was recorded.` };
    }
    if (!existsSync(out) || statSync(out).size === 0) {
      discard();
      return { ok: false, code: "empty_capture", message: `FFmpeg exited without writing a usable video (${out}). Nothing was recorded.${detail}` };
    }

    const bytes = statSync(out).size;
    const data = { path: out, duration_s: duration, fps, width: vw, height: vh, bytes };
    return { ok: true, data, text: `Recorded ${out} (${duration}s at ${fps} fps, ${vw}x${vh}, ${bytes} bytes).` };
  } finally {
    rmSync(framesDir, { recursive: true, force: true });
  }
}

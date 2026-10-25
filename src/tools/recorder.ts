// dota_record：游戏视频录制（video recording）——从游戏外部用 FFmpeg ddagrab（D3D11 桌面复制）捕获 Dota 2 窗口矩形，
// 不经控制台、不给游戏发消息。窗口矩形复用截图辅助程序的 --rect（与 dota_screenshot 同一窗口查找），
// 换算成 ddagrab 的 video_size/offset_x/offset_y；矩形拿不到时显式失败，绝不回退到整屏。
// 外部二进制经 DOTA2_FFMPEG 替换（离线测试注入假 ffmpeg）；产物目录为 DOTA2_RECORD_DIR，
// 默认沿用截图目录的兄弟目录约定（os.tmpdir()/dota2-mcp/recordings）。
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { scrubbedEnv } from "./process-env.js";
import { gameWindowRect } from "./screenshot.js";
import { fail, ok, type ToolResult } from "./tool-result.js";

export interface RecordOptions {
  duration: number;
  fps?: number;
  output?: string;
}

interface RunResult { stdout: string; stderr: string; timedOut: boolean; code: number | null; error: NodeJS.ErrnoException | null }

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

export async function recordVideo(opts: RecordOptions): Promise<ToolResult> {
  const duration = Math.min(30, Math.max(1, opts.duration));
  const fps = Math.min(240, Math.max(1, Math.round(opts.fps ?? 30)));

  const window = await gameWindowRect();
  if (!window.ok) return fail(window.code, window.message);

  const dir = process.env.DOTA2_RECORD_DIR || path.join(tmpdir(), "dota2-mcp", "recordings");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = opts.output
    ? path.resolve(dir, opts.output)
    : path.join(dir, `dota-${stamp}-${randomBytes(2).toString("hex")}.mp4`);
  mkdirSync(path.dirname(out), { recursive: true });
  rmSync(out, { force: true }); // 覆盖语义：旧文件不能冒充本次产物

  const ffmpeg = process.env.DOTA2_FFMPEG || "ffmpeg";
  // shortcut: offset 按主显示器输出 0 的屏幕坐标传给 ddagrab，多显示器（窗口不在主屏）时会裁错；
  // 活体验证发现后改成 MonitorFromWindow + DXGI 输出索引映射
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi",
    "-i", `ddagrab=output_idx=0:framerate=${fps}:video_size=${window.width}x${window.height}:offset_x=${window.x}:offset_y=${window.y}:draw_mouse=0`,
    "-vf", "hwdownload,format=bgra",
    "-t", String(duration),
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    out,
  ];
  const invocation = ffmpegInvocation(ffmpeg, args);
  const timeout = duration * 1000 + 30000;
  const r = await run(invocation.cmd, invocation.args, timeout);
  const discard = () => rmSync(out, { force: true });
  const detail = r.stderr.trim() ? `: ${r.stderr.trim().slice(-1500)}` : "";

  if (r.error && (r.error.code === "ENOENT" || r.error.code === "EACCES")) {
    discard();
    return fail("ffmpeg_missing", `FFmpeg was not found or could not be run (${ffmpeg}). Install FFmpeg and put it on PATH, or set DOTA2_FFMPEG to the executable. Nothing was recorded.`);
  }
  if (r.timedOut) {
    discard();
    return fail("timeout", `Recording timed out after ${Math.round(timeout / 1000)}s and was stopped. Nothing was recorded.`);
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
  const data = { path: out, duration_s: duration, fps, width: window.width, height: window.height, bytes };
  return ok({ data, text: `Recorded ${out} (${duration}s at ${fps} fps, ${window.width}x${window.height}, ${bytes} bytes).` });
}

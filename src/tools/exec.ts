// 子进程封装：统一 execFile 选项，以及「.js/.mjs/.cjs 用当前 node 运行」的调用约定
// （离线测试用 Node 脚本替换外部二进制）。
import { execFile } from "node:child_process";
import { scrubbedEnv } from "./process-env.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  timedOut: boolean;
  code: number | null;
  error: NodeJS.ErrnoException | null;
}

export function runCommand(cmd: string, args: string[], timeout: number, maxBuffer?: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, encoding: "utf8", env: scrubbedEnv(), maxBuffer }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        timedOut: !!e?.killed,
        code: e ? (typeof e.code === "number" ? e.code : null) : 0,
        error: e,
      });
    });
  });
}

/** .js/.mjs/.cjs 不是可执行文件，改用当前 node 运行。 */
export function nodeInvocation(exe: string, args: string[]): { cmd: string; args: string[] } {
  return /\.(mjs|cjs|js)$/i.test(exe) ? { cmd: process.execPath, args: [exe, ...args] } : { cmd: exe, args };
}

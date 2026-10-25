// 工具返回契约的唯一构造入口：成功 {ok:true,...载荷}，失败 {ok:false,code,message} 且 isError。

/** 失败错误码表（spec：只增不减），agent 据此稳定分支而不是解析文案。 */
export const ERROR_CODES = [
  "dota_down",
  "vconsole_closed",
  "daemon_down",
  "cheats_off",
  "phase_wrong",
  "lua_too_long",
  "timeout",
  "precache_missing",
  "invalid_arg",
  "internal",
  "ffmpeg_missing",
  "no_window",
  "empty_capture",
] as const;

export type ToolErrorCode = (typeof ERROR_CODES)[number];

/** 成功载荷的三种契约形状：控制台窗口 / 纯文本 / 结构化数据（data 可附 text 摘要）。 */
export type OkPayload =
  | { lines: string; count: number; next_seq: number; dropped: number }
  | { text: string }
  | { data: unknown; text?: string };

/** MCP 工具返回：content[0] 是契约 JSON，人类可读文本作为 JSON 字段保留。 */
export interface ToolResult {
  [x: string]: unknown;
  content: [{ type: "text"; text: string }];
  isError?: boolean;
}

/** MCP 四类 hint：每个工具显式给出全部四项，避免客户端按各自默认值猜测。 */
export interface ToolHints {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/** 只读查询类：不改状态、可重复调用、无破坏、无外部副作用。 */
export const READ_ONLY_ANNOTATIONS: ToolHints = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function ok(payload: OkPayload): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...payload }) }] };
}

export function fail(code: ToolErrorCode, message: string): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ ok: false, code, message }) }], isError: true };
}

/** 同一契约的缩进版本：dota_status 的载荷人会读，缩进空格也让既有活体脚本的
 *  `"vconsole": true` / `"addon": "…"` text.includes 断言继续成立。 */
export function okPretty(payload: OkPayload): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...payload }, null, 2) }] };
}

/** 任意执行类（console_send、文件写入、重载或终止对局）：会改状态、不可安全重复、无外部网络副作用。 */
export const EXEC_ANNOTATIONS: ToolHints = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

/** 外部副作用类（如 vrf_ensure 可能联网下载并写缓存，或拉起游戏进程/窗口）：不是纯读，重复调用收敛到同一结果。 */
export const OPEN_WORLD_ANNOTATIONS: ToolHints = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** 截图：不改游戏状态，但每次调用落一个新文件，因此不幂等。 */
export const SCREENSHOT_ANNOTATIONS: ToolHints = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

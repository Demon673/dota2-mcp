// 离线冒烟：写操作与生命周期族（#23）迁移到统一契约。
// 只走 MCP 对外行为：tools/list 的 annotations / 五段式描述，tools/call 的 {ok,...} 壳。
// 不需要 Dota/vconsole：端口与 daemon 状态目录隔离；FileOps 真实读写——本机有 Steam 时用真实 Dota 目录，
// 没有时用临时最小 Steam 库（STEAM_PATH，同 test-fileops）。addon 名带随机后缀，结束只删本测试创建的目录。
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnMcpServer, assert, sleep, callJson } from "./lib-mcp.mjs";
import { freePortBlock } from "./lib-test-ports.mjs";

const work = mkdtempSync(path.join(tmpdir(), "migrate-write-"));
const addon = "dota2mcp_migrate_" + randomBytes(3).toString("hex");
const fakeDota = path.join(work, "steam", "steamapps", "common", "dota 2 beta");
for (const d of [["game", "dota"], ["game", "dota_addons", addon], ["content", "dota_addons", addon]]) {
  mkdirSync(path.join(fakeDota, ...d), { recursive: true });
}
const BASE = await freePortBlock(3);
const env = {
  ...process.env,
  DOTA2_VCON_DOTA_PORT: String(BASE),
  DOTA2_VCON_GUI_PORT: String(BASE + 1),
  DOTA2_VCON_CTRL_PORT: String(BASE + 2),
  DOTA2_VCON_STATE_DIR: path.join(work, "daemon-state"),
  DOTA2_TEST_ADDON: addon,
  STEAM_PATH: process.env.STEAM_PATH || path.join(work, "steam"),
};
const { call, notify, kill } = spawnMcpServer({ timeoutMs: 45000, env, cleanupDaemon: true });

// 本测试可能落在真实 Dota 目录（注册表优先）：只清理带随机后缀的 addon 根
let createdRoot = null;
function cleanup() {
  if (createdRoot && path.basename(createdRoot) === addon && existsSync(createdRoot)) {
    rmSync(createdRoot, { recursive: true, force: true });
  }
  rmSync(work, { recursive: true, force: true });
}
process.on("exit", cleanup);

await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "migrate-write", version: "0" } });
notify("notifications/initialized");
await sleep(12000); // createRelay 探测/拉起隔离 daemon

// --- tools/list：10 个工具全部注册、四类 hint 齐全、描述五段式 ---
const expected = {
  file_write: { destructive: true, openWorld: false },
  file_edit: { destructive: true, openWorld: false },
  file_delete: { destructive: true, openWorld: false },
  dota_restart: { destructive: true, openWorld: false },
  dota_launch_game: { destructive: false, openWorld: true },
  dota_open_vconsole: { destructive: false, openWorld: true },
  dota_compile_asset: { destructive: false, openWorld: true },
  dota_screenshot: { destructive: false, openWorld: false, readOnly: true },
  dota_advance_to_game: { destructive: true, openWorld: false },
  dota_disconnect: { destructive: true, openWorld: false },
};
const tools = (await call("tools/list", {})).result.tools;
for (const [name, want] of Object.entries(expected)) {
  const tool = tools.find((t) => t.name === name);
  assert(tool, name + " registered");
  const a = tool.annotations || {};
  assert(a.readOnlyHint === !!want.readOnly, name + " readOnlyHint");
  assert(a.destructiveHint === want.destructive, name + " destructiveHint");
  assert(a.openWorldHint === want.openWorld, name + " openWorldHint");
  assert(typeof a.idempotentHint === "boolean", name + " idempotentHint present");
  assert(tool.description.includes("Use when") && tool.description.includes("Returns")
    && tool.description.includes("Limits:") && tool.description.includes("Related tools:"),
    name + " description covers use/returns/limits/related tools");
}

const tool = async (name, args = {}) => callJson(await call("tools/call", { name, arguments: args }));

// --- 连接类：没有 Dota 时统一 dota_down 失败壳 ---
for (const name of ["dota_launch_game", "dota_restart", "dota_advance_to_game", "dota_disconnect"]) {
  const r = await tool(name);
  assert(r.ok === false && r.code === "dota_down" && typeof r.message === "string" && r.message.length > 0,
    name + " returns {ok:false,code:dota_down,message}: " + JSON.stringify(r).slice(0, 200));
}

// --- FileOps：真实写入临时 addon，成功载荷 path + bytes，失败为 invalid_arg ---
const target = "content/dota_addons/" + addon + "/_migrate_test.txt";
const content = "hello 迁移\nline2\n";
const w = await tool("file_write", { target, addon, content });
assert(w.ok === true && w.data && w.data.path.endsWith(path.join(addon, "_migrate_test.txt"))
  && w.data.bytes === Buffer.byteLength(content, "utf8"), "file_write envelope carries path and UTF-8 byte count: " + JSON.stringify(w).slice(0, 200));
assert(w.text.includes("Wrote") && existsSync(w.data.path), "file_write keeps the human text and writes the file");
createdRoot = path.dirname(w.data.path);

const ed = await tool("file_edit", { target, addon, old_string: "hello", new_string: "HELLO" });
assert(ed.ok === true && ed.data && ed.data.path === w.data.path
  && ed.data.bytes === Buffer.byteLength("HELLO 迁移\nline2\n", "utf8"), "file_edit envelope carries path and new byte count");
assert(ed.text.includes("1 replacement"), "file_edit keeps the replacement summary");

writeFileSync(w.data.path, "x\nx\n");
const amb = await tool("file_edit", { target, addon, old_string: "x", new_string: "y" });
assert(amb.ok === false && amb.code === "invalid_arg" && amb.message.includes("appears 2 times"),
  "ambiguous file_edit is a parseable invalid_arg failure: " + JSON.stringify(amb).slice(0, 200));
assert(!amb.message.includes("MCP error"), "failure message carries no SDK error prefix");
const missing = await tool("file_edit", { target, addon, old_string: "not_here", new_string: "y" });
assert(missing.ok === false && missing.code === "invalid_arg" && missing.message.includes("not found"),
  "missing old_string is a parseable invalid_arg failure");

writeFileSync(w.data.path, "hello fileops\n");
const del = await tool("file_delete", { target, addon });
assert(del.ok === true && del.data && del.data.path === w.data.path && del.data.bytes === 14,
  "file_delete envelope carries path and deleted byte count: " + JSON.stringify(del).slice(0, 200));
assert(del.text.includes("Deleted") && del.text.includes("hello fileops") && !existsSync(w.data.path),
  "file_delete keeps the deleted-content snapshot and removes the file");

const escape = await tool("file_write", { target: "game/dota/materials/x.txt", addon, content: "x" });
assert(escape.ok === false && escape.code === "invalid_arg" && escape.message.includes("outside addon"),
  "path escape is a parseable invalid_arg failure");
const badAddon = await tool("file_write", { target: "x.txt", addon: "../evil", content: "x" });
assert(badAddon.ok === false && badAddon.code === "invalid_arg" && badAddon.message.includes("Invalid addon name"),
  "invalid addon name is a parseable invalid_arg failure");

kill();
cleanup();
console.log("PASS");
process.exit(0);

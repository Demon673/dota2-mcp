// 离线 FileOps 冒烟：file_read/write/edit/delete + 路径边界（不依赖 Dota 进程）
// STEAM_PATH 指向临时最小 Steam 库，读写与本机安装的 Dota 隔离。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnMcpServer, assert, sleep } from "./lib-mcp.mjs";
import { freePortBlock } from "./lib-test-ports.mjs";

const BASE = await freePortBlock(3);
const addonName = "my_addon";
const fakeSteam = mkdtempSync(path.join(tmpdir(), "fileops-steam-"));
const fakeDota = path.join(fakeSteam, "steamapps", "common", "dota 2 beta");
for (const d of [["game", "dota"], ["game", "dota_addons", addonName], ["content", "dota_addons", "other_addon"]]) {
  mkdirSync(path.join(fakeDota, ...d), { recursive: true });
}
const env = {
  ...process.env,
  DOTA2_VCON_DOTA_PORT: String(BASE),
  DOTA2_VCON_GUI_PORT: String(BASE + 1),
  DOTA2_VCON_CTRL_PORT: String(BASE + 2),
  DOTA2_TEST_ADDON: addonName,
  DOTA2_VCON_STATE_DIR: path.join(fakeSteam, "daemon-state"),
  STEAM_PATH: fakeSteam,
};
const { call, notify, kill } = spawnMcpServer({ timeoutMs: 45000, env, cleanupDaemon: true });
function callText(result) {
  if (result.error) throw new Error("tool error: " + JSON.stringify(result.error).slice(0, 400));
  return result.result.content.map((c) => c.text).join("");
}
function expectError(result, needle) {
  const isErr = !!(result.result && result.result.isError);
  assert(isErr, "expected error for: " + needle);
  const text = JSON.stringify(result.result);
  assert(text.includes(needle), "error mentions " + needle + " (got " + text.slice(0, 200) + ")");
  console.log("ok - rejected with guidance: " + needle);
}

const ADDON = env.DOTA2_TEST_ADDON;
const TEST_TARGET = "game/dota_addons/" + ADDON + "/_fileops_test.txt";
const sentinel = path.join(fakeDota, "game", "dota_addons", ADDON, "sentinel.txt");
writeFileSync(sentinel, "isolated fixture");

await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fileops", version: "0" } });
notify("notifications/initialized");
await sleep(12000);

const isolated = await call("tools/call", { name: "file_read", arguments: { target: "game/dota_addons/" + ADDON + "/sentinel.txt", addon: ADDON } });
assert(JSON.parse(callText(isolated)).data?.text === "isolated fixture", "STEAM_PATH selects the isolated install even when Steam is installed");
const inferred = await call("tools/call", { name: "file_read", arguments: { target: "game/dota_addons/" + ADDON + "/sentinel.txt" } });
assert(JSON.parse(callText(inferred)).data?.text === "isolated fixture", "explicit test addon takes precedence over filesystem inference");
const unicode = "界🌟".repeat(50000);
writeFileSync(sentinel, unicode);
const wide = await call("tools/call", { name: "file_read", arguments: { target: "game/dota_addons/" + ADDON + "/sentinel.txt", addon: ADDON } });
assert(JSON.parse(callText(wide)).data.text === unicode, "MCP stdio preserves multibyte text across chunks");

const tools = await call("tools/list", {});
const names = tools.result.tools.map((t) => t.name);
for (const n of ["file_read", "file_write", "file_edit", "file_delete"]) {
  assert(names.includes(n), n + " registered");
}

const w = await call("tools/call", { name: "file_write", arguments: { target: TEST_TARGET, addon: ADDON, content: "hello fileops\nline2\n" } });
assert(callText(w).includes("Wrote"), "file_write works");
const rd = await call("tools/call", { name: "file_read", arguments: { target: TEST_TARGET, addon: ADDON } });
assert(JSON.parse(callText(rd)).data.text === "hello fileops\nline2\n", "file_read returns written content");
const ed = await call("tools/call", { name: "file_edit", arguments: { target: TEST_TARGET, addon: ADDON, old_string: "hello", new_string: "HELLO" } });
assert(callText(ed).includes("1 replacement"), "file_edit replaces unique match");
const rd2 = await call("tools/call", { name: "file_read", arguments: { target: TEST_TARGET, addon: ADDON } });
assert(JSON.parse(callText(rd2)).data.text === "HELLO fileops\nline2\n", "file_edit content correct");
// 替换文本里的 $' $& 必须原样写入（String.replace 字符串参数会展开它们）
const edDollar = await call("tools/call", { name: "file_edit", arguments: { target: TEST_TARGET, addon: ADDON, old_string: "line2", new_string: "t = '$' + g; $&" } });
assert(callText(edDollar).includes("1 replacement"), "file_edit with $ sequences");
const rdDollar = await call("tools/call", { name: "file_read", arguments: { target: TEST_TARGET, addon: ADDON } });
assert(JSON.parse(callText(rdDollar)).data.text === "HELLO fileops\nt = '$' + g; $&\n", "file_edit keeps $' and $& literal");
const edDup = await call("tools/call", { name: "file_edit", arguments: { target: TEST_TARGET, addon: ADDON, old_string: "\n", new_string: "" } });
expectError(edDup, "appears");
const del = await call("tools/call", { name: "file_delete", arguments: { target: TEST_TARGET, addon: ADDON } });
const delText = callText(del);
assert(delText.includes("Deleted") && delText.includes("HELLO fileops"), "file_delete removes and snapshots");
const rd3 = await call("tools/call", { name: "file_read", arguments: { target: TEST_TARGET, addon: ADDON } });
assert(rd3.result && rd3.result.isError, "file_read after delete errors");
const oob1 = await call("tools/call", { name: "file_write", arguments: { target: "game/dota_addons/not_an_addon/x.txt", addon: ADDON, content: "x" } });
expectError(oob1, "outside addon");
const oob2 = await call("tools/call", { name: "file_write", arguments: { target: "content/dota_addons/" + ADDON + "/../../escape.txt", addon: ADDON, content: "x" } });
expectError(oob2, "outside addon");
const oob3 = await call("tools/call", { name: "file_write", arguments: { target: "game/dota/materials/x.txt", addon: ADDON, content: "x" } });
expectError(oob3, "outside addon");
// addon 参与拼接边界本身：.. 或分隔符会让允许的根逃逸到 addon 之外
for (const bad of ["..", "../..", ADDON + "/../.."]) {
  const r = await call("tools/call", { name: "file_write", arguments: { target: "escape.txt", addon: bad, content: "x" } });
  expectError(r, "Invalid addon name");
}

const outside = path.join(fakeSteam, "outside");
mkdirSync(outside);
const protectedFile = path.join(outside, "protected.txt");
writeFileSync(protectedFile, "keep me");
const link = path.join(fakeDota, "game", "dota_addons", ADDON, "escape");
symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
try {
  for (const name of ["file_read", "file_write", "file_edit", "file_delete"]) {
    const r = await call("tools/call", { name, arguments: { target: "game/dota_addons/" + ADDON + "/escape/protected.txt", addon: ADDON, content: "overwritten", old_string: "keep", new_string: "lost" } });
    expectError(r, "outside addon");
  }
  const create = await call("tools/call", { name: "file_write", arguments: { target: "game/dota_addons/" + ADDON + "/escape/new/nested.txt", addon: ADDON, content: "escape" } });
  expectError(create, "outside addon");
  assert(readFileSync(protectedFile, "utf8") === "keep me", "linked external files remain unchanged");
} finally {
  unlinkSync(link);
}

const linkedRoot = path.join(fakeDota, "content", "dota_addons", ADDON);
symlinkSync(outside, linkedRoot, process.platform === "win32" ? "junction" : "dir");
try {
  const r = await call("tools/call", { name: "file_write", arguments: { target: "allowed.txt", addon: ADDON, content: "linked addon" } });
  assert(!r.result.isError && readFileSync(path.join(outside, "allowed.txt"), "utf8") === "linked addon", "an addon root may itself be a link");
} finally { unlinkSync(linkedRoot); }

kill();
await sleep(300);
rmSync(fakeSteam, { recursive: true, force: true });
console.log("PASS");
process.exit(0);

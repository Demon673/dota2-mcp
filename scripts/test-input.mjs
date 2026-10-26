// Offline contract test for dota_input. A fake helper replaces only the OS input
// boundary; the real argument builder, subprocess invocation and error mapping run.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "dota2-mcp-input-test-"));
const helper = path.join(dir, "fake-input-helper.mjs");
writeFileSync(helper, `
const args = process.argv.slice(2);
if (process.env.FAKE_INPUT_FAIL) {
  console.log(JSON.stringify({ ok: false, error: process.env.FAKE_INPUT_FAIL, message: "fake failure" }));
  process.exit(0);
}
const window = { title: "Dota 2", client: { x: 0, y: 0, width: 1920, height: 1080 } };
if (args[0] === "--window-info") {
  console.log(JSON.stringify({ ok: true, window }));
} else {
  console.log(JSON.stringify({ ok: true, action: args[1] || "", args, client: window.client }));
}
`);

process.env.DOTA2_INPUT_HELPER = helper;
const { runInput } = await import("../dist/tools/input.js");
function check(cond, msg) { if (!cond) { console.error("FAIL:", msg); process.exit(1); } console.log("ok -", msg); }

try {
  const info = await runInput({ action: "window_info" });
  check(info.ok && info.data?.window?.title === "Dota 2" && info.data.window.client.width === 1920, "window_info passes the helper reply through");

  const click = await runInput({ action: "click", x: 100, y: 200 });
  check(click.ok && click.data?.args?.join(" ") === "--keep-focus --mouse click left 100 200 1", "click builds the expected helper arguments: " + JSON.stringify(click.data?.args));

  const drag = await runInput({ action: "drag", x: 1, y: 2, x2: 3, y2: 4, steps: 5, step_ms: 7 });
  check(drag.ok && drag.data?.args?.join(" ") === "--keep-focus --mouse drag left 1 2 3 4 5 7", "drag builds its interpolation arguments: " + JSON.stringify(drag.data?.args));

  const key = await runInput({ action: "key_press", key: "ctrl+shift+w", hold_ms: 40 });
  check(key.ok && key.data?.args?.join(" ") === "--keep-focus --key press ctrl+shift+w 40", "key combo arguments are preserved: " + JSON.stringify(key.data?.args));

  const text = await runInput({ action: "text", text: "hello 世界" });
  const decoded = Buffer.from(String(text.data?.args?.[text.data.args.length - 1] || ""), "base64").toString("utf8");
  check(text.ok && decoded === "hello 世界", "text is base64-encoded as UTF-8: " + JSON.stringify(text.data?.args));

  const missing = await runInput({ action: "click", y: 1 });
  check(!missing.ok && missing.code === "invalid_arg", "missing click coordinates fail before the helper: " + JSON.stringify(missing));

  const bad = await runInput({ action: "move", x: 1, y: 2 });
  check(bad.ok, "move uses the helper: " + JSON.stringify(bad));

  process.env.FAKE_INPUT_FAIL = "no_window";
  const failed = await runInput({ action: "window_info" });
  check(!failed.ok && failed.code === "no_window" && failed.message === "fake failure", "helper error codes map to the tool contract: " + JSON.stringify(failed));
  process.env.FAKE_INPUT_FAIL = "minimized";
  const minimized = await runInput({ action: "window_info" });
  check(!minimized.ok && minimized.code === "window_minimized", "a minimized window has its own error code: " + JSON.stringify(minimized));
} finally {
  delete process.env.DOTA2_INPUT_HELPER;
  delete process.env.FAKE_INPUT_FAIL;
  rmSync(dir, { recursive: true, force: true });
}
console.log("PASS");

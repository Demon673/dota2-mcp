#!/usr/bin/env node
/**
 * Relay 守护进程入口 — 独立运行，不依赖 MCP stdio。
 *
 * 由 MCP 瘦客户端以 detached 方式 spawn，或手动 `node dist/relay-main.js` 启动。
 * 监听 :29001（GUI）和 :29002（控制），独占 Dota 2 :29000。
 * 无客户端连接时空闲 5 分钟自动退出。
 */

import { VConRelay } from "./tools/vcon-relay.js";
import { detectDotaPath } from "./tools/console-bridge.js";
import { ensureToken } from "./daemon-utils.js";

console.log = (...args: any[]) => console.error(...args);
console.info = (...args: any[]) => console.error(...args);

process.on("uncaughtException", (err) => {
  console.error("[relay-daemon] uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[relay-daemon] unhandledRejection:", reason);
});

async function main(): Promise<void> {
  const dotaPath = await detectDotaPath();
  const token = ensureToken();
  const relay = new VConRelay();
  relay.setDotaPath(dotaPath);
  relay.setExpectedToken(token);
  relay.enableIdleExit();
  await relay.start();
  console.error("[relay-daemon] ready");
}

main().catch((err) => {
  console.error("[relay-daemon] Fatal:", err);
  process.exit(1);
});

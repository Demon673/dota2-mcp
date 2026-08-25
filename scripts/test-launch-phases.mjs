// test-launch-phases.mjs — 端到端：launch 相位轮询 + stuck 指引 + dota_run_lua 推进 + 活体名字验证
// 需要：Dota 2 运行（-addon <addon> -tools）+ daemon 已拉起 + vconsole 已接入（契约）
// 地图从 daemon 握手信息推断（可用 DOTA2_TEST_MAP 覆盖；推断不出来时报错提示指定）
import { helloOk } from "./lib-ctrl.mjs";
import { spawnMcpServer, sleep } from "./lib-mcp.mjs";

const hello = await helloOk();
const MAP = process.env.DOTA2_TEST_MAP || hello.maps?.[0] || hello.allMaps?.[0];
if (!MAP) { console.error("FAIL: 无法推断测试地图。请设 DOTA2_TEST_MAP，或先用目标 addon 启动 Dota 2"); process.exit(1); }

const { call, notify, kill } = spawnMcpServer({ timeoutMs: 30000 });
const tool = (name, args, t) => call("tools/call", { name, arguments: args }, t);
await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "phase-test", version: "0" } });
notify("notifications/initialized");
await sleep(8000);

console.log(`=== 1. dota_launch_game ${MAP}（等待相位结果，最长 ~150s）===`);
const launch = await tool("dota_launch_game", { map: MAP, timeout: 120 }, 150000);
const launchText = launch.result.content[0].text;
console.log(launchText);

if (launchText.includes("stuck in")) {
  console.log("\n=== 2. 按指引推进：dota_run_lua GameRules:FinishCustomGameSetup() ===");
  const adv = await tool("dota_run_lua", { code: "GameRules:FinishCustomGameSetup()" }, 30000);
  console.log(adv.result.content[0].text);
  await sleep(5000);
  console.log("\n=== 3. dota_status 确认相位变化 ===");
  const st = await tool("dota_status", {}, 30000);
  console.log(st.result.content[0].text);
}

kill();
console.log("DONE");
process.exit(0);

# vconsole 生命周期契约 + 游戏相位指引 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec（`docs/superpowers/specs/2026-07-22-vconsole-lifecycle-and-phase-guidance-design.md`）修复 relay 连接生命周期、落地 vconsole 显式契约、合并 dota_status/project_info、给 dota_launch_game 加相位推进指引，并全仓文档同步。

**Architecture:** relay（daemon/内嵌共用 `VConRelay`）常持 29000；新增初始化帧重放、活性探测、空闲守卫；MCP 层（index.ts）加 `requireConsole()` 两段检查契约 + `dota_open_vconsole`；launch 轮询到 GAME_IN_PROGRESS，卡相位返回 `PHASE_GUIDANCE` 指引。

**Tech Stack:** TypeScript (Node >= 18, ESM, `.js` 后缀导入)、无测试框架（plain node assert 冒烟脚本）、`npm run build` 编译、`npm run check` 校验。

## Global Constraints

- 不加任何新 npm 依赖；只用 node 内置模块。
- 导入一律 ESM `.js` 后缀（如 `./console-bridge.js`）。
- 不 bump 版本号；每个任务结束 `npm run check` 必须通过。
- 工具输出文本用英文（与现有工具一致）；报错/契约文案可用中文（现有 notConnectedText 即中文）。
- 公共信息改动优先 AGENTS.md，README.md 只写用户可见信息、不写实现细节。
- 编辑 `.ts` 源文件，不手改 `dist/`。
- 每个任务一次 commit，message 用 repo 现有风格（`feat:` / `docs:` / `test:` 前缀，中文描述）。

---

### Task 1: relay 初始化帧重放 + 离线测试脚本

**Files:**
- Modify: `src/tools/vcon-relay.ts`
- Create: `scripts/test-relay.mjs`
- Test: `node scripts/test-relay.mjs`（离线，fake VCon server，随机端口）

**Interfaces:**
- Consumes: 现有 `VConClient` 的 `rawFrame(type, rawData)` 事件（`src/tools/vcon-bridge.ts`，除被 rawPrntEditor 丢弃的 PRNT 外所有帧都触发）。
- Produces: relay 私有字段 `_initFrames: Buffer[]`；常量 `INIT_FRAME_TYPES`。Task 2 在同文件继续工作。

- [ ] **Step 1: 写失败的测试**

创建 `scripts/test-relay.mjs`（本任务只含重放场景，Task 2 扩展）：

```js
// scripts/test-relay.mjs — VConRelay 离线冒烟（不需要 Dota 2）
// 用法: node scripts/test-relay.mjs
import net from "node:net";

const BASE = 20000 + Math.floor(Math.random() * 20000);
process.env.DOTA2_VCON_DOTA_PORT = String(BASE);
process.env.DOTA2_VCON_GUI_PORT = String(BASE + 1);
process.env.DOTA2_VCON_CTRL_PORT = String(BASE + 2);

const { VConRelay } = await import("../dist/tools/vcon-relay.js");

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("ok -", msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (cond()) return;
    await sleep(50);
  }
  console.error("FAIL: timeout waiting for", what);
  process.exit(1);
}

function frame(type, payloadLen = 44) {
  const head = Buffer.alloc(12);
  head.write(type, 0, 4, "ascii");
  head.writeUInt16BE(212, 4);
  head.writeUInt32BE(12 + payloadLen, 6);
  head.writeUInt16BE(0, 10);
  return Buffer.concat([head, Buffer.alloc(payloadLen)]);
}

// fake Dota: 每个连接到来立刻发完整初始化序列
const INIT = ["AINF", "CHAN", "CVRB", "CFGV", "ADON"];
const server = net.createServer((sock) => {
  for (const t of INIT) sock.write(frame(t));
});
await new Promise((r) => server.listen(BASE, "127.0.0.1", r));

const relay = new VConRelay();
await relay.start();
await sleep(500); // 等 relay 连上 fake Dota 并吃完初始化帧

// 晚到的 GUI：连上 relay 的 GUI 口，应收到完整重放
const gui = net.connect(BASE + 1, "127.0.0.1");
let buf = Buffer.alloc(0);
gui.on("data", (d) => { buf = Buffer.concat([buf, d]); });
await sleep(800);

const got = [];
while (buf.length >= 12) {
  const len = buf.readUInt32BE(6);
  if (len < 12 || buf.length < len) break;
  got.push(buf.toString("ascii", 0, 4));
  buf = buf.subarray(len);
}
assert(JSON.stringify(got) === JSON.stringify(INIT), `late GUI received init replay in order: ${got.join(",")}`);

relay.close();
server.close();
console.log("PASS");
process.exit(0);
```

- [ ] **Step 2: 确认测试失败**

Run: `npm run build && node scripts/test-relay.mjs`
Expected: FAIL — `timeout waiting for` 不存在所以更可能是断言失败：`late GUI received init replay in order: `（空，因为现状不重放）。

- [ ] **Step 3: 实现重放**

`src/tools/vcon-relay.ts`：

(a) 模块级常量（放在 `const PROTOCOL_VERSION = 1;` 之后）：

```ts
/** 连接建立时 Dota 推送的初始化帧类型，按到达顺序缓存，重放给晚接入的 GUI */
const INIT_FRAME_TYPES = new Set(["AINF", "CHAN", "CVRB", "CFGV", "ADON"]);
```

(b) 类字段（放在 `private _channels = ...` 附近）：

```ts
/** 当前 Dota 连接的初始化帧缓存（每次新连接重建），重放给晚接入的 GUI */
private _initFrames: Buffer[] = [];
```

(c) `connected` 处理器（现有 `this.dotaClient.on("connected", () => {` 块）开头加一行：

```ts
this._initFrames = [];
```

(d) `rawFrame` 处理器，从：

```ts
this.dotaClient.on("rawFrame", (_type: string, rawData: Buffer) => {
  if (this.guiSocket && !this.guiSocket.destroyed) {
    this.guiSocket.write(rawData);
  }
});
```

改为：

```ts
this.dotaClient.on("rawFrame", (type: string, rawData: Buffer) => {
  if (INIT_FRAME_TYPES.has(type)) this._initFrames.push(rawData);
  if (this.guiSocket && !this.guiSocket.destroyed) {
    this.guiSocket.write(rawData);
  }
});
```

(e) `_onGuiConnect` 在 `console.error("[relay] vconsole2 connected");` 之后加重放：

```ts
// 晚接入的 GUI：先重放初始化帧（AINF/CHAN/CVRB/CFGV/ADON），否则拿不到
// 通道表/cvar/addon 信息，窗口是空壳（已实测验证）
for (const f of this._initFrames) sock.write(f);
if (this._initFrames.length > 0) {
  console.error(`[relay] replayed ${this._initFrames.length} init frames to vconsole2`);
}
```

- [ ] **Step 4: 测试通过**

Run: `npm run build && node scripts/test-relay.mjs`
Expected: `ok - late GUI received init replay in order: AINF,CHAN,CVRB,CFGV,ADON` + `PASS`

- [ ] **Step 5: check + commit**

Run: `npm run check`
Expected: tsc 无错误，版本一致。

```bash
git add src/tools/vcon-relay.ts scripts/test-relay.mjs
git commit -m "feat: relay 给晚接入的 vconsole GUI 重放初始化帧（AINF/CHAN/CVRB/CFGV/ADON）

实测根因：relay 已持有 29000 后接入的 vconsole 拿不到初始化序列，窗口空壳。
scripts/test-relay.mjs 离线覆盖（fake VCon server + 随机端口）。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2: 引擎活性探测 + AINF 僵尸超时 + 探针行过滤

**Files:**
- Modify: `src/tools/vcon-relay.ts`
- Modify: `scripts/test-relay.mjs`（整体替换为全场景版）
- Test: `node scripts/test-relay.mjs`

**Interfaces:**
- Consumes: Task 1 的 `_initFrames`；`VConClient.close()`（destroy 后 `close` 事件必触发，驱动现有重连）。
- Produces: `VConRelay` 构造函数 `constructor(liveness?: Partial<LivenessOpts>)`——后续任务与测试注入小超时；`PROBE_TEXT = "__mcp_ping__"`。

- [ ] **Step 1: 扩展测试（先确认新场景失败）**

整体替换 `scripts/test-relay.mjs`：

```js
// scripts/test-relay.mjs — VConRelay 离线冒烟（不需要 Dota 2）
// 场景: 1) 僵尸(收不到AINF)判死重连 2) 初始化帧重放 3) echo 探针 pong 存活+过滤 4) 无 pong 判死
import net from "node:net";

const BASE = 20000 + Math.floor(Math.random() * 20000);
process.env.DOTA2_VCON_DOTA_PORT = String(BASE);
process.env.DOTA2_VCON_GUI_PORT = String(BASE + 1);
process.env.DOTA2_VCON_CTRL_PORT = String(BASE + 2);

const { VConRelay } = await import("../dist/tools/vcon-relay.js");

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("ok -", msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (cond()) return;
    await sleep(50);
  }
  console.error("FAIL: timeout waiting for", what);
  process.exit(1);
}

function frame(type, payloadLen = 44) {
  const head = Buffer.alloc(12);
  head.write(type, 0, 4, "ascii");
  head.writeUInt16BE(212, 4);
  head.writeUInt32BE(12 + payloadLen, 6);
  head.writeUInt16BE(0, 10);
  return Buffer.concat([head, Buffer.alloc(payloadLen)]);
}
function prntFrame(text) {
  const body = Buffer.concat([Buffer.alloc(28), Buffer.from(text, "ascii"), Buffer.from([0])]);
  const head = Buffer.alloc(12);
  head.write("PRNT", 0, 4, "ascii");
  head.writeUInt16BE(212, 4);
  head.writeUInt32BE(12 + body.length, 6);
  head.writeUInt16BE(0, 10);
  return Buffer.concat([head, body]);
}

const INIT = ["AINF", "CHAN", "CVRB", "CFGV", "ADON"];
let phase = "zombie";        // zombie: 连接后一言不发 | init: 连接后发初始化序列
let replyToProbe = false;    // 是否回应 echo 探针
let connections = 0;
let gotProbe = false;
const server = net.createServer((sock) => {
  connections++;
  if (phase === "init") for (const t of INIT) sock.write(frame(t));
  sock.on("data", (d) => {
    if (d.includes("__mcp_ping__")) {
      gotProbe = true;
      if (replyToProbe) sock.write(prntFrame("__mcp_ping__"));
    }
  });
});
await new Promise((r) => server.listen(BASE, "127.0.0.1", r));

const relay = new VConRelay({ probeIntervalMs: 200, silenceMs: 300, pongTimeoutMs: 600, ainfTimeoutMs: 400 });
await relay.start();

// 场景 1：僵尸连接（accept 但无 AINF）→ 判死并重连
await waitFor(() => connections >= 2, 8000, "zombie kill + reconnect");
assert(true, "zombie connection killed and reconnected");

// 场景 2：下个连接发初始化帧 → 晚到 GUI 收到重放
phase = "init";
await waitFor(() => connections >= 3, 8000, "connect #3 with init frames");
await sleep(300);
const gui = net.connect(BASE + 1, "127.0.0.1");
let buf = Buffer.alloc(0);
gui.on("data", (d) => { buf = Buffer.concat([buf, d]); });
await sleep(800);
const got = [];
while (buf.length >= 12) {
  const len = buf.readUInt32BE(6);
  if (len < 12 || buf.length < len) break;
  got.push(buf.toString("ascii", 0, 4));
  buf = buf.subarray(len);
}
assert(JSON.stringify(got) === JSON.stringify(INIT), `late GUI received init replay in order: ${got.join(",")}`);

// 场景 3：静默 → relay 发探针；回复 pong → 判活，且 ping 行不转发给 GUI
replyToProbe = true;
await waitFor(() => gotProbe, 5000, "probe sent after silence");
await sleep(1500);
assert(connections === 3, "pong keeps connection alive (no kill)");
assert(!buf.includes("__mcp_ping__"), "probe echo filtered from GUI");

// 场景 4：不再回应探针 → pong 超时判死重连
replyToProbe = false;
await waitFor(() => connections >= 4, 8000, "probe timeout kill + reconnect");
assert(true, "no pong -> killed and reconnected");

relay.close();
server.close();
console.log("PASS");
process.exit(0);
```

Run: `npm run build && node scripts/test-relay.mjs`
Expected: FAIL at 场景 1（现状对装死连接永不判死，`timeout waiting for zombie kill + reconnect`）。

- [ ] **Step 2: 实现活性探测**

`src/tools/vcon-relay.ts`：

(a) 模块级常量（放在 `INIT_FRAME_TYPES` 后）：

```ts
/** 活性探针文本：静默超时后 relay 发 `echo __mcp_ping__`，回显行对 MCP/GUI 双向过滤 */
const PROBE_TEXT = "__mcp_ping__";

export interface LivenessOpts {
  probeIntervalMs: number;
  silenceMs: number;
  pongTimeoutMs: number;
  ainfTimeoutMs: number;
}
```

(b) 类字段与构造函数（放在类字段区）：

```ts
private _lastDataAt = 0;
private _probeOutstandingAt: number | null = null;
private _ainfTimer: NodeJS.Timeout | null = null;
private _livenessInterval: NodeJS.Timeout | null = null;
private liveness: LivenessOpts;

constructor(liveness: Partial<LivenessOpts> = {}) {
  super();
  this.liveness = {
    probeIntervalMs: 10_000,
    silenceMs: 15_000,
    pongTimeoutMs: 20_000,
    ainfTimeoutMs: 10_000,
    ...liveness,
  };
}
```

(c) `_connectDota` 的 `connected` 处理器（现有块）开头加：

```ts
this._lastDataAt = Date.now();
this._probeOutstandingAt = null;
// 僵尸识别：正常 Dota 一连上就发 AINF；只 accept 不说话的是残留进程
this._ainfTimer = setTimeout(() => {
  console.error("[relay] no AINF after connect (zombie engine?), reconnecting...");
  this.dotaClient?.close();
}, this.liveness.ainfTimeoutMs);
```

(d) `rawFrame` 处理器开头加一行（在 `if (INIT_FRAME_TYPES...)` 之前）：

```ts
this._lastDataAt = Date.now();
```

(e) `prnt` 处理器开头（`const text = msg.text.trim();` 之前）加：

```ts
this._lastDataAt = Date.now();
```

并在 `const text = msg.text.trim();` 之后加：

```ts
// 活性探针回显：不进缓冲、不广播（rawPrntEditor 侧同时拦 GUI）
if (text === PROBE_TEXT) return;
```

(f) `_connectDota` 的 `rawPrntEditor` 开头（`const text = msg.text.trim();` 之后）加：

```ts
if (text === PROBE_TEXT) return false; // 探针回显不转发 GUI
```

(g) `ainf` 处理器开头加：

```ts
if (this._ainfTimer) { clearTimeout(this._ainfTimer); this._ainfTimer = null; }
```

(h) `close`（dotaClient 的 close）处理器开头加：

```ts
this._probeOutstandingAt = null;
if (this._ainfTimer) { clearTimeout(this._ainfTimer); this._ainfTimer = null; }
```

(i) `start()` 末尾（`this._connectDota();` 之后）加：

```ts
this._livenessInterval = setInterval(() => this._livenessTick(), this.liveness.probeIntervalMs);
```

(j) `close()` 里（`this._closed = true;` 之后）加：

```ts
if (this._livenessInterval) clearInterval(this._livenessInterval);
if (this._ainfTimer) clearTimeout(this._ainfTimer);
```

(k) 新增方法（放在 `_connectDota` 之后）：

```ts
/** 活性探测：静默超时发 echo 探针；探针后仍无数据 → 判死掐断走重连 */
private _livenessTick(): void {
  if (!this._dotaConnected || !this.dotaClient) {
    this._probeOutstandingAt = null;
    return;
  }
  const now = Date.now();
  if (this._probeOutstandingAt !== null) {
    if (this._lastDataAt > this._probeOutstandingAt) {
      this._probeOutstandingAt = null; // pong 到了
      return;
    }
    if (now - this._probeOutstandingAt > this.liveness.pongTimeoutMs) {
      console.error("[relay] Dota 2 unresponsive (probe timeout), reconnecting...");
      this._probeOutstandingAt = null;
      this.dotaClient.close(); // destroy → close 事件 → 现有重连路径
    }
    return;
  }
  if (now - this._lastDataAt > this.liveness.silenceMs) {
    try { this.dotaClient.sendCommand(`echo ${PROBE_TEXT}`); } catch { /* 断开竞态，下个 tick 处理 */ }
    this._probeOutstandingAt = now;
  }
}
```

注意：探针走 `dotaClient.sendCommand` 直连，不经 `VConRelay.sendCommand` 的 ai_disabled 包装。

- [ ] **Step 3: 测试通过 + check**

Run: `npm run build && node scripts/test-relay.mjs && npm run check`
Expected: 4 个 `ok -` + `PASS`；tsc 无错误。

- [ ] **Step 4: commit**

```bash
git add src/tools/vcon-relay.ts scripts/test-relay.mjs
git commit -m "feat: relay 引擎活性探测（echo 探针 + AINF 僵尸超时判死）

真实崩溃/挂起时 socket 不发 FIN，relay 永不察觉。现静默 15s 发 echo
探针、20s 无响应判死重连；新连接 10s 无 AINF 判死（僵尸只 accept 不说话）。
探针行对 MCP/GUI 双向过滤。超时可注入，scripts/test-relay.mjs 四场景覆盖。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3: 重连调度去重 + 空闲退出守卫

**Files:**
- Modify: `src/tools/vcon-relay.ts`
- Modify: `src/tools/console-bridge.ts`
- Test: `node scripts/test-relay.mjs` + `node scripts/test-daemon.mjs`（回归）

**Interfaces:**
- Consumes: Task 2 的计时器字段。
- Produces: `console-bridge.ts` 新增导出 `isDotaProcessRunning(): boolean`（仅此任务使用）。

- [ ] **Step 1: `isDotaProcessRunning()`**

`src/tools/console-bridge.ts`：确认顶部有无 `import { execSync } from "child_process";`，没有则加上。文件末尾追加：

```ts
/** Dota 2 进程是否在跑（用于守护进程空闲退出守卫：Dota 在跑 = 用户在开发，不退）。
 *  win32 用 tasklist（恒退出码 0，解析输出）；其他平台 pgrep（无匹配时非零退出）。
 *  无法执行检查时保守返回 true（不退出）。 */
export function isDotaProcessRunning(): boolean {
  try {
    if (process.platform === "win32") {
      const out = execSync('tasklist /FI "IMAGENAME eq dota2.exe" /NH', { encoding: "utf-8" });
      return out.includes("dota2.exe");
    }
    try {
      execSync("pgrep -x dota2", { stdio: ["pipe", "pipe", "pipe"] });
      return true;
    } catch {
      return false; // pgrep 无匹配
    }
  } catch {
    return true; // 检查本身失败：保守视为在跑
  }
}
```

- [ ] **Step 2: 守卫接入 + 重连去重**

`src/tools/vcon-relay.ts`：

(a) 导入（加到现有 `import { pidPath } from "../daemon-utils.js";` 一行后）：

```ts
import { isDotaProcessRunning } from "./console-bridge.js";
```

(b) `_resetIdleTimer` 的退出条件，从：

```ts
if (this.clients.size === 0 && !this._guiConnected) {
```

改为：

```ts
// Dota 在跑 = 用户在开发：29001/29002 是 vconsole 的生命线，daemon 不退
if (this.clients.size === 0 && !this._guiConnected && !isDotaProcessRunning()) {
```

(c) 类字段加：

```ts
private _reconnectTimer: NodeJS.Timeout | null = null;
```

(d) 新增方法（放在 `_livenessTick` 后）：

```ts
/** 单一重连定时器：error/close/catch 多路触发只排一次（修双行日志/双 timer） */
private _scheduleReconnect(): void {
  if (this._closed || this._reconnectTimer) return;
  this._reconnectTimer = setTimeout(() => {
    this._reconnectTimer = null;
    this._connectDota();
  }, 2000);
}
```

(e) 三处替换：
- dotaClient `close` 处理器里 `setTimeout(() => this._connectDota(), 2000);` → `this._scheduleReconnect();`
- dotaClient `error` 处理器里 `setTimeout(() => this._connectDota(), 2000);` → `this._scheduleReconnect();`
- `this.dotaClient.connect().catch(...)` 里 `setTimeout(() => this._connectDota(), 2000);` → `this._scheduleReconnect();`

(f) `close()` 里（Task 2 加的 clearInterval 后）加：

```ts
if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
```

- [ ] **Step 3: 回归 + check**

Run: `npm run build && node scripts/test-relay.mjs && node scripts/test-daemon.mjs && npm run check`
Expected: 两个脚本 PASS，tsc 无错误。（test-daemon 里守护进程空闲退出用例因本机无 dota2.exe 时行为不变——若本机正开着 Dota，该用例可能受影响，此时跳过看 test-relay 即可，并在 commit message 注明。）

- [ ] **Step 4: commit**

```bash
git add src/tools/vcon-relay.ts src/tools/console-bridge.ts
git commit -m "feat: relay 重连调度去重 + Dota 运行期间禁止守护进程空闲退出

Dota 在跑说明用户在开发，29001/29002 是 vconsole 生命线，不能因
无客户端 5 分钟就退出（实测：退出后 vconsole 无处连接）。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 4: vconsole 显式契约 + dota_open_vconsole + dota_status 合并 project_info

**Files:**
- Modify: `src/index.ts`
- Test: `npm run check` + 手动 smoke（Task 7 统一活体）

**Interfaces:**
- Consumes: `relay.dotaConnected` / `relay.guiConnected`（`VConRelay` 与 `RelayClient` 均有）；`getDotaBinDir`/`getDotaExeName`/`runDotaTool`（index.ts 现有，main 作用域内函数声明，已提升可用）。
- Produces: `requireConsole()`、`vconsoleNotOpenText()`、`dota_open_vconsole` 工具、合并后的 `dota_status`；`project_info` 删除。Task 5 在同文件继续。

- [ ] **Step 1: 契约 helper 与文案**

`src/index.ts` 中 `notConnectedText` 函数整体替换为：

```ts
  /** 统一的未连接提示 */
  function notConnectedText(extra = ""): string {
    if ((relay as VConRelay).portInUse) {
      return `另一个 dota2-mcp 实例已占用端口 29001/29002（多实例冲突）。请关闭其他实例。`;
    }
    return `未连接到 Dota 2（VConsole2 端口 29000）。Dota 2 可能未启动、已崩溃或正在重启；relay 会持续自动重连，稍后重试即可。若刚重启 Dota 2 仍持续出现：旧 dota2.exe 可能没退干净并仍占用 29000——在任务管理器彻底结束所有 dota2.exe 后再启动。${extra}`;
  }

  /** vconsole 未打开的契约提示（控制台类工具需要 vconsole 旁观 agent 活动） */
  function vconsoleNotOpenText(): string {
    const exe = dotaPath ? path.join(getDotaBinDir(dotaPath), getDotaExeName("vconsole2")) : "vconsole2.exe";
    return `vconsole 未打开。控制台类工具要求 vconsole 已打开并连接 127.0.0.1:29001（显式契约：保证你能旁观 agent 的控制台活动）。
请二选一：
1. 直接运行 ${exe}（AssetBrowser 的 vconsole 按钮在 relay 持有 29000 时被引擎禁用，勿用）；
2. 调用 dota_open_vconsole 让我帮你打开。`;
  }

  /** 控制台类工具入口两段检查：Dota 连接 → vconsole 接入 */
  function requireConsole(): void {
    if (!relay.dotaConnected) throw new McpError(ErrorCode.InvalidRequest, notConnectedText());
    if (!relay.guiConnected) throw new McpError(ErrorCode.InvalidRequest, vconsoleNotOpenText());
  }
```

- [ ] **Step 2: 删除 project_info**

删除 `src/index.ts` 中整个 `server.tool("project_info", ...)` 注册块（从注释 `// Tool: 查询当前项目与游戏状态` 到该 tool 闭合 `);`）。

- [ ] **Step 3: 全部 17 处入口检查替换为 requireConsole()**

对以下精确字符串执行 replace_all：

```
      if (!relay.dotaConnected) throw new McpError(ErrorCode.InvalidRequest, notConnectedText());
```

替换为：

```
      requireConsole();
```

（涉及 console_output、console_channels、console_send、dota_launch_game、dota_disconnect、dota_restart、dota_dump_entities、dota_dump_modifiers、dota_entity_inspect、dota_api_lua、dota_api_panorama_js、dota_api_css、dota_api_events、console_find、console_help、dota_api_help、dota_run_lua，共 17 处；`console_gui_filter` 本无检查，保持。）

- [ ] **Step 4: dota_status 合并（永不抛异常 + 全量字段）**

`server.tool("dota_status", ...)` 整体替换为：

```ts
  // Tool: 任务入口 — 测试 / 验证 / 调试 Dota 2 自定义游戏（合并原 project_info，永不抛异常）
  server.tool("dota_status",
    "Check the Dota 2 custom game project's connection, vconsole, addon, available maps, and live game state — and what to do next. Use this FIRST whenever the user asks to test a Dota 2 addon / custom game, check why something doesn't work in-game, run a map, or inspect live game state. Never throws: reports what's missing (Dota or vconsole) and how to fix it.",
    {},
    async () => {
      if (!relay.dotaConnected) {
        return { content: [{ type: "text", text:
`Dota 2 is not connected. Ensure Dota 2 is running (with -vconsole or -tools). The relay reconnects automatically; if you just restarted Dota 2 and this persists, an old dota2.exe may not have fully exited — kill it completely and start again.

Once connected, call dota_status again.` }] };
      }
      if (!relay.guiConnected) {
        return { content: [{ type: "text", text:
`Dota 2 is connected, but vconsole is not open. Console tools require an open vconsole attached to 127.0.0.1:29001 (explicit contract: you can watch the agent's console activity there).

Open it: run vconsole2.exe and connect to 127.0.0.1:29001 — the AssetBrowser vconsole button is disabled by the engine while this MCP holds port 29000 — or call dota_open_vconsole.

Then call dota_status again.` }] };
      }

      // ADON 帧是 Dota 2 主动推送的，连接刚建立时可能还没到。
      if (!currentAddon) {
        for (let i = 0; i < 10 && !currentAddon; i++) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      const addon = resolveAddon();
      const maps = currentMaps.length > 0 ? currentMaps : scanMapsFs(addon);
      const allMaps = currentAllMaps.length > 0 ? currentAllMaps : scanMapsFs(addon);
      const status = await queryStatusJson(5000);
      const state = parseGameState(status);

      let nextStep: string;
      if (state.loading) {
        nextStep = "Map is loading. Wait, then call dota_status again or watch console_output.";
      } else if (!state.loaded) {
        nextStep = `No map running. To test the addon, launch a map: dota_launch_game${maps.length > 0 ? ` (available: ${maps.join(", ")})` : ""}.`;
      } else {
        nextStep = `Map "${state.map}" is running (${state.phase}). To test/debug:
- Check for errors → console_output (level 3, or channel filter 'VScript' for Lua errors)
- Verify specific behavior / reproduce a bug → dota_run_lua
- Inspect entities → dota_dump_entities; modifiers → dota_dump_modifiers
- Reload after editing Lua/KV/Panorama → dota_restart${state.phase !== "playing" ? `
- Stuck in phase "${state.game_state}"? See dota2_skill 'dota2-game-phases' for how to advance.` : ""}`;
      }

      return { content: [{ type: "text", text: JSON.stringify({
        connected: true,
        vconsole: true,
        addon: currentAddon || addon || "(detecting...)",
        maps,
        allMaps,
        running: {
          map: state.map,
          loaded: state.loaded,
          loading: state.loading,
          game_state: state.game_state,
          phase: state.phase,
          players: state.players,
          clients_bot: state.clients_bot,
          clients_proxies: state.clients_proxies,
          first_player: state.first_player,
          hibernating: state.hibernating,
          cpu_usage: state.cpu_usage,
          udp_port: state.udp_port,
          network_lag_avg: state.network_lag_avg,
          build_version: state.build_version,
          process_uptime: state.process_uptime,
        },
        nextStep,
      }, null, 2) }] };
    }
  );
```

- [ ] **Step 5: dota_open_vconsole 工具**

在 `dota_disconnect` 注册块之后插入：

```ts
  // Tool: 打开 vconsole 窗口（AssetBrowser 按钮被引擎禁用时的显式路径）
  server.tool("dota_open_vconsole",
    "Use to open the VConsole2 window for the user when console tools report 'vconsole 未打开'. Launches vconsole2.exe directly (the AssetBrowser vconsole button is disabled by the engine while this MCP holds port 29000) and waits for it to attach to the relay. Console tools require an attached vconsole (explicit contract).",
    {},
    async () => {
      if (!dotaPath) throw new McpError(ErrorCode.InvalidRequest, dotaPathNotDetectedText());
      if (relay.guiConnected) {
        return { content: [{ type: "text", text: "vconsole is already open and attached." }] };
      }
      const exe = path.join(getDotaBinDir(dotaPath), getDotaExeName("vconsole2"));
      if (!fs.existsSync(exe)) {
        throw new McpError(ErrorCode.InvalidRequest, `vconsole2.exe not found at ${exe}`);
      }
      const result = await runDotaTool("vconsole2", [], false);
      if (!result.ok) {
        throw new McpError(ErrorCode.InvalidRequest, `Failed to launch vconsole2: ${result.stderr}`);
      }
      for (let i = 0; i < 20 && !relay.guiConnected; i++) {
        await new Promise(r => setTimeout(r, 500));
      }
      return { content: [{ type: "text", text: relay.guiConnected
        ? "vconsole opened and attached to relay (127.0.0.1:29001)."
        : "vconsole2.exe launched but did not attach to 127.0.0.1:29001 within 10s. Check the vconsole2 connection target is 127.0.0.1:29001 (saved in its settings)."
      }] };
    }
  );
```

- [ ] **Step 6: check + commit**

Run: `npm run check`
Expected: tsc 无错误。

```bash
git add src/index.ts
git commit -m "feat: vconsole 显式契约 + dota_open_vconsole + dota_status 合并 project_info

控制台类工具两段检查：Dota 未连接 → 可操作报错；29001 无 vconsole →
契约报错（含两条打开路径）。dota_status 永不抛异常并吸收 project_info
全部字段；删除 project_info。AssetBrowser 按钮被引擎禁用（已实测），
新增 dota_open_vconsole 作为显式打开路径。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 5: dota_launch_game 相位轮询 + stuck 推进指引

**Files:**
- Modify: `src/index.ts`
- Test: `npm run check`；活体验证命令名（Step 1，需要 Dota 运行）

**Interfaces:**
- Consumes: `requireConsole()`（Task 4）；`queryStatusJson`/`parseGameState`/`prntLog`/`collectOutput`（index.ts 现有）。
- Produces: `PHASE_GUIDANCE: Record<string, string>`、`buildStuckReport()`；Task 6 的 skill 文档内容以本任务验证过的命令名为准。

- [ ] **Step 1: 对活体验证指引命令名**

Dota 运行中、daemon 已拉起（`node dist/relay-main.js` 或任一 MCP 会话）。写一次性脚本验证（用完删除）：

```js
// verify-phase-apis.mjs — 通过 daemon 控制口验证 GameRules 方法名
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const token = fs.readFileSync(path.join(os.tmpdir(), "dota2-mcp", "relay.token"), "utf-8").trim();
const sock = net.connect(29002, "127.0.0.1");
let buf = "";
const lines = [];
sock.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) !== -1) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); } });
sock.on("connect", () => {
  sock.write(`HELLO ${token}\n`);
  setTimeout(() => sock.write("CMD:script_help2 GameRules\n"), 300);
  setTimeout(() => sock.write("TAIL:500\n"), 4000);
  setTimeout(() => {
    const text = lines.join("\n");
    for (const n of ["FinishCustomGameSetup", "SetPreGameTime", "SetHeroSelectionTime", "SetStrategyTime", "SetShowcaseTime"])
      console.log(n, text.includes(n) ? "OK" : "MISSING");
    process.exit(0);
  }, 5500);
});
```

Run: `node verify-phase-apis.mjs`，随后删除该文件。
Expected: 每个名字都是 `OK`。若有 `MISSING`，从输出里找实际方法名（如 `FinishCustomGameSetup` 的准确拼写），**以引擎为准**修正下方 `PHASE_GUIDANCE` 和 Task 6 的 skill 文档。（Dota 不在地图内 `script_help2` 也可用。）

- [ ] **Step 2: PHASE_GUIDANCE 常量**

`src/index.ts` 中（放在 `channelDescriptions` 常量之后）：

```ts
  // 相位卡住时的推进指引（game_state 子串匹配；命令名已对活体验证，见 plan Task 5）
  const PHASE_GUIDANCE: Record<string, string> = {
    CUSTOM_GAME_SETUP: "Addon setup phase — it ends when the addon calls GameRules:FinishCustomGameSetup(). To advance now: dota_run_lua with code `GameRules:FinishCustomGameSetup()`. If it won't advance, the addon's setup logic is erroring → console_output (level 3, channel 'VScript').",
    WAIT_FOR_PLAYERS_TO_LOAD: "Waiting for players/bots to finish loading — usually resolves on its own. If stuck, check console_output for which client never finishes loading.",
    HERO_SELECTION: "Hero selection is controlled by the addon. Advance by assigning heroes via dota_run_lua, or set selection time to 0 in the addon (GameRules:SetHeroSelectionTime).",
    STRATEGY_TIME: "Timed phase, advances automatically. To shorten in addon code: GameRules:SetStrategyTime(0).",
    TEAM_SHOWCASE: "Timed phase, advances automatically. To shorten in addon code: GameRules:SetShowcaseTime(0).",
    WAIT_FOR_MAP_TO_LOAD: "Map still loading — should pass quickly. If stuck: console_output (channel 'ResourceSystem') — the map may not be compiled; run dota_compile_asset on it.",
    PRE_GAME: "Pre-game, advances automatically. To shorten in addon code: GameRules:SetPreGameTime(0).",
    INIT: "Engine initializing — should pass in seconds. If stuck, check console_output for engine/resource errors.",
    POST_GAME: "Game ended. Use dota_restart to run again.",
  };
```

（键顺序即匹配优先级：CUSTOM_GAME_SETUP 必须在任何含 SETUP 的宽泛键之前；当前各键互不包含，安全。）

- [ ] **Step 3: 重写 dota_launch_game**

`server.tool("dota_launch_game", ...)` 整体替换为：

```ts
  // Tool: 启动游戏（轮询到 GAME_IN_PROGRESS；卡相位返回推进指引）
  server.tool("dota_launch_game",
    "Use to start / run / load a Dota 2 custom game map when the user wants to test or play their addon. Launches the map and polls until the game reaches GAME_IN_PROGRESS; if it gets stuck in a phase (e.g. CUSTOM_GAME_SETUP), returns the phase, how to advance it, and recent errors. Call dota_status first to see available maps. Requires an open vconsole (see dota_open_vconsole).",
    {
      map: z.string().optional().describe("Map name. Auto-detected if omitted."),
      addon: z.string().optional().describe("Addon name. Auto-detected if omitted."),
      timeout: z.number().optional().describe("Max seconds to wait for GAME_IN_PROGRESS. Default 90."),
    },
    async ({ addon, map, timeout }) => {
      requireConsole();
      const a = resolveAddon(addon);
      const maps = currentMaps.length > 0 ? currentMaps : scanMapsFs(a);
      const m = map || maps[0];
      if (!a) throw new McpError(ErrorCode.InvalidRequest, "No addon detected. Load a project first or specify addon.");
      if (!m) throw new McpError(ErrorCode.InvalidRequest, `No map specified and none found in addon '${a}'. Available: ${maps.length > 0 ? maps.join(", ") : "none"}`);

      const timeoutMs = Math.max(15, timeout || 90) * 1000;

      /** 卡相位报告：相位原文 + 已卡时长 + 推进指引 + 近期错误 + skill 文档指路 */
      const buildStuckReport = (state: string, stuckMs: number): string => {
        const key = Object.keys(PHASE_GUIDANCE).find(k => state.includes(k));
        const guidance = key ? PHASE_GUIDANCE[key] : "Unrecognized phase. Check console_output for errors.";
        const errors = prntLog
          .filter(l => l.verbosity >= 3 || l.channel === "VScript")
          .slice(-8)
          .map(l => `[${l.channel || "?"}][L${l.verbosity}] ${l.text}`);
        return [
          `Game has been stuck in ${state || "(unknown state)"} for ${Math.round(stuckMs / 1000)}s.`,
          `How to advance: ${guidance}`,
          errors.length > 0 ? `Recent errors:\n${errors.join("\n")}` : "No recent VScript/error output.",
          `Full phase guide: call dota2_skill with name "dota2-game-phases".`,
        ].join("\n");
      };

      // 已进入 GAME_IN_PROGRESS 直接返回；已在加载/已加载则不发命令只观察
      const initial = parseGameState(await queryStatusJson(5000));
      if (initial.game_state.includes("GAME_IN_PROGRESS")) {
        return { content: [{ type: "text", text: `Already in game: ${initial.map} (${initial.game_state})` }] };
      }
      if (!initial.loaded && !initial.loading) {
        relay.sendCommand(`dota_launch_custom_game ${a} ${m}`);
      }

      const startTime = Date.now();
      let lastState = initial.game_state;
      let lastChangeAt = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        if (!relay.dotaConnected) {
          return { content: [{ type: "text", text: `Dota 2 disconnected while launching (crash?). ${notConnectedText()}` }] };
        }
        await new Promise(r => setTimeout(r, 2000));
        const cur = parseGameState(await queryStatusJson(5000));
        if (cur.game_state !== lastState) {
          lastState = cur.game_state;
          lastChangeAt = Date.now();
        }
        if (cur.game_state.includes("GAME_IN_PROGRESS")) {
          return { content: [{ type: "text", text: `Launched and in game: ${a}/${m} (map: ${cur.map}, state: ${cur.game_state})` }] };
        }
        if (lastState && Date.now() - lastChangeAt > 15000) {
          return { content: [{ type: "text", text: buildStuckReport(lastState, Date.now() - lastChangeAt) }] };
        }
      }

      return { content: [{ type: "text", text: buildStuckReport(lastState, timeoutMs) }] };
    }
  );
```

- [ ] **Step 4: check + commit**

Run: `npm run check`
Expected: tsc 无错误。

```bash
git add src/index.ts
git commit -m "feat: dota_launch_game 轮询到 GAME_IN_PROGRESS，卡相位返回推进指引

同一相位 15s 未推进即返回 stuck 报告：相位原文、PHASE_GUIDANCE 指引
（命令名已对活体验证）、近期 VScript/错误行、dota2-game-phases 文档指路。
断线立即返回，timeout 默认 45s→90s。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 6: 工具描述 + 文档 + 注释 + skill 全仓同步

**Files:**
- Modify: `src/index.ts`（头部注释、17 个工具描述加契约后缀）
- Modify: `src/tools/vcon-relay.ts`（头部注释）
- Modify: `AGENTS.md`
- Modify: `README.md`（先读再改，只动用户可见信息）
- Modify: `skills/dota2-runtime-dev/SKILL.md`
- Create: `skills/dota2-game-phases/SKILL.md`

**Interfaces:**
- Consumes: Task 4/5 的最终行为与 Task 5 Step 1 验证过的命令名。
- Produces: 无代码接口；验收靠 grep。

- [ ] **Step 1: 17 个门控工具描述统一加契约后缀**

对以下 17 个工具的 description 末尾各追加一句（逐个 Edit，保持各描述前文不变）：

` Requires an open vconsole (attach to 127.0.0.1:29001; see dota_open_vconsole).`

工具清单：console_output、console_channels、console_send、dota_disconnect、dota_restart、dota_dump_entities、dota_dump_modifiers、dota_entity_inspect、dota_api_lua、dota_api_panorama_js、dota_api_css、dota_api_events、console_find、console_help、dota_api_help、dota_run_lua，以及 dota_launch_game（Task 5 的描述已含此句，跳过——实际 16 处）。

- [ ] **Step 2: 代码注释同步**

(a) `src/index.ts` 头部注释（现为过时的 "Tool layers (to be implemented)" 列表）替换为：

```ts
/**
 * dota2-mcp — MCP server for DOTA2 custom game development.
 *
 * 瘦客户端入口：注册全部 MCP 工具，经 createRelay() 接入 relay 守护进程
 * （失败时退化为本地 VConRelay）。控制台类工具遵守 vconsole 契约：
 * Dota 已连接且 vconsole 已接入 29001 才可用（见 requireConsole）。
 */
```

(b) `src/tools/vcon-relay.ts` 头部注释中 `vconsole2 ──→ :29001 (relay) ──→ :29000 (Dota 2)` 图下方追加：

```ts
 * 晚接入的 GUI 会收到初始化帧重放（AINF/CHAN/CVRB/CFGV/ADON）。
 * 对 Dota 连接有活性探测：静默时 echo 探针，超时判死重连；无 AINF 的僵尸连接 10s 判死。
```

- [ ] **Step 3: AGENTS.md 四处**

(a) 「关键发现」一节，把：

`- **Dota 2 只允许 1 个 VCon 客户端**：Relay 抢占 29000，vconsole2 GUI 通过 relay 的 29001 端口共存`

替换为：

`- **Dota 2 只允许 1 个 VCon 客户端**：Relay 抢占 29000，vconsole2 GUI 通过 relay 的 29001 端口共存。**已实测的副作用**：relay 持有 29000 期间引擎把 relay 当作已连接的 vconsole——AssetBrowser 的 vconsole 按钮/快捷键被禁用（不拉起进程）。打开 vconsole 请直接运行 vconsole2.exe 或调用 dota_open_vconsole`

(b) 「当前已实现的 22 个 MCP 工具」游戏控制表，把：

```
| `project_info` | `status` + 文件扫描 | addon/maps/运行时状态（零硬编码） |
| `dota_status` | `status` | 运行时状态 |
| `dota_launch_game` | `dota_launch_custom_game` | 启动（自动补全 addon） |
| `dota_disconnect` | `disconnect` | 断开 |
| `dota_restart` | `restart` | 重载地图 |
```

替换为：

```
| `dota_status` | `status`/`status_json` + 文件扫描 | 入口/导航：连接、vconsole、addon/maps、实时状态、下一步指引（不抛异常） |
| `dota_launch_game` | `dota_launch_custom_game` | 启动（自动补全 addon）；轮询到 GAME_IN_PROGRESS，卡相位返回推进指引 |
| `dota_disconnect` | `disconnect` | 断开 |
| `dota_restart` | `restart` | 重载地图 |
| `dota_open_vconsole` | spawn vconsole2.exe | 打开 vconsole 窗口（AssetBrowser 按钮被引擎禁用时的显式路径） |
```

(c) 「数据流」一节末尾（"`**注意**：relay 启动后**主动连接**..."` 段之后）追加：

```
**vconsole 契约**：控制台类工具要求 vconsole2 已接入 `:29001`（显式契约，保证使用者能旁观 agent 的控制台活动），否则报明确错误并给出打开路径。relay 给晚接入的 GUI 重放初始化帧（AINF/CHAN/CVRB/CFGV/ADON）；对 Dota 连接做活性探测（静默发 `echo` 探针，超时判死重连）；Dota 进程在跑时守护进程不做空闲退出。
```

(d) 「已知问题 / 注意事项」中把：

`- vconsole2 GUI 需手动配置连接 \`127.0.0.1:29001\`（而不是默认的 \`29000\`），因为 Dota 2 只允许一个 VCon 客户端直连 \`:29000\``

替换为：

`- **vconsole 使用路径**：vconsole2 连接目标固定为 \`127.0.0.1:29001\`（relay 的 GUI 口）。AssetBrowser 的 vconsole 按钮在 relay 持有 29000 时被引擎禁用（已实测），请直接运行 \`game/bin/win64/vconsole2.exe\` 或调用 \`dota_open_vconsole\`；晚接入的窗口会收到初始化帧重放，随开随用`

- [ ] **Step 4: README.md**

先 Read 全文。只同步用户可见信息（遵守仓库约定：README 不写实现细节/内部协议）：
- 工具清单若有 project_info → 删；补 dota_open_vconsole；22 个总数不变。
- vconsole 相关说明统一为：「打开 vconsole：直接运行 `game/bin/win64/vconsole2.exe` 并连接 127.0.0.1:29001（relay 占用 29000 期间 AssetBrowser 的 vconsole 按钮无效）；控制台类工具需要 vconsole 已打开。」

- [ ] **Step 5: skills 两个文件**

(a) `skills/dota2-runtime-dev/SKILL.md` 工具清单段，把：

```
- dota_status — entry point: connection, addon, map state, next step.
- dota_launch_game / dota_restart / dota_disconnect — map control (restart is
  for load-only changes or clean runs, NOT for routine code edits).
```

替换为：

```
- dota_status — entry point: connection, vconsole, addon, map state, next step
  (never throws; if it reports vconsole closed, open it first).
- dota_open_vconsole / dota_launch_game / dota_restart / dota_disconnect —
  window & map control (restart is for load-only changes or clean runs, NOT
  for routine code edits). dota_launch_game waits until GAME_IN_PROGRESS and,
  if the game gets stuck in a phase, tells you how to advance it.
```

并在该清单段末尾追加：

```
CONTRACT: all console-based tools (console_*, dota_api_*, dota_run_lua,
dota_dump_*, dota_launch_game, dota_disconnect, dota_restart) require an open
vconsole attached to 127.0.0.1:29001 — it exists so the human can watch what
you do. If a tool reports "vconsole 未打开": call dota_open_vconsole. Never
tell the user to use the AssetBrowser vconsole button — it is engine-disabled
while the relay holds port 29000.
```

(b) 创建 `skills/dota2-game-phases/SKILL.md`（命令名以 Task 5 Step 1 验证结果为准）：

```markdown
---
name: dota2-game-phases
description: Use when a launched custom game gets stuck in a game-rules phase (INIT, CUSTOM_GAME_SETUP, HERO_SELECTION, PRE_GAME, etc.) after dota_launch_game, or when you need to understand/advance the current game_state. Gives per-phase normal durations and how to advance each.
---

# Dota 2 Game-Rules Phases — what stuck means and how to advance

status_json reports `server.game_state` as `DOTA_GAMERULES_STATE_*`.
dota_launch_game watches it and reports when one phase stops advancing
for 15s. This doc is the full reference for that report.

## SOP when stuck

1. console_output (level 3, channel "VScript") — a stuck phase is most
   often your addon's own Lua erroring. Fix the addon first.
2. Advance the phase per the table below (usually one dota_run_lua call).
3. If it won't advance after that, it IS an addon bug — go back to 1.

## Phase table

| game_state | normal | how to advance when stuck |
|---|---|---|
| INIT | seconds | Engine init; check console_output for engine/resource errors |
| WAIT_FOR_PLAYERS_TO_LOAD | seconds | Usually self-resolves; console_output shows which client never loads |
| CUSTOM_GAME_SETUP | until addon ends it | `dota_run_lua` code: `GameRules:FinishCustomGameSetup()` — if it re-sticks, addon setup code is erroring (see SOP 1) |
| HERO_SELECTION | addon-defined | Assign heroes via dota_run_lua, or GameRules:SetHeroSelectionTime(0) in addon code |
| STRATEGY_TIME | timed | Auto-advances; GameRules:SetStrategyTime(0) to shorten |
| TEAM_SHOWCASE | timed | Auto-advances; GameRules:SetShowcaseTime(0) to shorten |
| WAIT_FOR_MAP_TO_LOAD | seconds | Check console_output channel ResourceSystem — map likely not compiled (dota_compile_asset) |
| PRE_GAME | timed | Auto-advances; GameRules:SetPreGameTime(0) to shorten |
| GAME_IN_PROGRESS | — target state | — |
| POST_GAME | until restart | dota_restart to run again |

Notes:
- Lua method names verified against the live engine via script_help2.
- A phase being stuck is usually information, not an MCP failure: the
  MCP reports state + remedy and lets you decide.
```

- [ ] **Step 6: grep 清扫 + check + commit**

Run: `grep -ri "project_info" src docs README.md skills AGENTS.md package.json`（应零残留）
Run: `npm run check`

```bash
git add -A
git commit -m "docs: vconsole 契约与相位指引全仓同步（工具描述/AGENTS.md/README/skills/注释）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 7: 总验证（离线全绿 + 活体矩阵）

**Files:**
- 无新代码；发现的问题回到对应任务修。

- [ ] **Step 1: 离线全绿**

Run: `npm run check && node scripts/test-relay.mjs && node scripts/test-daemon.mjs`
Expected: 全部 PASS。（test-daemon 的空闲退出用例要求本机无 dota2.exe 在跑，否则先看 test-relay。）

- [ ] **Step 2: 活体自动验证（Dota 运行中，executor 自助完成）**

拉起 daemon：`node dist/relay-main.js`（后台）。然后：
1. 不开 vconsole：用 Task 5 Step 1 的 29002 直连脚本发 `CMD:` 任意命令→ OK（daemon 层不受契约限制，契约在 MCP 层）；起 MCP server（`scripts/test-mcp-tools.mjs`）确认门控工具报「vconsole 未打开」、`dota_status` 返回指引不抛异常、`dota_compile_asset`/`dota2_skill` 正常。
2. `node -e` 或直接运行 vconsole2.exe → 窗口出现**且有输出**（重放生效）；再跑 `scripts/test-mcp-tools.mjs`，门控工具全部通过。

- [ ] **Step 3: 交付用户的人工确认清单**

以下需要用户眼睛，executor 汇总成清单交付：
1. vconsole 窗口内容正常（通道、输出滚动，不是空壳）。
2. 杀掉 dota2.exe（vconsole 不关）→ MCP 工具报 Dota 未连接；重启 Dota → relay 自恢复、vconsole 自复活。
3. （可选）真实崩溃场景下 relay 能在 ~35s 内判死重连。
4. `dota_launch_game` 在 setup 卡住场景返回 stuck 报告（相位 + FinishCustomGameSetup 指引 + 错误行）。
5. 两个 MCP 会话并存：一个调 dota_open_vconsole，另一个的工具同时解除限制。

---

## Self-Review 记录

- Spec A（常持+去重）→ Task 3；B（契约）→ Task 4；C（dota_open_vconsole）→ Task 4；D（重放）→ Task 1；E（活性探测）→ Task 2；F（空闲守卫）→ Task 3；G（合并）→ Task 4；H（快速失败）→ Task 4/5；I（相位）→ Task 5；J（多 agent）→ 设计落点在 daemon，无需独立任务，Task 7 Step 3-5 验收；K（文档同步）→ Task 6。
- 「明确不做」清单无对应任务（看门狗/租约/杀进程/keepalive 均未出现在任何步骤）。

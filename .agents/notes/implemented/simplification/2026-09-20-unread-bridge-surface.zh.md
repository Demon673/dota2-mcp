# Agent Note: 删除 VCon bridge 无读取者的表面与 VRF 未用的字节数

[English](2026-09-20-unread-bridge-surface.md) | 中文

Status: implemented

## Problem

一次针对 relay 与 bridge 层的审计找到四处无读取者的表面：

1. `VrfInfo.downloadedBytes`（`vrf-ensure.ts`）只在全新安装路径写入，无任何读取；`scripts/test-vrf-ensure.mjs` 逐字段断言 `ok`/`cached`/`sha256Ok`/`executable`/`message`，不做键集合比较。
2. `AinfMessage` 被 `vcon-relay.ts` 导入却从未引用——`ainf` 处理器参数无类型标注，其类型由 `VConClientEvents` 推断而来。
3. `VConClient.get connected()` 无调用者。全树每一处 `.connected` 都属于 `RelayClient` 自己的字段，而 relay 真正订阅的是 `connected` **事件**。
4. `VConClientEvents.cvrb` / `cfgv` 零订阅者。`_dispatch` 为这两类帧发事件，而 `rawFrame` 在前一行已把同一帧交付出去，因此 relay 的 GUI 转发与 `INIT_FRAME_TYPES` 重放缓存从不依赖它们。

同一次审计还发现两份笔记把连接门说错了。生命周期那份的 Decision 写着「relay 对 Dota 2 `:29000` **常持连接**……无按需连接」，并把按需连接列入被否决的备选，而 `vcon-relay.ts` 的实际连接以 `_guiConnected` 为门。合同那份的 Consequences 把窗口前提说成「刻意的契约，不是技术必需（29000 本身不需要 GUI）」——这对引擎监听成立（就绪探测正是在无窗口时连上去的），却对上一层拒绝连接的 relay 门只字未提。

## Decision

四个无读取者的成员已删除：`downloadedBytes`、`AinfMessage` 导入、`get connected()`、两个事件成员及其 `_dispatch` 分支。CVRB/CFGV 帧仍经 `rawFrame` 抵达 relay，初始化帧重放与 GUI 转发不受影响。

两份笔记现在都写明 GUI 门控连接——即 `vcon-relay.ts` 实现的、`AGENTS.md` 记录的那个模型。生命周期那份写进标题、Decision 与 Alternatives；合同那份的那句改为点名 relay 的连接门，不再暗示 29000 无门。

## Alternatives considered

- **连所有解析后无读取的线上字段一起删**（`PrntMessage.channelId/color/millisecondTime`、`AinfMessage.productCRC32/gameDir/platformFlags`、`AdonMessage.totalAddons/enabledAddons`、`FrameHeader.handle`、`ChannelInfo` 的未知字段）——否决：这些声明是 `vcon-bridge.ts` 的线上格式模型，而 `package.json` 以 `dist/tools/**` 把它作为可复用的底层 VConsole2 客户端发布。删掉声明等于删掉那次读取，留下一个没有名字的位置偏移；省下约 25 行声明，换一个更贫瘠的协议模型。若该模块不再发布，再议。
- **保留 `cvrb`/`cfgv` 作为未来 raw-CVar 工作的钩子**——否决：`rawFrame` 已把每一类帧都送到 relay，需要订阅者时与新消费者同提交加上即可。

## Consequences

`src/` 少十五行，行为无变化：这四个成员从 `VConClient` 唯一的构造点、以及 `ensureVrf` 的每一个消费者都不可达。`vrf-ensure` 与 `vcon-bridge` 的发布 `.d.ts` 同幅缩小——只对深路径导入 `dist/tools/**` 的人构成破坏，而仓库内不存在这样的导入者。

## Testing

`npm run check` 就是「没有残留引用」的证据：`tsc --noEmit` 会解析每一个标识符，漏掉的读取者会让类型检查失败。`scripts/test-relay.mjs`（初始化帧重放、探针保活、探针行过滤）、`scripts/test-daemon.mjs`、`scripts/test-mcp-offline.mjs`、`scripts/test-fileops.mjs`、`scripts/test-archived-notes.mjs` 均原样通过。

# Agent Note: VRF 版本巡检——pin 的唯一真源

[English](2026-09-20-vrf-version-patrol.md) | 中文

Status: implemented

## Problem

pin 住的 VRF 版本号写在四个地方：`vrf-ensure.ts` 的 `DEFAULT_VERSION` 常量与其选项注释，加上 `src/index.ts` 两条工具描述里写死的 "default v20.0" 与 "Default 20.0"。升级就是四处手改，而且上游动了没有任何提示。写这份笔记时，pin 已经就是最新版 20.0。

## Decision

`DEFAULT_VERSION` 是唯一真源：`vrf-ensure.ts` 导出它，`src/index.ts` 把它插值进两条描述，于是这个字符串只存在一处。

`scripts/check-vrf-version.mjs`（`npm run check-vrf-version`）读这一行，与上游最新 release 比对并报告。`--write` 移动 pin；当目标 release 丢掉了当前 pin 已有的某个 `cli-*.zip` 资产时拒绝写入——代码是动态匹配资产的，缺一个就是该平台的下载 404。退出码：0 已同步或已写入，1 落后，2 无法判定或被拒。`--version <v>` 跳过网络，供离线自测。

AGENTS.md 记录了该命令，文档预算上限从 4000 移到 4050：新增那行占 18 词，而 3998/4000 已经没有任何单行增补的余地。

## Alternatives considered

- **运行时解析 `/releases/latest`，不 pin。** 工具落地时就否决过，现在仍然否决（见 [vrf-ensure 笔记](../feature/2026-08-20-vrf-ensure.md)）：VRF 的 CLI 接口明确不稳定，pin 让 flags 可预测，`VRF_VERSION` 是升级路径。巡检脚本保住 pin，同时让移动它的成本降到一行。
- **挂一个定时 CI 任务。** 否决：1–3 个月才发一版，而且落后一版在需要出现之前零代价，所以真正的触发点是人；这个任务还得联网、还得有 issue 自动化，等于加一个与代码无关的失败面。
- **让脚本重写全部四处。** 否决：那四处本就是重复，消掉重复之后写入只需改一行，而不是四套正则。

## Consequences

升级 pin 是一条命令、一行改动。没有任何东西自动运行：pin 仍是刻意选择，检查在你碰资源工具链时才跑。上限现在留了大约一行的余量，下一次单行增补不必再申请调高。

## Testing

`npm run check-vrf-version` 在 20.0 报告已同步（exit 0）。`--version 19.2` 报告落后（exit 1）。`--version 14.1 --write` 被拒（exit 2），因为 14.1 缺 20.0 已有的 `cli-windows-arm64.zip`。`--version 19.2 --write` 接 `--version 20.0 --write` 往返一次，diff 无残渣。

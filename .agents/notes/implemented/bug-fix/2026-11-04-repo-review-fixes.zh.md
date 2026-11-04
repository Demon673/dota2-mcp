# Agent Note: 仓库边界与生命周期修复

[English](2026-11-04-repo-review-fixes.md) | 中文

Status: implemented

## Problem

多个工具可能在工作不完整时报告成功，或跨越错误的边界共享状态：文件系统链接可逃出 addon/输出根目录，延迟的 socket 事件会覆盖当前连接状态，相同 ID 的 Panorama panel 会共用事件处理器。离线夹具也会优先选中已安装的游戏，而不是显式指定的临时 Steam 根目录。

## Decision

- 文件操作和录制同时检查词法路径与物理祖先，包括新文件已有的祖先目录。允许 addon 根目录本身是链接；指向该根目录外的链接会在读取、删除或写入前被拒绝。`STEAM_PATH` 优先于注册表探测，测试 addon 覆盖值优先于文件系统推断。
- 只读控制台查询为传入引擎的字面参数加引号，并拒绝引号、反斜杠、分隔符和控制字符。API 枚举工具仅发送转储命令，在本地过滤输出，查询不能追加命令。
- 控制 socket 和 MCP 冒烟客户端的 stdout 增量解码 UTF-8。重连会丢弃残缺输入，回调异常限制在分发器内，关闭时也会处理等待鉴权的 socket。STREAM 补发当前状态、addon、通道和过滤配置，覆盖 HELLO 后发生的变化。等待握手的连接有 5 秒期限；控制行在鉴权前限制为 1024 字符，鉴权后为 1048576 字符。未鉴权流量不会延长 daemon 空闲时间。引擎回调仅在仍持有当前连接时更新状态；错误、关闭和连接失败共用清理逻辑。
- 空 relay token 和格式损坏的 bridge token 会明确失败。POSIX 状态目录/token 使用私有权限。socket/进程调用前校验端口/PID；即使没有 PID 文件，也会清理已死亡持有者的锁，同时保留活跃同伴的启动锁。PID 清理会保留其他进程的记录，已关闭的 relay 不会重建空闲计时器。
- Panorama 收集使用配对的标记 ID。事件处理器归属于 panel 实例和事件，包括无名 panel 与 ID 重复的 panel。
- PresentMon 失败或超时后，残缺采样不能转化为成功。SEA 打包使用当前 Node 可执行文件，并以参数数组调用已安装的 postject CLI。
- 依赖最低版本与锁文件包含安全更新。运行时要求 Node 20 或更新版本，与更新后的依赖树及安装说明一致。活体脚本推断测试项目，遵守配置的控制端口/状态目录，并还原临时渲染设置、清理自己的 panel 处理器。
- 更新日志/tag 一致性在创建附注版本 tag 后、发布前及发布 CI 中检查。提交前检查配对、预算、归档说明与空白；它不能要求尚不存在的提交已经拥有 tag。
- 打包程序与 stdin EOF 冒烟测试使用私有状态和隔离端口，关闭自动启动 vconsole/watcher，并等待自己的 daemon 退出后再清理状态。

资产契约分别由[检查](../feature/2026-08-20-asset-inspect.md)与 [VRF 安装](../feature/2026-08-20-vrf-ensure.md)说明维护。

## Alternatives considered

- **仅检查词法路径。** 已有 junction 和符号链接能够绕过它；解析物理祖先既保留常规 addon junction 用法，也能落实边界。
- **依赖 socket 事件顺序。** 旧连接可能在替代连接建立后才关闭；归属检查使这种顺序不再影响当前连接。
- **保留 Node 18 的依赖版本。** 这些锁定版本存在安全公告；修补后的依赖树要求 Node 20。

## Consequences

Node 18 环境需要升级。损坏的 token 文件需要显式修复，而不是静默削弱鉴权。路径检查针对校验时的文件系统状态，不提供抵御并发文件系统修改的事务保证。

Dota 既有的 socket shutdown 致命错误（10038）仍是活跃输出期间的引擎风险，见[关闭说明](2026-10-26-vconsole-socket-shutdown-fatal.md)。

## Testing

release 冒烟集合包含 `test-control-protocol.mjs`。已有 relay、控制台收集、FileOps、录制、Panorama、性能、VRF 和资产脚本包含复现用例，包括只读查询注入、TCP reset 和含多字节文本的长 stdio 响应。Panorama 夹具执行实际生成的桥接 JavaScript；Windows 夹具窗口验证输入焦点和截图窗口状态 API，不会操作 Dota。活体验收覆盖门控、GUI 重开、游戏崩溃/重启、会话共享、重复/无名 panel 的事件，以及两种渲染设置的保留。

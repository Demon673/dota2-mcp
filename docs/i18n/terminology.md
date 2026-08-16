# Terminology

本表约定本仓库中英术语的统一译法。双语配对契约见 [README.md](README.md)。

**通用规则：**
- "中文"列为中文译文正文的默认用词。若该列为英文，则中文正文保留英文不翻译。
- 首次出现按"首次出现"列书写（带括号注释）；后续出现只写括号前的部分，不出现括号内注释。
- "不要译作"列为严格禁止的译法。

## 缩写类（中英文文本中均使用缩写）

| English | 中文 | 首次出现 | 不要译作 | 备注 |
|---|---|---|---|---|
| API | API | | | |
| GUI | GUI | | | |
| MCP | MCP | MCP（Model Context Protocol） | | |
| TCP | TCP | | | |
| VCon | VCon | VCon（VConsole2） | | 指协议/连接；具体端口写 `29000` |
| Lua | Lua | | | |
| KV | KV | | | |
| PR | PR | PR（Pull Request） | | |

## 英文类（中英文文本中均保留英文）

| English | 中文 | 首次出现 | 不要译作 | 备注 |
|---|---|---|---|---|
| Agent Note | Agent Note | | 智能体注记、智能体笔记 | 仓库定义的决策记录类型；中文对侧 H1 固定前缀 `# Agent Note: `，标题中不加术语括注 |
| addon | addon | addon（自定义游戏） | 插件 | Dota 2 自定义游戏项目 |
| blob hash | blob hash | | | `git hash-object` 的结果 |
| canonical | canonical | canonical（权威源） | | 双语配对中 author 侧（本仓库为英文） |
| counterpart | counterpart | counterpart（对应版本） | | 双语配对中另一语言的版本 |
| class | class | class（类别） | | Agent Note 类别轴 |
| daemon | daemon | daemon（守护进程） | 后台进程 | 也可译作「守护进程」 |
| lifecycle | lifecycle | lifecycle（生命周期） | | Agent Note 状态轴 |
| manifest | manifest | manifest（清单） | | |
| relay | relay | relay（中继） | 中继器 | 指 VConRelay 代理 |
| sidecar | sidecar | sidecar（配平文件） | | 指 `.i18n.yaml` |
| switcher | switcher | switcher（语言切换行） | | H1 后的语言切换链接行 |
| thin client | thin client | thin client（瘦客户端） | 轻客户端 | 也可译作「瘦客户端」 |
| vconsole | vconsole | vconsole（控制台窗口） | | 小写保留；指 vconsole2 GUI 窗口 |
| vconsole2 | vconsole2 | | | 引擎的 vconsole2.exe 进程 |

## 中文类（中文正文使用译名）

| English | 中文 | 不要译作 | 备注 |
|---|---|---|---|
| liveness probe | 活性探针 | 存活探测 | 静默超时发 `echo __mcp_ping__` |
| init frame replay | 初始化帧重放 | 初始化帧回放 | AINF/CHAN/CVRB/CFGV/ADON |
| idle exit | 空闲退出 | | 守护进程无客户端 5 分钟退出 |
| zombie connection | 僵尸连接 | | 只 accept 不发 AINF 的连接 |
| contract (gating) | 契约（门控） | | vconsole 显式契约 |
| game-rules phase | 游戏相位 | | `status_json` 的 `game_state` |
| stuck report | 卡相位报告 | | dota_launch_game 卡相位时的返回 |
| standing orders | 常驻规范 | 常驻命令 | 根 AGENTS.md 的常驻规则 |
| one home per fact | 一个事实一个家 | | 文档分层原则 |
| documentation standard | 文档规范 | 文档标准 | docs/AGENTS.md |
| slop checklist | slop 清单 | 赘述清单 | 文档审查清单 |

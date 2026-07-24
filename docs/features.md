# MCP 功能参考

> `dota2-mcp` 向 MCP 客户端暴露的能力一览。

## 协议能力

| 能力 | 数量 | 说明 |
|------|------|------|
| Tools | 22 | 全部功能通过工具暴露 |
| Resources | — | 未注册 |
| Prompts | — | 未注册 |
| Logging | ✓ | 服务端日志 |

---

## Tools

### 导航

| 工具 | 用途 |
|------|------|
| `dota_status` | **入口工具**。获取连接、vconsole、addon、地图、对局状态和下一步指引。无参数，永不抛异常。建议每次会话先调用。 |

### 游戏控制

| 工具 | 用途 | 参数 |
|------|------|------|
| `dota_launch_game` | 启动地图，轮询至 `GAME_IN_PROGRESS`。卡相位超 15s 返回相位名、推进方法和近期错误。 | `map`?, `addon`?, `timeout`? |
| `dota_disconnect` | 断开当前游戏。 | — |
| `dota_restart` | 重载地图（修改 Lua/KV 后使用；常规代码改动优先热重载）。 | — |
| `dota_open_vconsole` | 打开 vconsole2 窗口（AssetBrowser 按钮被 relay 占用时使用）。 | — |

### 控制台

| 工具 | 用途 | 参数 |
|------|------|------|
| `console_send` | 向控制台发送命令。多行以换行分隔。 | `commands` |
| `console_output` | 读取控制台输出。支持级别（0=all ~ 3=errors）、正则、通道过滤。 | `lines`?, `level`?, `filter`?, `channel`? |
| `console_channels` | 列出可用 VConsole2 通道及描述。 | — |
| `console_find` | 搜索全部控制台命令/cvar。使用 `dota_`、`sv_` 等前缀缩小范围。 | `query` |
| `console_help` | 查看命令说明和当前值。 | `command` |
| `console_gui_filter` | 控制 MCP 输出在 vconsole2 GUI 是否可见（默认不可见）。 | `enabled`?, `auto`?, `patterns`? |

### API 文档

> 全部走控制台实时查询，零本地依赖。引擎版本决定 API 内容。

| 工具 | 用途 | 控制台命令 |
|------|------|-----------|
| `dota_api_lua` | Lua API 签名（server/client）。`func` 传函数/类名。 | `script_help2` / `cl_script_help2` |
| `dota_api_panorama_js` | Panorama JS API（GameUI、$ 等）。 | `cl_panorama_script_help_2` |
| `dota_api_css` | Panorama CSS 属性（128 个）。 | `dump_panorama_css_properties` |
| `dota_api_events` | Panel 事件及签名。 | `dump_panorama_events` |
| `dota_api_help` | 官方 Lua API 文档字符串。 | `script_help` |

### 调试

| 工具 | 用途 | 参数 |
|------|------|------|
| `dota_run_lua` | 在游戏中执行 Lua。`expression` 模式自动 DeepPrintTable。 | `code`? \| `expression`? |
| `dota_dump_entities` | 列出场景实体。 | — |
| `dota_dump_modifiers` | 导出 modifier（server/client）。 | `side`? |
| `dota_entity_inspect` | 查看实体 Lua 脚本作用域。 | `entity`, `side`? |

### 资源

| 工具 | 用途 | 参数 |
|------|------|------|
| `dota_compile_asset` | 编译/反编译 Source 2 资源。路径相对 addon `content/` 解析。 | `target`, `addon`?, `recursive`?, `force`?, `decompile`? |

### 技能

| 工具 | 用途 | 参数 |
|------|------|------|
| `dota2_skill` | 获取内置技能文档。无参数列出可用技能，传 `name` 返回内容。 | `name`? |

内置技能：

| 技能 | 说明 |
|------|------|
| `dota2-runtime-dev` | 运行时开发模型：热重载优先、代码生效方式、何时需要 restart。 |
| `dota2-game-phases` | 游戏相位卡住诊断：每相位的正常时长与推进方法。 |

---

## 架构约定

vconsole 门控
: 控制台类工具要求 vconsole2 GUI 已接入 `127.0.0.1:29001`。未接入时返回明确错误，区分「Dota 未运行」与「仅未开 vconsole」。

输出隔离
: AI 调用的控制台输出默认不刷到 vconsole2 GUI；`console_output` 始终可读全部输出。通过 `console_gui_filter` 切换。

多会话共享
: 多个 MCP 客户端共享同一 relay 守护进程。首个会话自动 spawn，后续直接接入。

自动恢复
: Dota 2 闪退后 relay 自动重连；守护进程被杀后 MCP 会话内自愈重建。

零配置
: Dota 2 路径通过 Steam appid 自动检测；addon/maps 从 daemon 握手信息推断。可通过环境变量覆盖。


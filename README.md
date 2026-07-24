# dota2-mcp

让 AI 助手直接连接你的 Dota 2 客户端，辅助自定义游戏开发。

`dota2-mcp` 是一个基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 的服务器。接入支持 MCP 的 AI 客户端（如 Claude Code、Cursor 等）后，AI 就能在 Dota 2 运行时：

- 读取并发送控制台命令
- 查询 Lua / Panorama JS / CSS / 事件 API
- 启动、重载、断开自定义游戏地图
- 查看当前场景中的实体、修饰器、实体脚本
- 编译 Source 2 资源

无需手动复制粘贴控制台输出，AI 可以直接从游戏里拿到实时信息。

## 前置条件

- Node.js ≥ 18（自带 npx）
- Dota 2 已安装，并以 `-vconsole` 或 `-tools` 启动

> dota2-mcp 探测到 Dota 2 后会**自动打开 vconsole** 并建立连接，无需手动操作。注意：**vconsole 不开，relay 就不连 Dota**——控制台类工具也不可用，所以窗口请保持开着（这样你也能随时看到 AI 在控制台里做了什么）。

## 配置 vconsole2 GUI 端口

Dota 2 默认只允许一个 VConsole2 客户端连接 `127.0.0.1:29000`。`dota2-mcp` 已经占用了这个端口，并把 GUI 转发到 `127.0.0.1:29001`，所以需要手动把 vconsole2 切过去。

**怎么打开 vconsole2**：**默认不用管**——relay 探测到 Dota 就绪后会自动帮你打开（设 `DOTA2_VCON_AUTO_OPEN_VCONSOLE=0` 可关闭）。注意：**vconsole 不开，relay 就不连 Dota**（控制台类工具也不可用），所以窗口请保持开着。Dota 2 工具模式（AssetBrowser）里的 vconsole 按钮只在 relay 占用 `29000` 期间（即 vconsole 已连接时）被引擎禁用；窗口关闭后按钮恢复可用。也可直接运行 `{dota 2 beta}\game\bin\win64\vconsole2.exe`，或让 AI 调用 `dota_open_vconsole`。晚打开的窗口会自动补齐初始化数据，随开随用。

### 首次设置

1. 打开 vconsole2，在顶部工具栏下方第一排找到连接/设备选择区域。
2. 选择 **Add a new device to connect.**（添加一个新的连接设备），设置端口为 `29001`，创建成功后会多一个端口页签，标题会显示为 `Localhost:29001`，然后打开连接（**Devices → Connect**）。
3. 选中默认的 `Localhost`（即 `29000`），断开连接（**Devices → Disconnect**）。

完成这一步后，vconsole2 就能正常显示 Dota 2 控制台了。

### 设置自动连接（可选）

不想每次手动切换端口，可以设置开机自动连 `29001`：

1. 选中 `Localhost:29001`，点击菜单栏 **Devices → Properties**，开启 **Auto connect at startup**。
2. 再切换回默认的 `Localhost`（`29000`），同样在 **Devices → Properties** 里关闭 **Auto connect at startup**。

这样下次启动 vconsole2 时会自动连接 `29001`，不会再尝试占用 `29000`。

如果想脱离 MCP 单独使用 vconsole2（直连 `29000`）：关闭 Dota 2 并退出所有 MCP 会话，守护进程空闲约 5 分钟自动退出并释放 `29000`（Dota 2 在运行时守护进程不会退出，也可手动结束它）。平时把 GUI 连在 `29001` 上即可与 MCP 同时使用，无需断开。

## 安装与配置

**安装方式：npx（唯一推荐）**。零安装，每次客户端启动自动使用最新版本（首次会下载一次包，之后走本地缓存；网络不可用时自动回退到缓存版本）。

### 通用配置

所有支持 MCP 的客户端都是同一份配置，把它放进对应客户端的 `mcpServers` 里：

```json
"dota2": {
  "command": "npx",
  "args": ["-y", "dota2-mcp"]
}
```

### 各客户端配置方法

**Claude Code**

- 方式一（推荐）：命令行运行 `claude mcp add dota2 -- npx -y dota2-mcp`
- 方式二：编辑 `~/.claude.json`，在 `mcpServers` 中加入通用配置
- 验证：会话内输入 `/mcp`，dota2 显示 connected

**Claude Desktop**

- 编辑配置文件：Windows `%APPDATA%\Claude\claude_desktop_config.json`；macOS `~/Library/Application Support/Claude/claude_desktop_config.json`，写入：
  ```json
  {
    "mcpServers": {
      "dota2": { "command": "npx", "args": ["-y", "dota2-mcp"] }
    }
  }
  ```
- 重启 Claude Desktop

**Cursor**

- Settings → MCP → Add new MCP server；或编辑 `~/.cursor/mcp.json`，加入通用配置

**VS Code（GitHub Copilot）**

- 用户 `settings.json` 或工作区 `.vscode/mcp.json`，写入：
  ```json
  {
    "mcp": {
      "servers": {
        "dota2": { "command": "npx", "args": ["-y", "dota2-mcp"] }
      }
    }
  }
  ```

**Cline（VS Code 扩展）**

- Cline 面板 → MCP Servers → Configure MCP Servers，在打开的 `cline_mcp_settings.json` 的 `mcpServers` 中加入通用配置

**Codex CLI**

- 编辑 `~/.codex/config.toml`（TOML 格式）：
  ```toml
  [mcp_servers.dota2]
  command = "npx"
  args = ["-y", "dota2-mcp"]
  ```

**其他 MCP 客户端**

- 找到 MCP / mcpServers 配置入口，粘贴通用配置即可。

### 启动后验证

1. 客户端里 dota2 显示 connected；
2. 启动 Dota 2（`-vconsole` 或 `-tools`）；
3. 让 AI 调用 `dota_status`：vconsole 会被自动打开（或已打开），返回项目状态与下一步指引。

### 连接问题排查

| 现象 | 处理 |
|------|------|
| 客户端启动超时 / 连接失败 | 首次拉包慢：args 改为 `["--prefer-offline", "-y", "dota2-mcp"]`（缓存优先，仍会自动更新，新版本可能晚一个缓存周期） |
| Windows 报「找不到命令 / not recognized」 | 用 cmd 包装：`"command": "cmd", "args": ["/c", "npx", "-y", "dota2-mcp"]` |
| 工具报「未连接到 Dota 2」 | 启动 Dota 2（`-vconsole` 或 `-tools`） |
| 工具报「vconsole 未打开」 | 正常会被自动打开；没有则见下方「常见问题」 |

> 独立可执行文件（win/linux/mac）仍随每个 Release 提供，仅面向不便使用 Node 的特殊场景；日常一律用 npx。

## 常见问题

**AI 提示找不到 Dota 2 怎么办？**

确保 Dota 2 是通过 Steam 安装的，并且启动了 VConsole2。程序会通过 Steam appid `570` 自动定位 Dota 2 目录，不需要手动设置路径。

**为什么 vconsole2 GUI 要连 `29001`？**

因为 Dota 2 的 `29000` 端口一次只允许一个 VConsole2 客户端连接，`dota2-mcp` 必须作为这条连接的唯一客户端，并通过 `29001` 将连接代理给 vconsole2 GUI。这样人类开发者和 AI 才能同时使用控制台。

**我不想让 MCP 输出出现在 vconsole2 GUI 里**

默认就是屏蔽的。如果想临时关闭，调用 `console_gui_filter` 并设置 `auto: false`。

**AI 提示「vconsole 未打开」怎么办？**

正常情况下 relay 探测到 Dota 就绪会自动打开 vconsole2。没有打开时：直接运行 `{dota 2 beta}\game\bin\win64\vconsole2.exe`，或让 AI 调用 `dota_open_vconsole`。注意 vconsole 不开，控制台类工具就不可用（这样你能看到 AI 的操作）。AssetBrowser 里的 vconsole 按钮只在 vconsole 已连接时无效，是引擎的限制，不是故障。

## 文档

- 功能参考：见 [docs/features.md](./docs/features.md)。
- 架构与设计：见 [docs/design.md](./docs/design.md)。

## 版本

当前版本：`v1.5.1`

详情见 [CHANGELOG.md](./CHANGELOG.md) 与 [GitHub Releases](https://github.com/Demon673/dota2-mcp/releases)。

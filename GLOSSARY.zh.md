# Dota 2 自定义游戏开发

[English](GLOSSARY.md) | 中文

本术语表定义用 dota2-mcp 开发 Dota 2 自定义游戏时使用的领域术语。

## 语言

### 自定义游戏

**addon**：一个 Dota 2 自定义游戏项目，包含其玩法、地图与资产。_避免_：plugin。

**map**：addon 内可游玩的环境。

**game-rules phase**（游戏相位）：一局对战建立或推进中的一个阶段，例如英雄选择或对局进行中。游戏相位与地图是否已加载是两回事。

**particle preview**：在运行中的游戏里创建的粒子实例，用来查看某个特效。预览是运行时实例，与定义它的粒子资产不同。

**game screenshot**（游戏截图）：从游戏外部获取的 Dota 2 游戏窗口画面，因此游戏无响应时也能拿到。与引擎自己截取的截图不同。

### 控制台访问

**VCon**：用于与 Dota 2 引擎交换命令与输出的控制台协议或连接。

**vconsole**：开发者的 VConsole2 GUI 窗口。

**vconsole2**：引擎的 VConsole2 应用，其窗口称为 vconsole。

**relay**：在 AI 客户端与 vconsole 之间共享引擎控制台访问权的中间层。_避免_：在指这个中间层而非其宿主进程时称 daemon。

**daemon**（守护进程）：独立的守护进程，承载 relay，可服务多个 MCP 会话。_避免_：在指这个宿主进程而非中间层时称 relay。

**thin client**（瘦客户端）：MCP 会话中的控制台客户端，通过共享守护进程访问引擎。

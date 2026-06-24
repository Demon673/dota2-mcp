# dota2-mcp — DOTA2 自定义游戏全流程 MCP Server

> AI agent 辅助 DOTA2 自定义游戏开发：VCon 实时 Console 桥接、控制台 API 查询、游戏启动/重启/监控。

## Project

- **技术栈**：TypeScript (Node.js >= 18) + `@modelcontextprotocol/sdk`
- **入口**：`src/index.ts` → `dist/index.js`（stdio MCP server）
- **核心机制**：VConsole2 TCP 协议（端口 29000）→ VConRelay 透明代理（监听 29001 供 vconsole2 GUI 连接）
- **依赖**：无外部二进制依赖，纯 Node.js

## 关键发现

- **VConsole2 协议**：12 字节帧头 `Type(4B)+Version(2B=212)+Length(4B)+Handle(2B)` + payload
- **Dota 2 只允许 1 个 VCon 客户端**：Relay 抢占 29000，vconsole2 GUI 通过 relay 的 29001 端口共存
- **API 全部走控制台**：零本地 JSON 依赖，引擎版本决定 API 内容
- **已验证的控制台命令**：
  - `script_help2` / `cl_script_help2` — Lua API（stub 格式）
  - `cl_panorama_script_help_2` — Panorama JS 枚举
  - `dump_panorama_css_properties` — CSS 属性
  - `dump_panorama_events` — Panel 事件
  - `dota_modifier_dump` / `cl_dump_modifier_list` — Modifier 列表
  - `ent_script_dump` / `cl_ent_script_dump` — 实体脚本作用域
  - `script_find` / `cl_script_find` — VM 搜索（需游戏运行）
  - `script_dump_all` / `cl_script_dump_all` — VM 导出（需游戏运行）

## Commands

```bash
npm install           # 安装依赖
npx tsc               # 编译 TypeScript → dist/
npx tsc --noEmit      # 仅类型检查
node dist/index.js    # 启动 MCP server（通过 stdio）
```

## Architecture

### 核心模块

| 文件 | 说明 |
|------|------|
| `src/index.ts` | MCP server 入口，注册全部工具 |
| `src/tools/vcon-bridge.ts` | VConsole2 TCP 协议实现（VConClient 类） |
| `src/tools/vcon-relay.ts` | VCon 透明代理（Dota 2 :29000 ↔ GUI :29001） |
| `src/tools/console-bridge.ts` | cfg 文件 + console.log tail 降级方案 |
| `src/tools/proxy-intercept.ts` | TCP 代理工具（协议分析用） |

### 当前已实现的 14 个 MCP 工具

**游戏控制**
| 工具 | 控制台命令 | 说明 |
|------|-----------|------|
| `project_info` | `status` + 文件扫描 | addon/maps/运行时状态（零硬编码） |
| `dota_launch_game` | `dota_launch_custom_game` | 启动（自动补全 addon） |
| `dota_disconnect` | `disconnect` | 断开 |
| `dota_restart` | `restart` | 重载地图 |

**Console 通信**
| 工具 | 控制台命令 | 说明 |
|------|-----------|------|
| `console_send` | 任意 | 发送命令 |
| `console_output` | VCon 流 | 读输出，支持 `level`（0=all,1=warn+,3=error）和 `filter` |
| `console_find` | `find <kw>` | 搜索所有 5248 个控制台命令 |

**API 文档（全部走控制台实时查询）**
| 工具 | 控制台命令 | side |
|------|-----------|:--:|
| `dota_api_lua` | `script_help2` / `cl_script_help2` | 可选 |
| `dota_api_panorama_js` | `cl_panorama_script_help_2` | client |
| `dota_api_css` | `dump_panorama_css_properties` | client |
| `dota_api_events` | `dump_panorama_events` | client |

**调试**
| 工具 | 控制台命令 | side |
|------|-----------|:--:|
| `dota_dump_modifiers` | `dota_modifier_dump` / `cl_dump_modifier_list` | 可选 |
| `dota_entity_inspect` | `ent_script_dump` / `cl_ent_script_dump` | 可选 |

## Conventions

- **API 数据源**：只走控制台实时查询，不使用本地 JSON 数据库（引擎版本决定 API 内容）
- **信任边界**：Server Lua 权威，Panorama JS 客户端 UI 逻辑
- **零硬编码**：addon/map 全部动态检测，不写死任何项目名
- **工具描述**：每个工具清晰标注对应的控制台命令，AI 可通过 `console_find` 自行发现
- **TSTL/SolidJS 优先**：编辑 `.ts`/`.tsx` 源文件，不动生成的 `.lua`/`.js`

## References

| 项目 | 路径/URL |
|------|----------|
| tui12（守卫雅典娜2） | `C:\Repositories\tui12` |
| vscode-dota2-tools | `C:\Repositories\dota2-tools` |
| VRF / Source 2 Viewer | https://github.com/ValveResourceFormat/ValveResourceFormat |
| VConsole2.Client (C#) | https://github.com/yuijzeon/VConsole2.Client |
| VConsoleLib.python | https://github.com/uilton-oliveira/VConsoleLib.python |
| luaconsole2 (Lua) | https://github.com/eepycats/luaconsole2 |
| Dota 2 路径 | `D:\SteamLibrary\steamapps\common\dota 2 beta` |
| console.log 路径 | `{dota 2 beta}\game\dota\console.log` |
| VCon 端口 | 引擎监听 29000，relay 监听 29001 |

## TODO — 后续计划

- [ ] **FileOps** — 读写 KV/Lua/TS/JS/CSS/XML 源文件
- [ ] **BuildTools** — npm/tstl/rollup 构建集成 + 脚手架生成
- [ ] **AssetInspector** — VRF CLI 子进程调用，解析 .vmdl_c/.vmap_c/.vpcf_c 等
- [ ] **Claude MCP 配置** — 写配置让 AI agent 直接调用
- [ ] 验证 `script_find` / `script_dump_all` 在游戏运行时的实际输出
- [ ] 测试 dota_launch_game 在各种 addon/map 组合下的表现

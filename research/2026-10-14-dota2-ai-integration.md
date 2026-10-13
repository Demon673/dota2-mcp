# Dota 2 自定义游戏开发：MCP 还能补上哪些工具能力

本研究讨论 AI 辅助开发者编写、修改和调试 CustomGame 时，MCP 能补上的开发工具能力。参照主流引擎的 MCP，重点考察资源查找与复用、运行中的 UI 调试，以及引擎错误到源码的定位。文件归属见 [research/ 说明](README.md)；文档规范见 [docs/AGENTS.md](../docs/AGENTS.md)；领域术语见 [GLOSSARY.md](../GLOSSARY.md)。

## 结论与筛选标准

现有工具已覆盖大量脚本开发操作，目前没有足够依据提出一长串必须新增的 MCP。其他引擎的工具经常直接接在编辑器对象模型上 [S1] [S7] [S9]；本仓库主要接在 Dota 控制台上 [S24] [S25]，剩余价值更可能出现在资源包、运行中的 UI 和 Workshop 编辑器。

资源工作先区分松散源文件与资源包：本机安装有大量可直接搜索的粒子源文件，模型、声音和编译后的 HUD 资料则可能需要 VPK 读取 [S40]。不能以「找特效」为由先建设资源包工具。值得继续验证的是已有 CLI 与资产工具之间的缺口，以及运行中的 Panorama 信息如何取得。地图对象也有离线读取路径：Valve 的 `dmxconvert` 在模板副本上完成了文本转换，修改后能否被 Hammer／编译器正确接受仍未验证 [S41]。TSTL 报错映射沿用已有提案。具体任务、现有替代方式与实现边界见[开发任务与接入价值](#开发任务与接入价值)。

筛选以一个可说清的开发任务为起点：开发者现在手工做什么，通用 agent 的文件／终端能力和现有 MCP 已能完成多少，缺的是否是引擎数据或编辑器操作。普通代码生成、项目构建、KV／Lua 绑定分析和调用已有调试命令，通常属于 agent 工作流程；业务快照、场景框架和批量平衡性测试只有具体项目需求出现时才值得投入。NPC 对话、导演与线上模型决策属于游戏功能设计，移出本报告的开发工具建议。

## 证据与验证范围

资料查阅日期为 2026-10-14。跨引擎对照依据厂商文档及实现源码，仓库状态和推送日期查自 GitHub API [S10]；本次未在编辑器中执行它们。Dota 部分结合当前 MCP 源码、分发样例、历史引擎输出和安装文件调查。补充调查记录了本机松散资源清点、Panorama 模块中的字符串、`resourcecompiler` 帮助输出，以及 `dmxconvert` 对模板副本的转换结果 [S40] [S41]。本轮没有启动游戏或修改 addon，也没有验证调试器、转换后的地图加载或实际渲染。

Dota 侧证据分三类。Valve 分发安装中的脚本与样例 addon，以及固定版本的公开镜像，提供实际开发用法 [S17] [S27] [S28] [S29]。本机 `console.log` 中 2026-06-25 抓取的 `script_help2` 输出，只证明历史声明，不能当作 2026-10-14 的实时 API 结果 [S30]；本文不使用扩展附带的 JSON 或类型声明作为引擎 API 真源。本仓库源码则直接说明当前工具的参数、收集方式与能力边界 [S24] [S25] [S31] [S32] [S33] [S34]。Valve Developer Community 的目标页面返回 HTTP 403，中文运营站镜像未标明版本且有失效条目 [S18]。引擎签名和行为需要在目标地图、脚本上下文及当前版本下重新查询。

分发样例名称仅用于来源定位，不作为默认测试项目。公开镜像不能提供的模板二进制和 UI layout，记录为本机安装内的只读观察，并使用 `{dota2Path}` 占位路径 [S35]。跨引擎部分的源码级来源包括 Godot 的 `src/index.ts` [S11]、Roblox 服务器的 `src/rbx_studio_server.rs` [S8] 和 Unreal 社区服务器的 `Python/tools/*.py` [S12]；README 层面的来源包括两个 IvanMurzak 仓库 [S13] [S14] 和 Unity 社区工具参考 [S9]，只证明文档描述。引擎接口与 MCP 实现分别引用：Unreal 的 Remote Control API [S15] 和 Godot 命令行 [S16] 的可用性，不能推出已存在对应 MCP 工具。

## 主流引擎提供了什么

本次查到三条厂商发布的 MCP 路径：Epic 的 `ModelContextProtocol` 插件、Unity 的 `com.unity.ai.assistant` 包内 MCP，以及 Roblox Studio 内建服务器；未查到 Godot 官方 MCP [S1] [S5] [S7]。Dota 2 方面，本次未找到厂商发布的 MCP。本仓库通过 VCon 控制台提供接入，addon Lua、Panorama、文本资产与命令行工具则是项目原本就在使用的开发接口；已查资料不足以确认 Hammer、Particle 或 ModelDoc 存在公开的自动化接口 [S24] [S25] [S26]。

官方服务器的约束各不相同。Unreal 插件处于实验阶段，仅允许本机回环连接，没有鉴权，并在游戏线程上串行执行请求 [S1]；Unity 公告中的 beta 使用条件包括关联云项目，以及有效的试用或订阅 [S5]；Roblox 已归档独立服务器，转向 Studio 内建版本 [S8]。对 CustomGame 日常开发更有参考价值的是它们让 agent 查资产、读对象属性、看到实际画面，并在修改之后取得编译和运行诊断。分页、任务句柄和工具分组是支撑这些操作的机制，只有对应操作需要时才值得引入；31 个工具并不构成先扩建调度层的理由 [S3] [S7] [S9]。

| 能力维度 | Unity | Unreal | Godot | Roblox |
|---|---|---|---|---|
| 场景／实体图 | `manage_scene` 提供分页层级查询、叠加加载多个场景，以及 `validate`，支持 `auto_repair` [S9]；官方 MCP 支持场景与对象检查 [S5] | `SceneTools`、`ActorTools`；UEFN 将 Scene Graph 实体与组件作为工具集提供 [S1] [S4] | `create_scene`、`add_node`，参数包括 `parentNodePath`、`nodeType`、`properties` [S11] | `search_game_tree` 返回扁平 JSON，支持路径／类别／关键词过滤和深度上限；另有 `inspect_instance` [S7] |
| 属性／组件 | `manage_components`、`manage_gameobject` [S9]；官方说明可检查和修改组件属性 [S5] | `MaterialInstanceTools`、`ObjectTools`、`UAttributeSetToolset`，后者默认关闭 [S1] | 只支持创建时设置属性，不提供之后的读取或修改 [S11] | `inspect_instance` 负责读取；修改通过 `execute_luau` 或多处编辑完成 [S7] |
| 脚本编辑／执行 | `script_apply_edits` 提供有类型的编辑操作；`apply_text_edits` 使用 `precondition_sha256` 前置检查，`get_sha` 提供检查所需的 hash；另有 `validate_script` [S9] | Blueprint 图编辑；Verse 的枚举、修改、搜索与编译 [S4] | 没有脚本读取、创建或更新工具 [S11]；仅支持 C# 版 Godot 的插件增加了增删改查与校验 [S14] | `script_read` 支持行范围，另有 `script_grep`、`multi_edit`；`execute_luau` 可选择 `Edit`／`Client`／`Server` [S7] |
| 编译／测试／运行与停止 | `refresh_unity` 支持 `wait_for_ready`；`run_tests` 返回任务 ID，由 `get_test_job` 轮询；`manage_build` 提供 `build`／`status`／`cancel` [S9] | `LiveCodingToolset.CompileLiveCoding` 等待编译完成并返回诊断；自动化测试还通过独立的引擎 API 提供 [S3] | 在进程层面启动、运行、停止和获取调试输出 [S11] | `start_stop_play`、`run_script_in_play_mode`，后者在完成或超时后停止运行并返回日志、错误和耗时；另有 `get_studio_state` [S7] [S8] |
| 截图／UI 输入 | `manage_camera(action="screenshot")` 支持 `game_view`／`scene_view`、内嵌 base64，以及环绕／轨道视角拼图 [S9] | 插件文档没有列出截图工具；类型接口中只有图像和音频结果构造函数 [S1] [S2] | 没有提供 [S11] | `screen_capture`、`user_keyboard_input`、`user_mouse_input`，可指定 UI 实例；另有 `character_navigation` [S7] |
| 资产导入／引用 | 资产、prefab、材质、纹理、着色器工具，以及图像／模型／音频生成 [S9] | `MaterialInstanceTools`；UEFN 支持资产搜索与插入 [S1] [S4] | `load_sprite`、`export_mesh_library` 和 UID 维护 [S11] | 按 ID 搜索和插入、图像上传、模型生成任务，以及 `wait_job_finished` [S7] |
| 性能／日志 | `read_console` 支持类型、文本和堆栈过滤及分页；另有 profiler 工具组 [S9] | 控制台命令和故障排查流程；编译期间调用可能挂起或失败 [S3] | `get_debug_output`；C# 插件还可轮询运行中游戏产生的错误 [S11] [S14] | `get_console_output` [S7] [S8] |
| 批量／异步／撤销 | `batch_execute` 最多执行 25 条命令，明确不具备事务性；构建和测试使用任务 ID；`manage_editor(action="undo")` 返回撤销步骤的名称 [S9] | 接受并发请求，对派发进行同步；skill 提醒跨越编译过程的 MCP 修改不一定能撤销 [S3] | 没有提供 [S11] | `wait_job_finished` [S7] |
| 能力发现／上下文控制 | `manage_tools` 启用或隐藏工具组；操作前可读取项目资源，获取渲染管线、输入处理器和包信息 [S9] | `tools/list` 默认只返回 `list_toolsets`、`describe_toolset`、`call_tool`；项目 skill 通过工具集提供 [S3] | 扁平工具列表 [S11] | 扁平列表，加上用于探索／运行测试的 `subagent` 和 `skill` [S7] |

## 代表实现

**Unreal `ModelContextProtocol`：Epic 官方，UE 5.8，实验阶段。** 服务器运行在编辑器进程内，默认地址为 `http://127.0.0.1:8000/mcp`，仅提供 HTTP 和服务器发送事件，可通过 `StartServer`、`RefreshTools`、`GenerateClientConfig <client>` 等控制台命令管理 [S1] [S3]。工具集按插件划分，类型接口支持图像、音频、资源链接和结构化结果的构造 [S2]。值得注意的是其上下文成本设计：启用工具搜索后，客户端不直接接收各工具集的完整定义，而是通过 `call_tool` 交给服务器派发，使会话中的工具目录保持稳定，便于命中提示词缓存 [S3]。Epic 的官方 skill 还规定先发现再调用的流程，以及批量编辑前保存、等待阻塞式编译工具完成、按依赖顺序调用、未明确成功就按失败处理、留意 Play-in-Editor 状态等操作要求；另有能跨编辑器重启维持连接的代理，恢复后发出 `notifications/tools/list_changed` [S3]。UEFN 将同一服务器用于玩法开发，覆盖 Verse、Scene Graph 实体与组件、设备，以及启动运行、推送 Verse 更新、读取客户端日志的会话工具 [S4]。

**Unity 官方实现。** MCP 随 Assistant 包提供，在 Edit > Project Settings > AI > Unity MCP 中启用；客户端通过 `~/.unity/relay/` 下的 relay 可执行文件连接，启动时传入 `--mcp`，首次连接需在编辑器内批准 [S5] [S6]。2026-05-11 的公告将当时 beta 的条件列为 Unity 6、关联云项目，以及有效试用或订阅 [S5]；2.9 版本的配置与注册手册则说明包、连接桥、客户端配置和首次批准，没有重复这些条件。两类资料的范围不同，不能据此认定其互相矛盾 [S5] [S6]。公告只点名 `Unity_ReadConsole`，其余能力按类别描述 [S5]。扩展模型有明确文档：在接收参数类的静态函数上使用 `[McpTool]`，或实现 `IUnityMcpTool<StatefulParams>`；可结合 `[McpSchema]`、`[McpOutputSchema]`，或调用 `McpToolRegistry.RegisterTool` 动态注册。编辑器启动时，注册表通过 `TypeCache` 扫描程序集，在派发前进行校验 [S6]。

**Unity 社区实现。** `CoplayDev/unity-mcp` 使用 MIT 许可证，分支为 `beta`，最近推送日期为 2026-10-08，本次固定提交为 `142ea0af4890337f0ff6658df61db23982313717`；项目与 Unity 没有隶属关系，由 Aura 赞助 [S9]。参考文档列出 48 个工具，其中值得借鉴的是有类型的脚本编辑操作、文本编辑路径上的 `precondition_sha256` 检查、低成本获取 hash 的操作、最多 25 条命令且明确不具备事务性的批量调用、测试和构建的任务 ID 与带超时轮询及取消，以及操作前读取项目能力的资源；撤销操作会返回被撤销步骤的名称 [S9]。这些名称和参数来自工具参考，未查阅 C# 处理函数。`IvanMurzak/Unity-MCP` 使用 Apache-2.0 许可证，推送日期为 2026-10-13，固定提交为 `d522963f1c878423f3d3535d323846c053898ef6`；其文档还描述了包括单独渲染对象在内的多种截图、测试和 profiler 控制 [S13]。

**Unreal 社区实现。** `chongdashu/unreal-mcp` 最近推送日期为 2025-04-22，固定提交为 `4e5f00da50733190481311e254d16d137a84ef33`，未提供许可证文件。它由 Python 服务器通过 TCP 55557 连接 C++ 编辑器插件，要求 UE 5.5 或以上 [S12]。处理函数源码显示，八个 actor 工具位于 `editor_tools.py`，Blueprint、图和 UMG 工具分别位于各自模块，`project_tools.py` 中只有一个输入映射工具；两个工具在源码中被注释停用，理由分别是存在缺陷，以及已被其他工具替代 [S12]。

**Godot 社区实现。** `Coding-Solo/godot-mcp` 使用 MIT 许可证，最近推送日期为 2026-04-16，固定提交为 `1209744fad78f3998f98c7394fd0f6ef50da5281`。工具集中注册在一个处理模块中，包括编辑器启动、运行与停止、调试输出、项目列表、场景创建、节点添加、sprite 加载、mesh library 导出、场景保存和 UID 维护；它通过子进程启动 Godot，并由附带的 GDScript 处理操作 [S11]。schema 显示其能力上限：只能在创建时设置属性，没有脚本工具。插件形式的实现补充了这些能力，但所查实现要求使用 Godot 的 C#／.NET 版本 [S11] [S14]。

**Roblox。** Studio 在进程内提供 stdio MCP 服务器，通过 Assistant > Manage MCP Servers 启用，后续调用使用 `list_roblox_studios` 返回的实例标识指定目标 [S7]。可借鉴的能力包括实例图搜索与检查、按行范围读取脚本、grep 和多处编辑、明确选择数据模型的 `execute_luau`、运行与停止和模式查询、控制台输出、视口截图、面向 UI 实例的键鼠输入、角色导航、用于探索或运行测试的 `subagent`，以及资产插入和可等待的模型生成任务 [S7]。截图与输入模拟结合，使 agent 可以实际驱动并观察测试。旧独立服务器已归档，`archived: true`，最近推送日期为 2026-04-03，固定提交为 `b0b6474f55eb1772254d98533e40e8f5abc2260b`；它仍是一个简洁的轮询架构样本：Studio 插件轮询外部服务，而 MCP 层通过 stdio 与客户端通信 [S8]。

## 哪些机制可以借鉴，哪些需要适配

借鉴应从具体操作开始。UEFN 的资产搜索／插入、Roblox 的实例检查／截图和 Unity 的对象／组件操作，分别解决找素材、理解运行对象和观察修改结果的问题 [S4] [S7] [S9]。Dota 对应的是 VPK 内资源、Lua 实体与能力实例、Panorama panel 和 Workshop Tools；不能把其他引擎的场景图或组件 schema 直接移植过来。

实现机制按缺口选择：现有 `console_output` 已有级别、通道和文本过滤，只有需要稳定取得多批日志时再补游标或分页；长任务确实跨调用时再引入任务 ID；批量编辑遇到内容过期时再使用 hash 前置检查 [S9] [S24]。编辑器事务和撤销则依赖目标编辑器，运行时 Lua 修改不会自动获得同样语义 [S3]。relay 已处理共享连接和重连，新工具首先复用这条链 [S25]。

## Dota 2 的实际开发边界

跨引擎能力只能作为参照。Dota 侧每项建议都要说明它操作哪台机器、哪种脚本上下文、哪些项目数据，以及怎样证明改动生效。以下结论分别基于本仓库源码、Valve 分发样例和历史引擎输出；本轮没有启动游戏或修改 addon。

**B1｜先确认实际运行目标。** `dota_launch_game` 已在对局中会直接返回，地图已加载时主要观察相位，不是强制切换 addon／地图的接口；`dota_restart` 只发送 `restart` 后立即返回 [S24]。应核对当前 addon、地图和客户端，不能只凭调用参数推断工具已完成切换。引擎进入对局相位也不证明 addon 初始化或 UI 加载完成；多人问题还需明确各客户端和服务器的关系。

**B2｜修改、构建、加载和验收是四个步骤。** 常见项目在 `content/dota_addons/<addon>/` 保存资源源文件，在 `game/dota_addons/<addon>/` 提供运行所需文件；后者也会包含直接编写的 Lua 和 KV，不能简单等同于「全是编译产物」。TSTL、SolidJS 和数据生成器的真实源码可能位于另外的工作区，应先读取项目配置确认来源与输出目录，再使用项目已有构建／watch 流程 [S24] [S36]。`dota_compile_asset` 调用资源编译器，不替项目执行 TSTL 或 SolidJS 构建。技能还跨文件绑定：分发样例中的 `BaseClass`、`ScriptFile`、施法类型、冷却与特殊值在 KV 中，Lua 用 `GetSpecialValueFor` 读取对应键；资源由 `Precache` 准备 [S27]。因此构建成功之后，还要确认运行实例加载了预期版本，以及技能绑定和行为正确。`reload_script` 在本仓库运行时 skill 中指项目提供的重载模块，涉及 listener、timer 和模块清理，不是每个 addon 都有的统一入口 [S36]；替换定义不等于更新已绑定回调、modifier 实例或预缓存。不支持热重载时，使用明确的重新加载流程。已发布 VPK 的更新与重新部署是另一阶段，本地文件编辑不会自动更新正在进行的线上对局。

**B3｜本地开发连接不等于线上服务器管理。** 当前 VCon 客户端连接本机 `127.0.0.1:29000`，薄客户端连接本机控制口，relay 的 GUI／控制监听也绑定本机回环 [S25] [S33] [S34]。本地自建游戏服务器时，这条链可以用于开发验证；玩家连接远端对局时，连接本地客户端的控制台不能据此取得远端权威服务器的脚本执行能力。Workshop 发布物与开发机是不同部署，本工具没有线上管理通道；对发布后游戏的控制需要另外的部署、授权和通信设计。

**B4｜UI 调试需要客户端观察。** Panorama API 枚举和客户端 Lua 实体 dump 都没有返回正在显示的 panel 树、实际样式或画面 [S24]。自定义 UI 清单把界面加载到 HUD、选人、结算等入口，样例操作从当前上下文或传入容器查找 panel [S28] [S35]。因此 UI 检查要指定客户端、游戏相位和已加载的 addon layout；服务器发送了事件或写了 net table，不能证明 panel 收到并显示。截图可以取得视觉结果，panel 检查能帮助定位原因，两者应按任务需要组合。Panorama 不是浏览器 DOM，本轮未取得可直接使用的远程调试协议，不能默认套用 Chrome DevTools。

**B5｜服务器 Lua、客户端 Lua、Panorama 和 bot 上下文分别观察。** 本仓库 `dota_run_lua` 面向服务器脚本；`dota_entity_inspect` 默认使用客户端实体脚本 dump；`dota_api_panorama_js` 只枚举 Panorama JS API，不执行 JS 或读取 panel 树 [S24]。能力／modifier 的共享 Lua 定义中存在 `IsServer()` 分支，服务器结果不代表客户端状态一致 [S28]。bot 样例的 `GetBot`／`Action_*` 用法不能搬到 CustomGame 服务器上下文；不过 CustomGame 控制单位并非没有证据，Valve 分发触发器和物品脚本实际调用了 `CastAbilityOnPosition` 与 `CastAbilityNoTarget` [S27]。当前签名仍需加载地图后从对应上下文查询。`setfenv` 用法只能证明函数环境处理，不能单独证明 VM 的全部隔离规则；Lua 模块存在 `debug`、文件或系统调用文本，也不证明运行时沙箱允许它们 [S29]。静态源码行映射不应依赖运行时 `debug.traceback` 可用；本仓库已有提案正是针对引擎报错到生成文件的映射 [S22]。

**B6｜实例检查与业务状态分别处理。** `status_json` 覆盖地图、加载、游戏相位、玩家数、CPU 和网络信息，不自动包含波次、任务或经济状态 [S24]。日常检查单位、技能或 modifier，可优先查询可访问实例；任意模块 local、闭包或自定义状态则要由项目明确暴露。分发样例通过 net table 和事件给 Panorama 提供数据，客户端先读现值再订阅变化 [S17] [S27]。这条游戏内通信链不是 MCP 订阅接口，读取 UI 已接收的数据仍需客户端观察。没有具体调试需求时，不必先为项目搭一套业务状态导出。

**B7｜发送完成不代表效果完成。** 控制口在发送命令后立即返回 `OK`，Lua 工具监听日志时间窗口，输出安静 400 ms 后可以提前结束，最长等待 15 s [S24] [S25]。分发技能在 `OnSpellStart` 创建投射物，之后的 `OnProjectileHit` 才结算伤害；think 回调也可能更晚发生 [S27] [S28]。日常调试要在效果发生后观察对应对象和日志，不能将工具返回或暂时无错误视为通过。共享日志也可能包含其他操作的输出。

日志和文本传输还有限制：`console_output` 没有游标或分页，只返回过滤后的末 N 行；会话保留 10000 行，薄客户端有单行与缓存上限，VCon 命令和 PRNT 文本按 ASCII 处理 [S24] [S33] [S34]。`dota_run_lua` 会把正文中的双引号整体替换为单引号 [S24]。这些限制直接影响错误收集和 UI 探针；新增工具要验证实际输出能完整收到，不能仅加 schema 就承诺大 JSON 或中文可靠往返。

**B8｜地图源文件可转换读取，但修改与加载要另验。** 现有文件工具限定 addon 的 content／game 目录，以 UTF-8 读写文本，读取上限 5 MB [S24]。官方模板 `.vmap` 的二进制头见 S35；补充调查使用 Valve `dmxconvert` 在其副本上转换为 DMX 文本，得到 `classname`、`targetname` 和 `origin` 字段，反向编码也生成了文件 [S41]。这次转换同时把文件头的 vmap 格式版本从 20 升到 40，反向编码也没有恢复为字节相同的原件 [S41]。尚未通过 Hammer 打开、编译和游戏加载验证，因此只确认该样本可离线读取和重新编码，不能称为原格式的无损往返。不能把普通文本替换当作地图语义编辑、事务或导航几何处理。

现有 `asset_inspect` 只为 vpcf、vmdl、vmat、vtex 提供摘要，其他类型没有地图／导航摘要，未知类型原文需显式请求 [S31]。`asset_check_refs` 只识别这四类扩展名，查找松散文件而不解析完整 VPK 挂载关系；反编译失败的节点会被跳过 [S32]。零条 broken、编译器退出码为零或预览 ID 存在，都不能单独证明目标客户端加载和显示正确。VRF 对编译地图的重建与 DMX 对地图源文件的转码也应分别验证 [S39] [S41]。

能观测什么、不能证明什么，可以合并成一张表：

| 观测手段 | 能证明 | 不能证明 |
|---|---|---|
| 控制台命令与日志（`console_send`／`console_output`） | 发送行为和收到的日志；只有对应观察才能支持执行结果判断 [S24] | 发送成功不代表效果完成，也不证明 UI 渲染、大文本完整性或运行归属（B7） |
| 服务器作用域读取（`dota_run_lua`） | 该上下文可访问的函数／实例输出，需要与请求和目标关联 [S24] | 任意 local／闭包状态、远端服务器执行权限、全量世界反射 |
| 客户端实体脚本（`dota_entity_inspect`） | 客户端 Lua 的实体脚本作用域 [S24] | Panorama JS 的 panel 树与事件轨迹（B5） |
| 资产摘要与引用检查 | 四类资产的结构化字段、松散文件之间的引用关系 [S31] [S32] | VPK 内资源解析、编译产物是否会被引擎加载（B8） |
| 引擎 API 清单 dump | 抓取时刻存在的名字 [S30] | 行为的正确性与版本稳定性 |
| 项目自己的输出 | 项目愿意暴露的状态与完成信号 | 未暴露的世界状态（B6） |

## 当前桥接工具的实际能力

本仓库注册了 31 个工具 [S24]。控制台类工具要求 vconsole 已连接，relay 才保持与 Dota 的连接 [S25]；文件工具限定在 addon 的两个目录内；资产工具离线走 VRF，能力见 B8。它已经让 agent 发送命令、读错误、查当前 API、执行服务器 Lua、检查实体脚本和编译资源。对以 TS／Lua、KV 和文本 UI 为主的工作，客户端代码工具加这条控制台链已经覆盖大量操作，新增 MCP 不应再复制一套文件、构建和业务命令层。剩余缺口主要在资源包访问、实际界面观察和编辑器操作。

工具结果目前都使用文本内容块：Lua 返回控制台或 `DeepPrintTable` 文本，资产摘要是文本中的 JSON 字符串 [S24]。需要截图时，MCP 规范提供图像结果格式，但实际窗口抓取、SDK／客户端兼容性尚需实现和验证 [S23]。GSI 是可选只读补充，不能代替自定义业务观察，也没有必要为日常开发优先新增一条状态通道 [S19] [S20]。

## 开发任务与接入价值

### 1. 找到并复用一个具体的 Dota 资源

**开发请求：**「给范围技能找几个现成的地面圈特效，看看哪个好用」或「这个模型用的材质和贴图在哪」。这需要先找到当前安装里的具体文件，再查看依赖和实际效果。跨引擎的对应功能是 UEFN 资产搜索／插入和 Unity 资产检查 [S4] [S9]。

**先查松散文件：** 本机 Valve 分发安装的 `content/dota/` 有 82,470 个 `.vpcf`、122 个 `.vmap` 及少量 Panorama 示例文件；这些数量只描述该安装，不保证其他版本或安装组件齐全 [S40]。找粒子候选可先搜索文件路径与内容，复用本仓库的粒子字段和配方资料 [S38]。材质也有部分松散文件，不能因为能搜到一些就认定完整覆盖。缺少源码的模型、贴图、声音和编译 HUD，再查 VPK；当前没有必要为松散粒子查询新增解析工具。

**资源包读取：** `asset_inspect` 要求可访问的文件路径，`asset_check_refs` 主要解析松散文件，`vfx_preview` 要求已知粒子路径 [S24] [S31] [S32]。`dota_compile_asset` 的 decompile 分支可以接收 VPK 路径，但没有条目搜索、类型筛选或选定条目提取参数 [S24]。VRF 文档已经提供 `--vpk_list`、`--vpk_filepath` 和 `--vpk_extensions`：路径过滤支持不区分大小写的前缀，以及 `*`／`?` 的整路径匹配。多块资源包以 `_dir.vpk` 为输入，列举与输出分开调用；`--output` 提取存储的编译数据，配合 `--vpk_decompile` 才对支持的资源执行反编译 [S39]。这些是可复用的 CLI 能力，尚未在本机资源包上执行。

**修改所需的数据：** 文件名查询不能直接判断「哪个是红色地面圈」，还需配置内容或预览。VRF 文档区分模型的 ModelDoc／DMX 重建、粒子的 KV3 提取、地图重建和 Panorama 还原，各类都有不同保真程度；Panorama TypeScript 产物不能还原 authored TS，地图也不能恢复所有原始编辑结构 [S39]。不承诺一次反编译即可得到完整、可编辑的制作工程。

**预览补足到实际用途：** 当前 `vfx_preview` 创建时传入的 owner 是 `nil`，参数只提供 attach 类型和 CP0 位置 [S24]。光束、实体挂点和使用其他 control point 的效果，需要配置相应 CP 或 owner 才能看对；可先复用 `dota_run_lua`，重复遇到同类需求时再扩展现有预览参数。具体 CP 含义从资源配置和调用代码核对，不能靠粒子 ID 或默认 CP0 判断。视觉结果仍需目标客户端画面。

**是否需要新 MCP：** 松散文件搜索先用通用 agent 工具；打包资源先走现有 VRF CLI。只有安装／挂载定位、按需返回或现有资产工具衔接确实妨碍操作时，才考虑一个查询入口或 VPK 条目输入。资源路径解析也应区分「松散文件未找到」「已在资源包内确认存在」「尚未检查资源包」，而不是将第一种结果当作资源缺失。本轮未在默认缓存位置找到 VRF CLI，没有执行本机 VPK 查询或下载。

### 2. 调试正在显示的 Panorama 界面

**开发请求：**「这个面板为什么没显示」「这段文本为什么被裁掉」「改完布局后实际是什么样」。Roblox 的实例检查／截图和 Unity 的视图截图，给 agent 提供了源码之外的对象信息与画面 [S7] [S9]。这比再生成一份 XML／CSS 模板更能补上开发缺口。

**现状与缺口：** 目前只能查 Panorama API、读源文件和控制台错误，服务器 Lua 查询与实体脚本 dump 都拿不到当前 panel 树 [S24]。本机 `panorama.dll` 中观察到 `CreateDebuggerWindow`、`BeginDebuggerInspect`、`panorama_toggledebugger_mode`、`panorama_print_render_tree` 等字符串 [S40]。这提供了查命令和调试器的方向，却不证明名字已注册、在 CustomGame 可调用或输出可被 MCP 读取；不能据此宣称有可用的远程调试 API。

截图能帮助确认布局和视觉问题；要判断 panel 是否存在、加载了哪个 layout、有哪些 class／属性，还需客户端信息。后续 live 调查可先用 `console_find` 查询 `panorama`，再对实际发现的名字调用 `console_help`，核对名称、参数与输出方式。GUI 检查器是否可被自动读取是另一个问题；未确认前不要求每个 addon 先安装一层调试适配。

**最小接入：** 若客户端已有通用截图或电脑操作工具，直接复用；否则考虑指定 Dota 窗口的图像结果，验证画面来自目标客户端。panel 检查从选定 addon 子树开始，只读取调试所需信息，控制台输出路径、上下文与可查询属性均需实际验证。原生调试器操作、代码探针和截图是不同实现方式，取得一张图不等于已经有可自动读取的属性检查器。

**是否需要新 MCP：** 这是值得验证的引擎观察缺口。窗口抓取可由通用工具承担，Dota 专用价值在于拿到 Panorama 的运行信息并关联布局／样式源码。若只能包装截图，而客户端已能截图，就没有新增专用工具的理由。当前资料不足以承诺远程 panel 检查或样式编辑已可实现。

### 3. 把运行时报错定位回真正的源码

**开发请求：**「控制台说生成 Lua 某行出错，实际该改哪个 TS 文件」。编译器对源码的诊断通常已有文件和行号，缺口主要发生在运行时 Lua 堆栈指向生成文件或 bundle 时。仓库已有 [dota_map_error 提案](../.agents/notes/proposed/feature/2026-08-05-dota-map-error-tool.md)，无需再设计一套构建系统 [S22]。

TSTL 上游源码在启用 `sourceMapTraceback` 时生成行映射，bundle 映射包含原始行和源文件 basename；同时还有标准 source map 的生成路径 [S37]。这些产物支持离线定位的可行性，但不保证当前项目已启用映射，也不保证任意报错行都有直接条目。bundle 中同名文件、旧产物和不同 TSTL 版本的格式需要明确处理；缺映射或有歧义时返回原因。运行时 traceback 注册使用 `debug.getinfo`，静态读取产物不能据此声称该运行时能力在 Dota 可用。

**是否需要新 MCP：** 有确定的定位价值，但能力也可由 CLI 或已有编辑器集成提供。优先实现或复用提案中的一个离线查询，再视使用情况决定是否给控制台错误自动加链接；它是已有待办，不是本次新发现。

### 已有工具够用的开发工作

| 开发任务 | 直接使用的能力 | 何时才需要补工具 |
|---|---|---|
| 技能没加载、modifier 没挂上、特殊值不对 | agent 追查 KV／脚本绑定，结合 `dota_run_lua` 的可访问实例查询和日志 [S24] [S27] | 实际反复查询同一组引擎属性、现有调用不稳定时，才考虑一个小的检查工具；普通实例查询不先要求业务状态适配 |
| 编写技能／物品／单位定义和本地化 | 文件／代码搜索工具，结合现有 API 查询与项目约定 [S24] [S27] | 只有发现通用文件工具无法处理的引擎数据缺口时；模板与检查规则先放在 skill |
| 构建 TSTL／SolidJS 并重载 | 客户端终端执行已有构建命令，项目支持的重载入口、`dota_status` 和日志 [S24] [S36] | 缺的是可靠重载或诊断时补该步骤；不再包装 npm 执行为一组 BuildTools |
| 复现单个玩法问题 | 现有项目调试命令，必要时针对问题写一段开发 Lua；观察真实施法流程和效果 [S24] [S27] [S28] | 已确认需要反复跑同类回归时再做自动化；直接调用 `OnSpellStart` 不证明指令、费用、过滤与冷却流程 |

### 保留为接口调查的编辑器能力

编辑器相关操作包括地图对象属性、粒子 operator 和模型 attachment／动画。这些直接服务内容制作，对应其他引擎的对象／组件与资产编辑 [S1] [S4] [S9]。接入不一定要控制编辑器窗口，先检查它使用的文件和已有转换工具。

| 具体开发请求 | 当前取得的证据 | 能先复用什么 | 尚未证明的部分 |
|---|---|---|---|
| 地图里有哪些指定类型的实体，它们叫什么、在哪里 | 模板副本经 `dmxconvert` 得到含实体属性的 DMX 文本；分发 FGD 有实体类型和属性声明 [S40] [S41] | 临时副本转换、按实体过滤；FGD 作为内容开发参考 | 不保证所有 `.vmap` 格式兼容；修改、回写、Hammer 打开、编译和加载均需另验 |
| 特效的路径、CP 和 operator 如何配置 | 松散 `.vpcf`、模板示例和仓库粒子字段资料 [S38] [S40] | 文件搜索、现有编辑／编译／预览流程 | 实际视觉结果；Particle Editor 内部对象的自动操作 |
| 模型有哪些挂点、动画和材质配置 | VRF 文档描述 ModelDoc／DMX 重建与附件／动画等数据 [S39] | 已有 CLI 提取及模型技能 [S38] | 具体资源的重编译和保真程度；ModelDoc 内部操作 |

模板转换得到的文本约 6.9 MB，超过 `file_read` 上限；按对象返回过滤结果可能有实用性，但同样可由客户端终端完成 [S24] [S41]。只有格式处理或重复查询确实造成负担时，才值得补一个地图读取工具。FGD 参考、粒子配方和转换说明先作为知识资料，无需分别造工具。

本机安装调查看到 Hammer、ModelDoc 和 Particle Editor 的 DLL [S40]，这只能说明该安装的组件布局；没有单独 exe 不等于不存在脚本接口、IPC 或编辑器内命令。当前调查没有确认这些自动化路径，也没有证明它们不可能。运行时实体修改与离线文件读取仍不能代替持久地图编辑（B8）。

### 最小验证顺序

先对具体任务选已有路径：找粒子用松散文件搜索；找没有松散来源的模型、声音或 HUD 用 VRF 的资源包过滤／提取；地图对象查询用副本转码。比较这些做法与 MCP 封装的收益后，再决定是否增加入口。`resourcecompiler` 帮助中的 `-dependency_check_only` 提供了检查是否需要重新编译的线索，应先核对其实际结果和退出行为，必要时扩展现有 compile 工具参数 [S41]。Panorama 则先 live 查询实际注册的命令，确认可读输出后再考虑探针。TSTL 映射沿用既有提案。

本轮执行了模板副本的离线转码，但没有编辑／编译地图、查询 VPK 或运行游戏。Panorama、粒子预览和运行报错映射的实测需要明确的 addon／地图或目标界面。候选应证明减少手工步骤、取得原来拿不到的证据或降低重复格式处理成本；无需项目额外维护代码时更有推广价值。业务测试框架、批量平衡性测试和游戏内 AI 应用不列入这条开发工具路线。

## 来源

所有 URL 的查阅日期为 2026-10-14。社区仓库固定到所查提交，厂商文档按页面标明版本范围。

| 编号 | 来源说明 | URL |
|---|---|---|
| S1 | Epic，《Unreal MCP in Unreal Editor》，UE 5.8 文档，实验阶段 | https://dev.epicgames.com/documentation/unreal-engine/unreal-mcp-in-unreal-editor |
| S2 | Epic，`ModelContextProtocol` 插件 API 参考 | https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/ModelContextProtocol |
| S3 | Epic 官方 Claude Code 插件，`skills/unreal-mcp/SKILL.md` 与 `references/operations.md`，提交 `a6aa73ada02a9fb1f5415bec491f9942c519b297` | https://github.com/EpicGames/unreal-engine-skills-for-claude-code-plugin/blob/a6aa73ada02a9fb1f5415bec491f9942c519b297/skills/unreal-mcp/references/operations.md |
| S4 | Epic，UEFN MCP 文档 | https://dev.epicgames.com/documentation/fortnite/uefn-mcp |
| S5 | Unity，《Unity's AI tools in beta: How to get started with MCP》，2026-05-11 公告，点名 `Unity_ReadConsole`、relay 路径，以及当时的云项目关联和试用／订阅条件 | https://unity.com/blog/unity-ai-mcp-how-to-get-started |
| S6 | Unity，AI Assistant 包手册，`com.unity.ai.assistant@2.9`、2.9.0-pre.2，固定版本：[入口](https://docs.unity.cn/Packages/com.unity.ai.assistant@2.9/manual/integration/unity-mcp-landing.html)、[配置](https://docs.unity.cn/Packages/com.unity.ai.assistant@2.9/manual/integration/unity-mcp-get-started.html)、[架构](https://docs.unity.cn/Packages/com.unity.ai.assistant@2.9/manual/integration/unity-mcp-overview.html)、工具注册 | https://docs.unity.cn/Packages/com.unity.ai.assistant@2.9/manual/integration/unity-mcp-tool-registration.html |
| S7 | Roblox，《Roblox Studio MCP server》，Studio 内建服务器 | https://create.roblox.com/docs/studio/mcp |
| S8 | `roblox/studio-rust-mcp-server` README，以及 `src/rbx_studio_server.rs` 中的工具注册，提交 `b0b6474f55eb1772254d98533e40e8f5abc2260b`，已归档 | https://github.com/roblox/studio-rust-mcp-server/blob/b0b6474f55eb1772254d98533e40e8f5abc2260b/src/rbx_studio_server.rs |
| S9 | `CoplayDev/unity-mcp` README 与 `.claude/skills/unity-mcp-skill/references/tools-reference.md`，提交 `142ea0af4890337f0ff6658df61db23982313717`；查阅的是文档，不是处理函数源码 | https://github.com/CoplayDev/unity-mcp/blob/142ea0af4890337f0ff6658df61db23982313717/.claude/skills/unity-mcp-skill/references/tools-reference.md |
| S10 | 2026-10-14 查阅的 GitHub REST API `GET /repos/{owner}/{repo}` 响应，覆盖 S8、S9、S11–S14 中的仓库 | https://docs.github.com/rest/repos/repos#get-a-repository |
| S11 | `Coding-Solo/godot-mcp` 的 `src/index.ts` 工具注册，提交 `1209744fad78f3998f98c7394fd0f6ef50da5281` | https://github.com/Coding-Solo/godot-mcp/blob/1209744fad78f3998f98c7394fd0f6ef50da5281/src/index.ts |
| S12 | `chongdashu/unreal-mcp` README 与 `Python/tools/*.py`，提交 `4e5f00da50733190481311e254d16d137a84ef33` | https://github.com/chongdashu/unreal-mcp/tree/4e5f00da50733190481311e254d16d137a84ef33/Python/tools |
| S13 | `IvanMurzak/Unity-MCP` README，仅有文档描述，提交 `d522963f1c878423f3d3535d323846c053898ef6` | https://github.com/IvanMurzak/Unity-MCP/tree/d522963f1c878423f3d3535d323846c053898ef6 |
| S14 | `IvanMurzak/Godot-MCP` README，仅有文档描述，提交 `27272d1dc4c4272b0d6b65cd71b3e752276b48a1` | https://github.com/IvanMurzak/Godot-MCP/tree/27272d1dc4c4272b0d6b65cd71b3e752276b48a1 |
| S15 | Epic，《Remote Control for Unreal Engine》，REST 和 WebSocket 引擎 API，与 MCP 不同 | https://dev.epicgames.com/documentation/en-us/unreal-engine/remote-control-for-unreal-engine |
| S16 | Godot，《Command line tutorial》 | https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html |
| S17 | SteamDB 镜像的 Valve 分发文件，不是维护者源码或 API 数据库，提交 `7831e51872e36152e5d765e67bcea5b5602737f5`：[服务器事件](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota_addons/overthrow/scripts/vscripts/events.lua)、[Panorama 计分板](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/content/dota_addons/overthrow/panorama/scripts/custom_game/overthrow_scoreboard.js)、[demo 监听器](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota_addons/hero_demo/scripts/vscripts/addon_game_mode.lua)、[demo 动作](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota_addons/hero_demo/scripts/vscripts/events.lua)、[游戏初始化](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota/scripts/vscripts/game/gameinit.lua)、[bot 示例](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota/scripts/vscripts/bots_example/ability_item_usage_lina.lua)；本轮未从镜像取得的自定义 UI 清单另见 S35 | https://github.com/SteamTracking/GameTracking-Dota2/tree/7831e51872e36152e5d765e67bcea5b5602737f5 |
| S18 | Dota 2 Workshop Tools，《Built-In Engine Events》，中文运营站镜像；没有版本信息，部分条目标注为失效，仅用作候选清单 | https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Scripting/Built-In_Engine_Events.htm |
| S19 | Valve，Game State Integration 可用性公告，Steam app 570 新闻，2022-03-11，要求 `-gamestateintegration` | https://store.steampowered.com/news/posts/?appids=570&enddate=1656109094&feed=steam_community_announcements |
| S20 | `antonpup/Dota2GSI`，社区 GSI 接收器，HTTP POST JSON、`CustomGameName` 字段 | https://github.com/antonpup/Dota2GSI |
| S22 | 本仓库：TSTL 产物的静态源码行映射工具，处于提案阶段，尚未实现 | ../.agents/notes/proposed/feature/2026-08-05-dota-map-error-tool.md |
| S23 | Model Context Protocol 规范，《Tools》，版本 2026-07-28，涉及 `outputSchema`、`structuredContent`、图像／音频／资源结果及跨调用状态句柄 | https://modelcontextprotocol.io/specification/latest/server/tools |
| S24 | 本仓库：工具注册、Lua 执行与控制台输出路径，2026-10-14 查阅 | ../src/index.ts |
| S25 | 本仓库：VCon relay 控制口处理；输出时间窗口和 Lua 标记处理位于 S24，2026-10-14 查阅 | ../src/tools/vcon-relay.ts |
| S26 | ValveResourceFormat 文档入口，说明可转换为 Hammer／ModelDoc 可用格式、glTF 导出、CLI、库调用和 VPK 读取；未承诺运行中编辑器自动化或无损回写；分支 `master`，未固定提交 | https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/docs/index.md |
| S27 | SteamDB 镜像，Valve 分发样例 addon `overthrow` 的脚本与 KV，提交 `7831e51872e36152e5d765e67bcea5b5602737f5`：[对局模式（预载、事件、作弊命令注册、think）](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota_addons/overthrow/scripts/vscripts/addon_game_mode.lua)、[单位施法与随机分支](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota_addons/overthrow/scripts/vscripts/items.lua)、[触发器单位施法](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota_addons/overthrow/scripts/vscripts/fire_trap_trigger.lua)、[异步技能（施法、投射物、命中、伤害）](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota_addons/overthrow/scripts/vscripts/breathe_fire.lua)、[net table 声明](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota_addons/overthrow/scripts/custom_net_tables.txt)、[能力定义 KV 与 Lua 绑定](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota_addons/overthrow/scripts/npc/npc_abilities_custom.txt) | https://github.com/SteamTracking/GameTracking-Dota2/tree/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota_addons/overthrow |
| S28 | SteamDB 镜像，Valve 分发样例 addon `conquest`，同一提交：[分阶段 panel 操作](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/content/dota_addons/conquest/panorama/scripts/custom_game/shared_scoreboard_updater.js)、[施法过滤器与光标目标](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota_addons/conquest/scripts/vscripts/boulder_trap.lua)、[周期 think 的被动 modifier](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota_addons/conquest/scripts/vscripts/dig_site/modifier_dig_site_passive.lua) | https://github.com/SteamTracking/GameTracking-Dota2/tree/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota_addons/conquest |
| S29 | SteamDB 镜像，Valve 分发引擎脚本，同一提交：[JSON 模块的依赖与保护调用](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota/scripts/vscripts/game/dkjson.lua)、[Lua 初始化与 require](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota/scripts/vscripts/game/gameinit.lua)、[bot 函数环境](https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota/scripts/vscripts/game/botsinit.lua) | https://github.com/SteamTracking/GameTracking-Dota2/tree/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota/scripts/vscripts |
| S30 | 本机历史引擎输出，只证明抓取时的声明：2026-06-25 的 `{dota2Path}/game/dota/console.log` 中，脚本指令见 25373，服务器类型见 25662–25668，定向事件见 28789–28794，net table 参数见 28808–28819；2026-10-14 只读核对，未公开原始日志 | 无公开链接；当前版本须加载目标地图，通过 `script_help2` 的实时 STREAM 输出重新查询 |
| S31 | 本仓库：资产工具模块，结构化摘要与引用检查的作用范围 | ../src/tools/asset-inspect.ts |
| S32 | 本仓库：资产引用检查模块 | ../src/tools/asset-check-refs.ts |
| S33 | 本仓库：VCon 客户端默认连接地址，以及命令与 PRNT 文本的 ASCII 编解码 | ../src/tools/vcon-bridge.ts |
| S34 | 本仓库：薄客户端的本机控制连接、单行与接收缓存限制 | ../src/relay-client.ts |
| S35 | 2026-10-14 本机 Valve 分发文件的只读观察：`{dota2Path}/content/dota_addons/addon_template/maps/template_map.vmap` 的前 96 字节，及 `content/dota_addons/overthrow/panorama/layout/custom_game/custom_ui_manifest.xml` 的分阶段 UI 入口 | 无公开链接；文件头／layout 观察不属于实时运行验证 |
| S36 | 本仓库：源码／生成产物边界、项目支持的脚本重载流程和加载时生效的改动 | ../skills/dota2-runtime-dev/SKILL.md |
| S37 | TypeScriptToLua 上游源码，提交 `0c3a141280d6796c1a1906210622bda8ea4180a2`：[非 bundle 映射与标准 source map](https://github.com/TypeScriptToLua/TypeScriptToLua/blob/0c3a141280d6796c1a1906210622bda8ea4180a2/src/LuaPrinter.ts)、bundle 映射的 file basename／line 序列化；仅核对生成代码，未验证 Dota 运行时 traceback 支持 | https://github.com/TypeScriptToLua/TypeScriptToLua/blob/0c3a141280d6796c1a1906210622bda8ea4180a2/src/transpilation/bundle.ts |
| S38 | 本仓库：粒子／模型技能中的官方语料统计、配方和字段资料；这些说明不是当前安装的通用 VPK 搜索接口 | [粒子技能](../skills/dota2-vfx/SKILL.md)、[模型技能](../skills/dota2-model/SKILL.md) |
| S39 | ValveResourceFormat 自身文档，提交 `b26838e354f7f3b39190384640b53f6b29fc7226`：[CLI 的资源包过滤／提取和稳定性限制](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/b26838e354f7f3b39190384640b53f6b29fc7226/docs/guides/command-line.md)、各类资源的还原能力与缺失信息；此文档版本不保证仓库所 pin 的 v20.0 参数一致 | https://github.com/ValveResourceFormat/ValveResourceFormat/blob/b26838e354f7f3b39190384640b53f6b29fc7226/docs/guides/format-support.md |
| S40 | 2026-10-14 补充调查的本机 Valve 安装记录：`content/dota/` 松散文件清点，分发 FGD 和模板 readme，编辑器 DLL 布局，以及 `game/bin/win64/panorama.dll` 中的字符串；未 live 核对命令或调试器 | 无公开链接；单一安装观察，不代表完整资源目录、其他版本或接口可用性 |
| S41 | 2026-10-14 补充调查调用 Valve `dmxconvert` 对模板副本转码：binary 9／vmap 20 → keyvalues2 4／vmap 40，2,305,637 → 6,948,908 字节；反向生成 2,305,789 字节文件。另记录 `resourcecompiler` 帮助中的 `-dependency_check_only`、`-novpk` 和 `-filelist` | 无公开链接；未修改安装原件，未验证地图往返语义、编译／加载或依赖检查行为 |

S41 的执行参数如下，`<tmp>` 表示独立临时目录，输入是模板副本。两次进程退出码均为 0；这只记录转换器完成，不证明地图语义或编辑器兼容性。该工具帮助说明省略 `-o` 会覆盖输入，因此复用这条流程时必须显式指定输出文件。

```text
dmxconvert.exe -i <tmp>/a/template_map.vmap -o <tmp>/b/template_map.vmap -oe keyvalues2 -of vmap
dmxconvert.exe -i <tmp>/b/template_map.vmap -o <tmp>/c/template_map.vmap -oe binary -of vmap
```

来源可用性说明：厂商文档、公开源码、仓库文件和本机只读观察分别标注。S27 的主要脚本以及 S28 的计分板脚本在本轮读取了公开固定版本正文，并与本机分发用法核对；模板文件头与 UI manifest 采用 S35 的本机观察。Unity 手册来自 `docs.unity.cn`，版本见 S6。未找到 Godot 官方 MCP 是本次调查结果，不是厂商声明。Valve Developer Community 的目标页面返回 HTTP 403；S18 的事件列表和 S30 的历史引擎清单均不替代当前地图加载后的实时查询。

[S1]: https://dev.epicgames.com/documentation/unreal-engine/unreal-mcp-in-unreal-editor
[S2]: https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/ModelContextProtocol
[S3]: https://github.com/EpicGames/unreal-engine-skills-for-claude-code-plugin/blob/a6aa73ada02a9fb1f5415bec491f9942c519b297/skills/unreal-mcp/references/operations.md
[S4]: https://dev.epicgames.com/documentation/fortnite/uefn-mcp
[S5]: https://unity.com/blog/unity-ai-mcp-how-to-get-started
[S6]: https://docs.unity.cn/Packages/com.unity.ai.assistant@2.9/manual/integration/unity-mcp-tool-registration.html
[S7]: https://create.roblox.com/docs/studio/mcp
[S8]: https://github.com/roblox/studio-rust-mcp-server/blob/b0b6474f55eb1772254d98533e40e8f5abc2260b/src/rbx_studio_server.rs
[S9]: https://github.com/CoplayDev/unity-mcp/blob/142ea0af4890337f0ff6658df61db23982313717/.claude/skills/unity-mcp-skill/references/tools-reference.md
[S10]: https://docs.github.com/rest/repos/repos#get-a-repository
[S11]: https://github.com/Coding-Solo/godot-mcp/blob/1209744fad78f3998f98c7394fd0f6ef50da5281/src/index.ts
[S12]: https://github.com/chongdashu/unreal-mcp/tree/4e5f00da50733190481311e254d16d137a84ef33/Python/tools
[S13]: https://github.com/IvanMurzak/Unity-MCP/tree/d522963f1c878423f3d3535d323846c053898ef6
[S14]: https://github.com/IvanMurzak/Godot-MCP/tree/27272d1dc4c4272b0d6b65cd71b3e752276b48a1
[S15]: https://dev.epicgames.com/documentation/en-us/unreal-engine/remote-control-for-unreal-engine
[S16]: https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html
[S17]: https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota_addons/overthrow/scripts/vscripts/events.lua
[S18]: https://www.dota2.com.cn/wiki/Dota_2_Workshop_Tools/Scripting/Built-In_Engine_Events.htm
[S19]: https://store.steampowered.com/news/posts/?appids=570&enddate=1656109094&feed=steam_community_announcements
[S20]: https://github.com/antonpup/Dota2GSI
[S22]: ../.agents/notes/proposed/feature/2026-08-05-dota-map-error-tool.md
[S23]: https://modelcontextprotocol.io/specification/latest/server/tools
[S24]: ../src/index.ts
[S25]: ../src/tools/vcon-relay.ts
[S26]: https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/docs/index.md
[S27]: https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota_addons/overthrow/scripts/vscripts/addon_game_mode.lua
[S28]: https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/content/dota_addons/conquest/panorama/scripts/custom_game/shared_scoreboard_updater.js
[S29]: https://github.com/SteamTracking/GameTracking-Dota2/blob/7831e51872e36152e5d765e67bcea5b5602737f5/game/dota/scripts/vscripts/game/gameinit.lua
[S30]: #来源
[S31]: ../src/tools/asset-inspect.ts
[S32]: ../src/tools/asset-check-refs.ts
[S33]: ../src/tools/vcon-bridge.ts
[S34]: ../src/relay-client.ts
[S35]: #来源
[S36]: ../skills/dota2-runtime-dev/SKILL.md
[S37]: https://github.com/TypeScriptToLua/TypeScriptToLua/blob/0c3a141280d6796c1a1906210622bda8ea4180a2/src/transpilation/bundle.ts
[S38]: ../skills/dota2-vfx/SKILL.md
[S39]: https://github.com/ValveResourceFormat/ValveResourceFormat/blob/b26838e354f7f3b39190384640b53f6b29fc7226/docs/guides/command-line.md
[S40]: #来源
[S41]: #来源

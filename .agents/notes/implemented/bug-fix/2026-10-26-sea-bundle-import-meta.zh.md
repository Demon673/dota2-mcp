# Agent Note: SEA 产物不再在 import.meta 与 relay 启动路径上崩溃

[English](2026-10-26-sea-bundle-import-meta.md) | 中文

Status: implemented

## 问题

发布工作流从 `dist/bundle.cjs`（esbuild `--format=cjs`）打包 Node SEA 单文件可执行程序。`src/index.ts` 在模块作用域调用 `createRequire(import.meta.url)` 给 `getVersion()` 用。CommonJS 包没有 `import.meta`，所以打包后的表达式是 `undefined`，`createRequire(undefined)` 在服务端启动前就抛出 `ERR_INVALID_ARG_VALUE`。对刚打出的产物做一次 stdin 关闭的运行即可复现（`exit=1`）。工作流只检查发布资产是否存在，因此三个平台的二进制都会一启动就死。

恢复普通的 `require` 后又暴露了下一处失败：`createRelay()` 解析 `./relay-main.js` 并用 `process.execPath` spawn 守护进程。在 SEA 里该路径就是 exe，spawn 会重新拉起 MCP 服务而不是守护进程，`waitForRelay` 于是等满 30 秒超时。`skillsDir()` 形状相同：它解析 `../package.json`，而独立下载的目录里没有这个文件。发布矩阵的 `SEA_OUTPUT_NAME=dota2-mcp-win` 还会产出没有扩展名的 Windows 文件，即使二进制本身有效，`CreateProcess` 也无法启动它。

## 决定

- 模块作用域绑定改为 `createRequire(import.meta.url ?? __filename)`：ESM 的 `dist/index.js` 提供 `import.meta.url`；CJS 包提供 `__filename`（包/可执行文件路径）。
- `getVersion()` 不再用 `require`。它在原有 `try/catch` 里用 `fs.readFileSync(new URL(...))` 读取 `../package.json`，因此 CJS 包返回常量回退值，而 `sync-version` 保证它与 `package.json` 一致。
- `isSeaRuntime()` 通过同一个 `require` 调用 `node:sea` 的 `isSea()`，在 Node < 20.12 上返回 false。SEA 下 `createRelay()` 跳过守护进程解析与 spawn，直接落到本地 relay；已有守护进程可达时，exe 仍以瘦客户端接入。
- `skillsDir()` 在无法解析 `package.json` 时回退到 `path.dirname(process.execPath)/skills`。独立 exe 没有 skills 目录时返回现有的明确错误 “No built-in skills found”。
- `scripts/smoke-sea-package.mjs` 以忽略 stdin（立即 EOF）的方式启动打包产物，超时 30 秒，失败即非零退出。发布工作流在 `Package` 之后、`Upload release asset` 之前运行它。
- `sea-package.mjs` 与冒烟脚本在 Windows 上为缺少扩展名的 `SEA_OUTPUT_NAME` 追加 `.exe`，因此矩阵里的 `dota2-mcp-win` 变成可执行的 `dota2-mcp-win.exe`，上传 glob 仍然匹配。

## 验证

原始产物因 `createRequire` 以 1 退出。修复后：构建目录下的 exe 在有守护进程时以瘦客户端启动并退出 0；使用独立状态目录与空闲端口（无守护进程）时回退到本地 relay 并退出 0；独立复制的 exe 对 `dota2_skill` 返回明确的缺 skills 错误，而构建目录下的 exe 返回 skill 目录。`SEA_OUTPUT_NAME=dota2-mcp-win` 产出 `dist/dota2-mcp-win.exe`，冒烟脚本能找到并运行它。发布工作流的整套离线冒烟通过；`test-daemon.mjs` 在最终形态前捕获了中间的 `require` 回归。

## 备选方案

- **改为 ESM 打包。** 本次不采用：SEA 配置的主入口是 CJS 包，改格式并重新在三个平台验证 SEA 超出这次崩溃修复的范围。
- **在打包时定义 `import.meta.url`。** 否决：会把构建机路径烘进产物，而且仍需按平台分别定义。
- **只守护 `getVersion()`。** 否决：另外两处 `require.resolve` 会在 ESM 之外崩溃，所以绑定本身必须双模式。
- **按可执行文件名判断 SEA。** 否决：重命名的 `node` 会误判，而且该判断会在普通安装上悄悄改变守护进程行为。
- **把 skills 目录嵌进 SEA assets。** 暂缓：独立 exe 已能明确报告目录缺失，嵌入资产是更大的打包改动。
- **信任工作流的资产检查。** 否决：它只证明文件被上传，不证明它能运行。

## 后果

回退常量在 SEA 产物里是承重的；`sync-version` 保持它正确，`npm run check` 在它与 `package.json` 漂移时报红。exe 支持瘦客户端与本地 relay 两种模式，但不能 spawn 守护进程；独立下载不携带 skills 目录。每次发布现在会在每个平台启动一次打包产物再上传，每个 runner 多一个短命进程。

## 测试

`npm run package` 之后运行 `scripts/smoke-sea-package.mjs`——本地先复现了原来的 `exit=1`，修复后确认两种 relay 模式都是 `exit=0`。发布工作流在 Windows、Linux、macOS 附加资产前运行它；包的其余表面仍由现有离线冒烟集覆盖。

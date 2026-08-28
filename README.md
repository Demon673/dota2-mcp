# dota2-mcp

English | [中文](README.zh.md)

Connect your AI assistant directly to your Dota 2 client to help with custom game development.

`dota2-mcp` is a server built on the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). Once connected to an MCP-capable AI client (Claude Code, Cursor, etc.), the AI can — while Dota 2 is running:

- Read and send console commands
- Query the Lua / Panorama JS / CSS / event APIs
- Launch, reload, and disconnect custom game maps
- Inspect entities, modifiers, and entity scripts in the current scene
- Compile Source 2 assets

No manual copy-paste of console output — the AI pulls live information straight from the game.

## Prerequisites

- Node.js ≥ 18 (ships npx)
- Dota 2 installed and launched with `-vconsole` or `-tools`

> Once dota2-mcp detects Dota 2 it **opens vconsole automatically** and establishes the connection — no manual steps. Note: **if vconsole isn't open, the relay doesn't connect to Dota** — console tools are also unavailable, so keep the window open (this way you can watch what the AI does in the console).

## Configure the vconsole2 GUI port

Dota 2 allows only one VConsole2 client on `127.0.0.1:29000` by default. `dota2-mcp` occupies that port and forwards the GUI to `127.0.0.1:29001`, so you need to point vconsole2 there manually.

**How to open vconsole2**: **by default you don't have to do anything** — the relay opens it automatically once it detects Dota is ready (set `DOTA2_VCON_AUTO_OPEN_VCONSOLE=0` to disable). Note: **if vconsole isn't open, the relay doesn't connect to Dota** (console tools are unavailable), so keep the window open. The vconsole button in Dota 2's tools mode (AssetBrowser) is disabled by the engine only while the relay holds `29000` (i.e. while vconsole is connected); once the window closes the button works again. You can also run `{dota 2 beta}\game\bin\win64\vconsole2.exe` directly, or ask the AI to call `dota_open_vconsole`. A window opened late is backfilled with init data and works as soon as it opens.

### First-time setup

1. Open vconsole2 and find the connection/device selection area in the first row below the top toolbar.
2. Choose **Add a new device to connect.**, set the port to `29001` — after creation a new port tab appears titled `Localhost:29001` — then open the connection (**Devices → Connect**).
3. Select the default `Localhost` (i.e. `29000`) and disconnect (**Devices → Disconnect**).

After this step, vconsole2 displays the Dota 2 console normally.

### Set up auto-connect (optional)

To avoid switching ports manually every time, you can set it to auto-connect to `29001` on startup:

1. Select `Localhost:29001`, click **Devices → Properties** in the menu bar, and enable **Auto connect at startup**.
2. Switch back to the default `Localhost` (`29000`) and, also under **Devices → Properties**, disable **Auto connect at startup**.

The next time vconsole2 starts it connects to `29001` automatically and leaves `29000` alone.

If you want to use vconsole2 without MCP (connecting straight to `29000`): close Dota 2 and exit all MCP sessions; the daemon idles out after about 5 minutes and releases `29000` (the daemon does not exit while Dota 2 is running, though you can kill it manually). For everyday use, keep the GUI on `29001` to use it alongside MCP without disconnecting.

## Install and configure

**Install method: npx (the only recommended one)**. Zero installation — every client start uses the latest version automatically (the first run downloads the package, then it uses the local cache; when offline it falls back to the cached version).

### Common configuration

Every MCP-capable client takes the same config; put it in the client's `mcpServers`:

```json
"dota2": {
  "command": "npx",
  "args": ["-y", "dota2-mcp"]
}
```

### Per-client configuration

Installation has two paths; pick whichever you prefer:

- **Let the AI install it (recommended)**: send this README (or the "Common configuration" above) to your usual AI assistant and tell it to "install dota2-mcp into my client". The AI reads this section and either runs the install command (e.g. `claude mcp add ...`) or writes the matching config file itself. This tool is built for AI, so this path is smoothest — and you don't need to read the rest.
- **Install manually**: follow the subsection for your client below — entries with "Option 1" run a command; those without one (or with an Option 2) edit a config file.

**Claude Code**

- Run `claude mcp add dota2 -- npx -y dota2-mcp` from the command line; see the [Claude Code MCP docs](https://docs.anthropic.com/en/docs/claude-code/mcp) for full configuration and verification

**Claude Desktop**

- Add the common configuration to `mcpServers` and restart; see the [Claude Desktop MCP docs](https://modelcontextprotocol.io/quickstart/user) for full steps

**Cursor**

- Settings → MCP → Add new MCP server; or edit `~/.cursor/mcp.json` and add the common configuration

**VS Code (GitHub Copilot)**

- In your user `settings.json` or the workspace `.vscode/mcp.json`, write:
  ```json
  {
    "mcp": {
      "servers": {
        "dota2": { "command": "npx", "args": ["-y", "dota2-mcp"] }
      }
    }
  }
  ```

**Cline (VS Code extension)**

- Cline panel → MCP Servers → Configure MCP Servers; add the common configuration to the `mcpServers` of the opened `cline_mcp_settings.json`

**Codex CLI**

- Option 1 (recommended): run `codex mcp add dota2 -- npx -y dota2-mcp` from the command line
- Option 2: edit `~/.codex/config.toml` (TOML format):
  ```toml
  [mcp_servers.dota2]
  command = "npx"
  args = ["-y", "dota2-mcp"]
  ```
- Verify: `codex mcp list` — dota2 appears in the list with enabled true; or start a new Codex session and have the AI call `dota_status`

**Codex Desktop (Desktop App)**

- The desktop app and CLI **share the same `~/.codex/config.toml`** — there's no separate config entry; just write the TOML via Codex CLI's "Option 2" above
- After writing, **fully quit and restart the desktop app** (config is loaded at startup; it won't take effect without a restart), then start a new session and have the AI call `dota_status` to verify
- The desktop app has no MCP management UI; if you have the CLI installed you can also run `codex mcp list` to confirm the config took effect

**Other MCP clients**

- Find the MCP / mcpServers config entry and paste the common configuration.

### Post-startup verification

1. In the client, dota2 shows connected;
2. Launch Dota 2 (`-vconsole` or `-tools`);
3. Have the AI call `dota_status`: vconsole opens automatically (or is already open), and it returns the project status and next-step guidance.

### Troubleshooting connection issues

| Symptom | Fix |
|------|------|
| Client startup timeout / connection failure | First package pull is slow: change args to `["--prefer-offline", "-y", "dota2-mcp"]` (cache-first, still auto-updates; a new version may lag one cache cycle); Codex TOML can also add `startup_timeout_sec = 120` |
| Windows reports "command not found / not recognized" | Wrap with cmd: JSON clients use `"command": "cmd", "args": ["/c", "npx", "-y", "dota2-mcp"]`; Codex TOML uses `command = "cmd"`, `args = ["/c", "npx", "-y", "dota2-mcp"]` |
| Tools report "not connected to Dota 2" | Launch Dota 2 (`-vconsole` or `-tools`) |
| Tools report "vconsole not open" | It's normally opened automatically; if not, see "FAQ" below |

> Standalone executables (win/linux/mac) are still shipped with each Release, only for special cases where Node is inconvenient; use npx for everyday use.

## Available tools

| Tool | Purpose |
|------|------|
| `dota_status` | Get connection, vconsole, addon, map, and game status plus next-step suggestions. Call this first. |
| `dota_open_vconsole` | Open the vconsole2 window (console-class tools need it open). |
| `dota_launch_game` | Launch a custom game map (waits to enter the match; returns the phase and how to advance when stuck). |
| `dota_disconnect` | Disconnect the current game. |
| `dota_restart` | Reload the current map. |
| `console_send` | Send a command to the Dota 2 console. |
| `console_output` | Read console output. |
| `console_channels` | List available VConsole2 channels. |
| `console_find` | Search console commands or cvars. |
| `console_help` | View a command's help. |
| `console_gui_filter` | Control whether MCP-produced console output shows in the vconsole2 GUI (hidden by default). |
| `dota_api_lua` | Query the Lua API. |
| `dota_api_panorama_js` | Query the Panorama JS API. |
| `dota_api_css` | Query Panorama CSS properties. |
| `dota_api_events` | Query Panorama events. |
| `dota_api_help` | Query the official Lua API docs. |
| `dota_run_lua` | Execute server Lua in the running game. |
| `dota_dump_entities` | List entities in the current scene. |
| `dota_dump_modifiers` | List modifiers. |
| `dota_entity_inspect` | Inspect an entity's Lua scope. |
| `dota_compile_asset` | Compile Source 2 assets. |
| `vrf_ensure` | Ensure the VRF CLI is available (detect / download / sha256 verify / cache; offline-safe). |
| `asset_inspect` | Decompile an asset and return a structured summary. |
| `asset_check_refs` | Check a single asset's recursive reference integrity. |
| `vfx_preview` | Spawn a particle preview in-game (returns its pid). |
| `vfx_preview_stop` | Destroy preview particle instances. |
| `file_read` | Read a text file inside the addon. |
| `file_write` | Write a file inside the addon. |
| `file_edit` | Replace old_string→new_string in an addon file (exactly one match). |
| `file_delete` | Delete a file inside the addon. |
| `dota2_skill` | Retrieve built-in development skills (vfx/model formats, game phases, runtime dev). |

## FAQ

**The AI says it can't find Dota 2 — what do I do?**

Make sure Dota 2 is installed via Steam and that VConsole2 is running. The program locates the Dota 2 directory automatically via Steam appid `570` — no need to set the path manually.

**Why does the vconsole2 GUI connect to `29001`?**

Because `dota2-mcp` needs exclusive access to Dota 2's VConsole2 connection, it forwards the GUI to `29001`. This way the human developer and the AI can use the console at the same time.

**I don't want MCP output to appear in the vconsole2 GUI**

It's hidden by default. To show MCP output in the GUI temporarily, call `console_gui_filter` and set `auto: false`.

**The AI says "vconsole not open" — what do I do?**

Normally the relay opens vconsole2 automatically when it detects Dota is ready. If it isn't open: run `{dota 2 beta}\game\bin\win64\vconsole2.exe` directly, or have the AI call `dota_open_vconsole`. Note that when vconsole isn't open, console-class tools are unavailable — so keep the window open (that way you can watch what the AI does in the console). The vconsole button in AssetBrowser is inactive only while vconsole is connected — that's an engine limitation, not a fault.

## Version

Current version: `v1.6.0`

See [CHANGELOG.md](./CHANGELOG.md) and [GitHub Releases](https://github.com/Demon673/dota2-mcp/releases) for details.

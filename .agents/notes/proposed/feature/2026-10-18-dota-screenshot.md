# Agent Note: Game screenshot tool

English | [中文](2026-10-18-dota-screenshot.zh.md)

Status: proposed

## Problem

An agent testing an addon cannot see the game. When a map never loads, a phase never advances, or the console stops answering, the only evidence is console text, and live runs have shown that text can be silent about the actual state: a launch that never started, or a team-select screen the addon is waiting on. The developer then has to look at the screen and describe it. A screenshot taken through the engine console does not help in exactly these cases, because it needs a responsive game and a working console connection.

## Proposal

A `dota_screenshot` tool returns a game screenshot (see `GLOSSARY.md`): an image of the Dota 2 game window taken from outside the game.

- **Source**: Windows.Graphics.Capture on the game viewport window, the top-level `dota2.exe` window titled "Dota 2". Other tools-mode windows are out of scope. The capture never sends the game a message and never uses the console, so a hung game still yields its last composed frame.
- **Background**: the game window does not need focus or to be on top; other windows covering it are not captured; the cursor is not captured; the capture border is turned off where the OS allows.
- **Isolation**: capture runs in a child process with a hard 5 s timeout; on timeout the process is killed and the tool reports an error. The tool is not gated on vconsole and works while the relay is disconnected.
- **Helper**: a small C# capture helper compiled once on the user's machine with the .NET Framework `csc.exe` that ships with Windows, and cached under `os.tmpdir()/dota2-mcp/`, like the VRF CLI. The repository ships no binary.
- **Hung game**: when `IsHungAppWindow` reports the window as hung, the image is still returned, with `hung: true` and a note.
- **Minimized window**: with `restore` (default `true`), the tool restores the window without activating it, waits up to 2 s for a fresh frame, captures, and minimizes it again without activating it. With `restore: false` it reports that the window is minimized. If the game runs in exclusive fullscreen while minimized, the tool reports an error recommending windowed or borderless mode instead of restoring. A window that is not minimized is captured immediately, with no wait.
- **Output**: scaled to `max_width` (default 1280), encoded as `format` (`jpeg` quality 80 by default, or `png`), returned as MCP image content together with the saved file path. Files go to `os.tmpdir()/dota2-mcp/screenshots/`, keeping the 20 most recent.
- **No Dota window**: an error. The tool never falls back to capturing the screen.
- **Platforms**: Windows only; elsewhere the tool returns an error.
- **Other tools**: the stuck reports of `dota_launch_game` and `dota_advance_to_game` mention `dota_screenshot`; no tool attaches a screenshot automatically.

## Alternatives considered

- **Engine console `screenshot` / `jpeg`.** Rejected: needs a responsive game and a console connection, which are what is missing when a screenshot is most needed.
- **GDI `BitBlt` on the window DC.** Rejected: DirectX windows usually come out black, and covered regions are not captured.
- **`PrintWindow` with `PW_RENDERFULLCONTENT`.** Rejected as the primary path: it waits on the game's message loop and blocks when the game hangs. Kept as the fallback if the WGC helper cannot be built from source.
- **DXGI Desktop Duplication.** Rejected: it captures the whole monitor, including windows covering the game.
- **Shipping a prebuilt capture executable.** Rejected unless capturing a hung game proves essential and the source-compiled helper cannot work: it breaks the no-external-binary rule.
- **Restoring a minimized window and leaving it restored.** Rejected: re-minimizing returns the desktop to the state the developer left it in.

## Acceptance criteria

- Foreground, covered, and background game windows each return an image of only the game, without stealing focus.
- A game hung by a Lua infinite loop still returns an image marked `hung: true`, within the timeout.
- A minimized window is restored without activation, captured, and minimized again; with `restore: false` the tool reports it is minimized.
- With no `dota2.exe` window, the tool returns an error and captures nothing.
- An offline test covers the tool's error paths and output handling without Dota.

## Risks

- Unverified: whether `csc.exe` can reference the WinRT metadata WGC needs, and whether the capture border can be disabled. If the helper cannot be built, the fallback loses capture of a hung game.
- Unverified: what WGC returns once Windows replaces a hung window with its "not responding" ghost.
- Restoring a minimized window flashes it on screen briefly. Exclusive-fullscreen detection may not be reliable; the documented fallback is to recommend windowed or borderless mode.
- Images cost the agent tokens; the default size limits the cost but does not remove it.

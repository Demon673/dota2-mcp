# Agent Note: Game screenshot tool

English | [中文](2026-10-18-dota-screenshot.zh.md)

Status: implemented

## Problem

An agent testing an addon cannot see the game. When a map never loads, a phase never advances, or the console stops answering, the only evidence is console text, and live runs have shown that text can be silent about the actual state: a launch that never started, or a team-select screen the addon is waiting on. The developer then has to look at the screen and describe it. A screenshot taken through the engine console does not help in exactly these cases, because it needs a responsive game and a working console connection.

## Decision

`dota_screenshot` returns a game screenshot (see `GLOSSARY.md`): an image of the Dota 2 game window taken from outside the game. Spec: issue #12.

- **Source**: Windows.Graphics.Capture on the game viewport window, the visible top-level `dota2.exe` window titled "Dota 2". Other tools-mode windows are out of scope. The capture never sends the game a message and never uses the console.
- **Background**: the window needs no focus and need not be on top; windows covering it are not captured. Cursor capture and the capture border are turned off where the OS supports it; both properties are set by reflection, because older Windows 10 metadata lacks them and naming them would fail compilation there.
- **Helper**: C# source embedded in the TypeScript module, compiled asynchronously on first use (a cold compile does not block the MCP server) with the .NET Framework `csc.exe` that ships with Windows and cached under `os.tmpdir()/dota2-mcp/capture/<source hash>/`. It references only the GAC facades and the split WinRT metadata in `System32\WinMetadata` that every Windows 10/11 has. The `System.Runtime.WindowsRuntime` await and event helpers need the SDK-only unified `Windows.winmd`, so the helper wraps WinRT async calls itself and polls the free-threaded frame pool instead of subscribing to `FrameArrived`. Each compiler writes its own source and output file and renames into the cache; a session that loses the race uses the cached exe. The repository ships no binary.
- **Protocol**: `helper <outPath> <maxWidth> <jpeg|png> <restore 0|1>`, or `helper --minimize`, prints JSON lines on UTF-8 stdout; the last is the result: `ok`, `width`, `height`, `hung`, `restored`, or `ok: false` with `error` (`no_window`, `minimized`, `no_frame`, `internal`) and `message`. Before restoring a minimized window it prints `{"restoring":true}`. `DOTA2_CAPTURE_HELPER` replaces the helper (a `.js`/`.mjs` path runs under the current node); this is the one seam the offline test replaces.
- **Isolation**: the helper runs as a child process with a 5 s timeout, killed on expiry. A killed helper cannot run its own re-minimize, so when it had printed `restoring` the tool runs `helper --minimize` to minimize the window again without activating it. A failed capture deletes its output file. The tool is not gated on vconsole and works while the relay is disconnected.
- **Hung game**: `IsHungAppWindow` true → the image is returned with `hung: true` and a note.
- **Minimized window**: with `restore` (default `true`) the helper restores the window with `SW_SHOWNOACTIVATE`, drops frames for 300 ms, waits up to 2 s for a frame, captures, and re-minimizes with `SW_SHOWMINNOACTIVE`. A window that is not minimized is captured at once. With `restore: false`, or when the saved video settings say exclusive fullscreen (`setting.fullscreen "1"`), a minimized window is reported instead of restored.
- **Output**: scaled to `max_width` (default 1280), `jpeg` quality 80 by default or `png`, returned as MCP image content plus the saved path. Files go to `os.tmpdir()/dota2-mcp/screenshots/` (`DOTA2_SCREENSHOT_DIR` overrides), keeping the 20 most recent; pruning touches only file names the tool itself generates.
- **No Dota window**: an error; the screen is never captured instead. **Platforms**: Windows only.
- **Other tools**: the shared stuck report mentions `dota_screenshot`; no tool attaches a screenshot automatically.

## Alternatives considered

- **Engine console `screenshot` / `jpeg`.** Rejected: needs a responsive game and a console connection, which are what is missing when a screenshot is most needed.
- **GDI `BitBlt` on the window DC.** Rejected: DirectX windows usually come out black, and covered regions are not captured.
- **`PrintWindow` with `PW_RENDERFULLCONTENT`.** Rejected: it waits on the game's message loop and blocks when the game hangs. It was the planned fallback if the WGC helper could not be built from source; it was not built, because the source build works on a stock Windows 11 install. Where the build fails, the tool returns an error with the compiler output and no screenshot.
- **DXGI Desktop Duplication.** Rejected: it captures the whole monitor, including windows covering the game.
- **Shipping a prebuilt capture executable.** Rejected: it breaks the no-external-binary rule, and the source build makes it unnecessary.
- **Restoring a minimized window and leaving it restored.** Rejected: re-minimizing returns the desktop to the state the developer left it in.

## Consequences

Bought: one call shows the agent the game screen, about 0.35 s per capture (0.6 s on the first call, including compilation), with no console, vconsole, or focus involved. Cost: Windows only; the first call needs the system `csc.exe`, verified on one Windows 11 machine; a restored minimized window flashes briefly; images cost the agent tokens, limited by the default width. The exclusive-fullscreen check reads saved settings, so a mode changed in game but not saved is not seen.

## Testing

- `scripts/test-screenshot.mjs` (offline, runs on Windows and Linux): drives the real MCP server through stdio with `DOTA2_CAPTURE_HELPER` pointing at a fake node helper. It asserts image content and the saved path, that `max_width`/`format`/`restore` reach the helper and their defaults, the `hung: true` flag, a restored minimized window, the `restore: false`, no-window and timeout errors, re-minimizing after a timeout that followed a restore, no partial file after a failure, a tool error when the reported image is missing, and that only the 20 newest of its own files are kept — all with no Dota, vconsole, or relay connection. In process it also asserts the exclusive-fullscreen error from a fake `video.txt`, the real `dota2.exe` path in the no-window error, the launch-failure cause, and, on non-Windows runners, the Windows-only error.
- Live (Windows 11, Dota 2 with `-tools`): the system `csc.exe` compiled the helper; captures of the main-menu window returned 1280×741 JPEG and 640×370 PNG images of only the game viewport, with the developer's foreground window unchanged.

Not covered: Dota 2 ignored outside minimize requests (`SW_SHOWMINNOACTIVE` and `WM_SYSCOMMAND SC_MINIMIZE`), so the restore path has been run only against the fake helper; capturing a hung game, the image WGC returns once Windows swaps in a "not responding" ghost, and whether the capture border is actually hidden are not yet verified live.

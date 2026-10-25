# Dota 2 custom game development

English | [中文](GLOSSARY.zh.md)

This glossary defines the domain terms used when developing Dota 2 custom games with dota2-mcp.

## Language

### Custom games

**addon**: A Dota 2 custom game project containing its gameplay, maps, and assets. _Avoid_: plugin.

**map**: A playable environment within an addon.

**game-rules phase**: A stage of a match's setup or progression, such as hero selection or active play. A game-rules phase is distinct from whether the map is loaded.

**particle preview**: A particle instance created in a running game to inspect an effect. The preview is a runtime instance, distinct from the particle asset that defines it.

**game screenshot**: An image of the Dota 2 game window taken from outside the game, so it is available even when the game does not respond. Distinct from a screenshot the engine takes itself.

### Console access

**VCon**: The console protocol or connection used to exchange commands and output with the Dota 2 engine.

**vconsole**: The developer's VConsole2 GUI window.

**vconsole2**: The engine's VConsole2 application, whose window is called vconsole.

**relay**: The intermediary that shares access to the engine's console between AI clients and vconsole. _Avoid_: daemon when referring to the intermediary rather than its host process.

**daemon**: The independent background process that hosts the relay and can serve multiple MCP sessions. _Avoid_: relay when referring to the host process rather than the intermediary.

**thin client**: An MCP session's console client that accesses the engine through the shared daemon.

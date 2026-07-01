# @psiddharthdesign/hypermotion

CLI + MCP server for [hyper-motion](https://hypermotion.app). Render the
current desktop scene from the terminal, and let AI coding agents
(Claude Code, Codex, Cursor, etc.) drive renders programmatically.

> **Comprehensive guide** — install steps, all flags, every supported
> agent, what works today vs. roadmap, and troubleshooting — lives at
> [AGENTS.md](https://github.com/psiddharthdesign/hypermotion/blob/main/AGENTS.md)
> in the main repo. The summary below is a quick-reference; AGENTS.md
> is the source of truth.

## Install

```sh
pnpm add -g @psiddharthdesign/hypermotion
# or
npm install -g @psiddharthdesign/hypermotion
```

This installs two binaries on your PATH:

- `hypermotion` — interactive CLI for humans.
- `hypermotion-mcp` — Model Context Protocol server for AI agents.

You also need the [hyper-motion desktop app](https://hypermotion.app)
installed — the CLI uses it under the hood to run the export pipeline.

## CLI usage

```sh
# Render the current desktop scene to MP4
hypermotion render -o out.mp4

# WebM at 720p, 60fps
hypermotion render -o out.webm -q 720p --fps 60

# 4K MP4
hypermotion render -o out.mp4 -q 4k

# Render a saved .hype scene file
hypermotion render --scene intro.hype -o intro.mp4
```

Quality presets: `comp` (matches the scene canvas — fastest), `720p`,
`2k` (2560×1440), `4k` (3840×2160). Default: `comp`.

Render targets whichever scene is currently loaded in your desktop app.
To script a scene from JSON, build a `.hype` file with
`hypermotion create`, inspect it with `hypermotion info`, and pass it to
the installed desktop app with `hypermotion render --scene <path>`.

## MCP server — AI agent integration

### Claude Code

```sh
claude mcp add -s user hypermotion -- hypermotion-mcp
```

Then in Claude Code, the agent has access to:

- **`doctor`** — check desktop app and CLI environment health.
- **`get_capabilities`** — list supported formats, quality presets, patch operations, and scene features.
- **`create_scene`** — build a `.hype` scene file from a JSON description.
- **`info_scene`** — read `.hype` scene metadata.
- **`inspect_scene`** — inspect a saved scene's structural contents.
- **`patch_scene`** — create a patched copy of an existing scene.
- **`validate_scene`** — validate a saved `.hype` scene's structure.
- **`list_layers`**, **`get_layer`**, **`list_tracks`**, and **`list_cameras`** — query saved scene contents.
- **`open_scene`** — open a saved scene in the desktop app.
- **`render_scene`** — render to MP4 / WebM / GIF, optionally from a `.hype` scene path.
- **`list_keyframeable_properties`** — list animatable property identifiers.

### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.hypermotion]
command = "hypermotion-mcp"
```

### Any other MCP-compatible agent

Spawn `hypermotion-mcp` as a subprocess. The server speaks MCP over
stdio per the [Model Context Protocol spec](https://modelcontextprotocol.io).

## Current scope

What works today:

- `hypermotion render -o out.mp4` — renders the desktop app's current scene.
- `hypermotion create out.hype --from scene.json` — builds a scene file.
- `hypermotion info out.hype` — prints scene metadata.
- `hypermotion inspect`, `patch`, `validate`, and `open` — inspect,
  modify, verify, and launch saved `.hype` scenes.
- `hypermotion doctor` and `serve` — check local setup and run the MCP server.
- `hypermotion-mcp` — registers + responds to MCP clients.
- MCP tools for scene authoring, inspection, patching, validation,
  querying, opening, rendering, diagnostics, and capability discovery.

What's longer-term:

- Chapter / range rendering and batch workflows.

## How rendering works

The CLI doesn't render frames itself. It locates the installed
hyper-motion desktop app and spawns it with command-line flags that put
it into a headless render mode. The desktop app boots a hidden render
window, the renderer waits for the scene to hydrate, the export pipeline
captures frames and encodes them for the requested format, and the
rendered bytes ship back through IPC.
The CLI writes them to your output path.

Locations checked, in order:

- `$HYPERMOTION_APP_PATH` (env override, if set)
- macOS: `/Applications/hyper-motion.app/...`, then `~/Applications/...`
- Windows: `%ProgramFiles%\hyper-motion\hyper-motion.exe`, then
  `%LOCALAPPDATA%\Programs\hyper-motion\...`
- Linux: `/opt/hyper-motion/...`, `/usr/bin/hyper-motion`, AppImage in
  `~/Applications`

If the app isn't installed, the CLI exits with a clean message
pointing you at the download page.

## Develop

```sh
pnpm install
pnpm run build   # tsc → dist/
pnpm run test    # build + node:test coverage
pnpm run dev     # tsc --watch
```

Run a built binary directly:

```sh
node ./bin/hypermotion.mjs --help
node ./bin/hypermotion-mcp.mjs   # talks MCP on stdio — use a client to test
```

## License

Licensed under the [Apache License, Version 2.0](./LICENSE). See
[NOTICE](./NOTICE) for the copyright statement.

Copyright 2026 Siddharth Ponnapalli.

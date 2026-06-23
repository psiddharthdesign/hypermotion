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
```

Quality presets: `comp` (matches the scene canvas — fastest), `720p`,
`2k` (2560×1440), `4k` (3840×2160). Default: `comp`.

Render targets whichever scene is currently loaded in your desktop app's
IndexedDB — i.e. whatever you last edited. You can also create and inspect
`.hype` scene files from the CLI.

## MCP server — AI agent integration

### Claude Code

```sh
claude mcp add hypermotion -- hypermotion-mcp
```

Then in Claude Code, the agent has access to:

- **`create_scene`** — build a `.hype` scene file from JSON.
- **`render_scene`** — render the current desktop scene to MP4 / WebM / GIF.
- **`info_scene`** — read `.hype` scene metadata.

### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.hypermotion]
command = "hypermotion-mcp"
```

### Any other MCP-compatible agent

Spawn `hypermotion-mcp` as a subprocess. The server speaks MCP over
stdio per the [Model Context Protocol spec](https://modelcontextprotocol.io).

## v0.1.2 scope

What works today:

- `hypermotion render -o out.mp4` — renders the desktop app's current scene.
- `hypermotion create out.hype --from scene.json` — builds a scene file.
- `hypermotion info out.hype` — prints scene metadata.
- `hypermotion-mcp` — registers + responds to MCP clients.
- `render_scene` MCP tool — renders the current scene.
- `create_scene` and `info_scene` MCP tools — build and inspect `.hype`
  scene files.

What's longer-term:

- In-place scene modification and partial/range rendering.

## How rendering works

The CLI doesn't render frames itself. It locates the installed
hyper-motion desktop app and spawns it with command-line flags that put
it into a headless render mode. The desktop app boots an off-screen
window, the renderer waits for the scene to hydrate from IndexedDB,
the existing export pipeline runs (`webContents.capturePage` →
WebCodecs → mp4-muxer), and the rendered bytes ship back through IPC.
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

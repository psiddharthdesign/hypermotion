# Using hyper-motion from the terminal and from AI agents

hyper-motion ships a CLI and a Model Context Protocol (MCP) server so you
can drive renders from a script, a CI job, or an AI coding agent. This
document is the canonical guide.

The CLI's only job today is to render the scene currently loaded in the
desktop app. Future versions will accept scene files and let agents
author scenes from scratch (see [Roadmap](#roadmap)).

---

## Install

### 1. Install the desktop app

Download the latest `.dmg` from
[github.com/psiddharthdesign/hypermotion/releases](https://github.com/psiddharthdesign/hypermotion/releases)
and install it. v0.1.x is unsigned — after dragging to `/Applications`,
run:

```sh
xattr -cr /Applications/hyper-motion.app
codesign --force --deep --sign - /Applications/hyper-motion.app
```

Then double-click. Full reasoning + alternatives in the
[main README's install section](https://github.com/psiddharthdesign/hypermotion#install-macos).

Windows build is not shipping yet — coming in a later v0.1.x release.

The CLI uses the installed desktop app to actually run renders — it
doesn't ship its own render engine. If the app isn't installed, the CLI
exits with a clean message pointing you back here.

### 2. Install the CLI

```sh
pnpm add -g @psiddharthdesign/hypermotion
# or
npm install -g @psiddharthdesign/hypermotion
```

This puts two binaries on your `$PATH`:

- `hypermotion` — interactive CLI for humans.
- `hypermotion-mcp` — MCP server for AI agents.

Requires Node 20+.

### 3. Verify

```sh
hypermotion --version
# 0.1.0

hypermotion render --help
```

---

## CLI — direct human usage

### Render the current scene

```sh
# Open the desktop app, design a scene, let it auto-save (IndexedDB).
# Then from terminal:
hypermotion render -o demo.mp4
```

The CLI spawns the desktop app off-screen (or in the background if your
editor is already open — see [How it works](#how-it-works)), drives the
existing export pipeline, and writes the file.

### Format and quality

```sh
# Format inferred from the extension
hypermotion render -o demo.webm
hypermotion render -o demo.gif

# Explicit format
hypermotion render -o out.mp4 -f mp4

# Quality presets
hypermotion render -o out.mp4 -q comp     # match scene canvas (fastest, default)
hypermotion render -o out.mp4 -q 720p     # 1280 × 720
hypermotion render -o out.mp4 -q 2k       # 2560 × 1440
hypermotion render -o out.mp4 -q 4k       # 3840 × 2160

# Frame rate
hypermotion render -o out.mp4 --fps 60
```

### Environment variables

`HYPERMOTION_APP_PATH` — override the desktop app's location if it's not
in the standard places. Useful when testing a dev build from your repo.

```sh
export HYPERMOTION_APP_PATH=/Applications/hyper-motion.app/Contents/MacOS/hyper-motion
hypermotion render -o test.mp4
```

`HYPERMOTION_VERBOSE` — set to `1` to stream the desktop app's stderr
through the CLI. Essential for debugging renders that hang or fail.

```sh
HYPERMOTION_VERBOSE=1 hypermotion render -o test.mp4
```

---

## MCP integration — AI coding agents

The CLI ships an MCP server (`hypermotion-mcp`) that speaks the
[Model Context Protocol](https://modelcontextprotocol.io) over stdio.
Any MCP-compatible agent can register it and call its tools.

### Tools registered

| Tool           | Status   | What it does                                                                  |
|----------------|----------|-------------------------------------------------------------------------------|
| `render_scene` | ✅ v0.1.0 | Renders the current desktop scene to MP4 / WebM / GIF at the chosen quality. |
| `info_scene`   | 🚧 v0.1.1 | Will read scene metadata from a `.arnimotion` file. Ships with file format.  |

### Claude Code

Register the server at user scope (available from any project):

```sh
claude mcp add -s user hypermotion -- hypermotion-mcp
```

Add environment variables if you've put the desktop app somewhere
non-standard, or want verbose logs:

```sh
claude mcp add -s user hypermotion \
  --env HYPERMOTION_APP_PATH=/Applications/hyper-motion.app/Contents/MacOS/hyper-motion \
  --env HYPERMOTION_VERBOSE=1 \
  -- hypermotion-mcp
```

Verify:

```sh
claude mcp list
# hypermotion: hypermotion-mcp — ✓ Connected
```

Then in any Claude Code session, ask things like:

- "Render the current hyper-motion scene to `~/Desktop/demo.mp4`."
- "Render the current scene to `~/Desktop/demo.mp4` at 4K, 60fps."
- "Render the scene as a WebM at 2K."

### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.hypermotion]
command = "hypermotion-mcp"

# Optional environment overrides
[mcp_servers.hypermotion.env]
HYPERMOTION_APP_PATH = "/Applications/hyper-motion.app/Contents/MacOS/hyper-motion"
HYPERMOTION_VERBOSE = "1"
```

### Cursor and other MCP clients

Any agent that can spawn a stdio MCP subprocess can use hypermotion.
Point it at the `hypermotion-mcp` binary (which resolves on `$PATH`
after global install) and the agent will discover the tools.

### Prompts that work well today

The CLI's v0.1.0 capability is "render the current scene." Prompts that
match that shape work cleanly:

- "Render the current scene to `<path>`." ✅
- "Render the current scene to `<path>` at 4K." ✅
- "Render the current scene as a 60fps WebM." ✅

Prompts that **don't** work yet (these are on the roadmap):

- "Create a scene with three rectangles and animate them." ❌ — no
  scene authoring API yet. Agents can render scenes you designed in
  the desktop app, not author them programmatically.
- "Render the scene at `~/path/to/scene.arnimotion`." ❌ — `.arnimotion`
  file format ships in v0.1.1.
- "Render only chapters 1 and 3." ❌ — CLI doesn't accept range/chapter
  flags yet. Use the desktop app's chapter picker, render the result.

---

## How it works

The CLI doesn't render frames itself. It locates the installed desktop
app and spawns it with command-line flags that put it into headless
render mode:

```
hyper-motion --render --out=<path> --format=<fmt> --quality=<q> --fps=<n>
```

### Single-instance lock

Electron's `app.requestSingleInstanceLock` ensures only one
hyper-motion process exists at a time. When the CLI spawns the binary:

- **If no editor is running:** the spawned process becomes the first
  instance, opens an off-screen window, runs the export, exits.
- **If your editor IS already running:** the spawned process loses the
  lock and exits immediately. The OS forwards the new process's argv
  to the running editor via the `second-instance` event. The editor
  parses the headless flags, runs the export against its currently-
  loaded scene, and continues running normally.

In both cases the rendered file is written to your output path. **No
need to quit the editor before asking an agent to render.**

### Sentinel polling

The CLI doesn't wait for the spawned process to exit (in second-
instance mode it exits in ~100ms before the render even starts).
Instead it polls for a sentinel file at `<output>.done`, which the main
process writes once the render is complete. When the sentinel appears,
the CLI cleans it up and reports success.

### Why `--key=value` argv form

The CLI emits flags as `--key=value` (single arg), not `--key value`
(two args). This is because Electron's `second-instance` event delivers
argv pre-processed by Chromium's `CommandLine` class, which drops bare
values between switches but preserves `--key=value` intact. If you ever
add new flags to the CLI, follow the same form.

---

## Troubleshooting

### "hyper-motion desktop app not found"

The CLI couldn't find the installed app. Either:

- Install it from
  [github.com/psiddharthdesign/hypermotion/releases](https://github.com/psiddharthdesign/hypermotion/releases),
  drag the `.app` to `/Applications` (Mac) or run the installer (Win).
- Or set `HYPERMOTION_APP_PATH` to the binary inside the app bundle:
  ```sh
  export HYPERMOTION_APP_PATH=/Applications/hyper-motion.app/Contents/MacOS/hyper-motion
  ```

### "× Failed to connect" in `claude mcp list`

The MCP server registered, but Claude can't spawn the binary. Causes:

- `hypermotion-mcp` isn't on `$PATH`. Reinstall globally or use the
  absolute path when registering:
  ```sh
  claude mcp add -s user hypermotion -- /full/path/to/hypermotion-mcp
  ```
- The binary's first line isn't `#!/usr/bin/env node`. Should be
  installed correctly by npm; if you're running from source, check
  `bin/hypermotion-mcp.mjs`.

### Render hangs forever

Run with verbose mode to see what the desktop app is doing:

```sh
HYPERMOTION_VERBOSE=1 hypermotion render -o test.mp4
```

Common patterns to look for in the output:

- `Failed to open LevelDB database ... LOCK` → IDB lock contention.
  Should NOT happen with the single-instance lock (v0.1.0+); if you
  see it, the running editor is probably an older build without the
  fix. Reinstall the desktop app.
- No second-instance log when an editor is running → `single-instance
  lock` isn't engaging. Same fix: reinstall the desktop app.
- `Unknown export format: --quality` → CLI is older than the desktop
  app's argv parser. Update the CLI: `pnpm add -g
  @psiddharthdesign/hypermotion@latest`.

### MCP call works in terminal but agent says "Render failed"

Most common cause: Claude Code spawns the MCP server as a subprocess
without your interactive shell env. If your terminal has
`HYPERMOTION_APP_PATH` exported, Claude's subprocess won't see it.

Fix: bake the env into the MCP registration:

```sh
claude mcp remove hypermotion
claude mcp add -s user hypermotion \
  --env HYPERMOTION_APP_PATH=/Applications/hyper-motion.app/Contents/MacOS/hyper-motion \
  -- hypermotion-mcp
```

Or just drag the app into `/Applications` so the default locator finds
it without env hints.

---

## Roadmap

### v0.1.1 — `.arnimotion` file format

Saves and loads scenes as files. Unlocks:

- `hypermotion render scene.arnimotion -o out.mp4` — render arbitrary
  scenes from disk.
- `hypermotion info scene.arnimotion` — print scene metadata.
- `info_scene` MCP tool works end-to-end.

The file format is `Y.encodeStateAsUpdate(doc)` bytes — i.e. a
serialized Yjs document. Gzipped, with `.arnimotion` extension.

### v0.1.2+ — Scene authoring API

Lets agents create and modify scenes programmatically rather than only
rendering ones a human designed. Likely shape:

```ts
// Hypothetical
const scene = createScene({ name: 'Demo', canvas: { width: 1920, height: 1080 } })
scene.addLayer({ type: 'rect', name: 'Hero card', ... })
scene.addKeyframe({ layer: 'Hero card', property: 'opacity', time: 0, value: 0 })
scene.addKeyframe({ layer: 'Hero card', property: 'opacity', time: 1, value: 1 })
scene.save('demo.arnimotion')
```

Exposed through the CLI as `hypermotion new <name>` and through MCP as
`create_scene`, `add_layer`, `add_keyframe`, etc.

### Later — chapter / range rendering, batch rendering, headless watch mode

Likely v0.2.x once the above lands. Track or propose in
[GitHub Discussions](https://github.com/psiddharthdesign/hypermotion/discussions).

---

## Contributing

The CLI source lives in [`cli/`](./cli) inside this repo. Patches
welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR.

## License

Apache 2.0. See [LICENSE](./LICENSE).

# Using hyper-motion from the terminal and from AI agents

hyper-motion ships a CLI and a Model Context Protocol (MCP) server so you
can drive renders from a script, a CI job, or an AI coding agent. This
document is the canonical guide.

The CLI can render the scene currently loaded in the desktop app, create
`.hype` scene files from JSON, inspect saved scenes, and render saved
scene files.

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
| `create_scene` | ✅ v0.1.2 | Build a `.hype` scene file from a JSON description. Authoring entrypoint.    |
| `render_scene` | ✅ v0.1.0 | Renders the current desktop scene to MP4 / WebM / GIF at the chosen quality. |
| `info_scene`   | ✅ v0.1.2 | Read a `.hype` file and return canvas, duration, layer/track/section counts. |

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

Render the open scene:

- "Render the current scene to `<path>`." ✅
- "Render the current scene to `<path>` at 4K." ✅
- "Render the current scene as a 60fps WebM." ✅

Author from scratch (v0.1.2):

- "Create a Hyper Motion scene with a card that fades in, and render it." ✅
- "Build a 1080×1920 vertical scene with three buttons in a row using auto layout, save as `~/Desktop/buttons.hype`." ✅
- "Make a calendar grid (5×7 cells, auto-layout) and animate each cell with a staggered fade-in." ✅

Inspect a scene (v0.1.2):

- "What's in `~/Desktop/intro.hype`?" ✅ (`info_scene`)
- "How long is `~/Desktop/intro.hype`?" ✅

Still on the roadmap:

- "Modify the existing `<path>.hype` and re-render." ❌ — agents can `info` + `create` + `render`, but not in-place edit yet.
- "Render only chapters 1 and 3." ❌ — CLI doesn't accept range/chapter flags yet.

---

## Authoring scenes — the `create_scene` JSON schema

Agents call `create_scene` with `{ output, scene }`. The `scene` is a
JSON object — same shape the desktop app uses internally, slightly
simplified for terminal use. Required pieces: at least one frame node
to be the artboard, optionally a camera, and any children you want
inside the frame.

### Minimal example

A single-frame artboard with a title:

```json
{
  "meta": {
    "name": "Hello",
    "duration": 5,
    "frameRate": 60,
    "canvas": { "width": 960, "height": 540 }
  },
  "nodes": {
    "root": {
      "id": "root",
      "kind": "frame",
      "parent": null,
      "children": ["title"],
      "size": { "width": 960, "height": 540 },
      "layout": {
        "mode": "flex",
        "direction": "column",
        "justify": "center",
        "align": "center",
        "padding": { "top": 24, "right": 24, "bottom": 24, "left": 24 }
      },
      "appearance": {
        "opacity": 1,
        "fill": { "kind": "solid", "color": "#f4f4f5" },
        "stroke": null,
        "cornerRadius": 0,
        "effects": []
      }
    },
    "title": {
      "id": "title",
      "kind": "text",
      "parent": "root",
      "text": "Hello, hyper-motion",
      "fontFamily": "Inter",
      "fontSize": 48,
      "fontWeight": 700,
      "color": "#0a0a0c"
    },
    "camera": {
      "id": "camera",
      "kind": "camera",
      "parent": null,
      "transform": { "x": 480, "y": 270, "z": 0, "rotation": 0, "scaleX": 1, "scaleY": 1 }
    }
  }
}
```

### Node kinds

| Kind     | Required extra fields                                                                 |
|----------|---------------------------------------------------------------------------------------|
| `frame`     | `size`, `layout`                                                                   |
| `rect`      | `size` (filled background unless `appearance.fill` is null)                        |
| `ellipse`   | `size`                                                                             |
| `text`      | `text`, `fontFamily`, `fontSize` (default Inter / 16 / weight 400)                 |
| `image`     | `src` (data URL or absolute path), `size`, `fit`                                   |
| `camera`    | `transform` (position is the camera pivot — typically canvas centre)               |
| `video` / `audio` | `src`, `duration`, `volume` — for sequences with media; rarely used by agents |

### Layout

Frames default to `mode: 'none'` (Figma's "no auto-layout"). For
anything you'd lay out by hand, set `mode: 'flex'` and the kids stack
according to `direction / justify / align / gap / padding`. Grid mode
(`mode: 'grid'`) takes `columns`, `rowGap`, `columnGap` instead.

Children specify themselves as either `width: 'fill'` (take the
remaining slot), `width: 'hug'` (size to content), or a fixed number.
The same for `height`.

### Appearance

Every paintable node carries:

```json
{
  "opacity": 1,
  "fill": null | { "kind": "solid", "color": "#hex" } | { "kind": "linear", "stops": [...], "angle": 0 },
  "stroke": null | { "color": "#hex", "width": 1, "align": "inside", "style": "solid", "dashLength": 0, "dashGap": 0 },
  "cornerRadius": 0,
  "effects": []
}
```

Backwards-compatible with the desktop app's inspector — the same
schema renders inside the editor exactly as it does in the saved file.

### Animation tracks

A `tracks` map at the top of the scene drives keyframe animation:

```json
{
  "tracks": {
    "fade-title": {
      "id": "fade-title",
      "nodeId": "title",
      "propertyId": "appearance.opacity",
      "defaultEasing": "ease-out",
      "keyframes": [
        { "id": "k1", "time": 0,    "value": 0 },
        { "id": "k2", "time": 0.5,  "value": 1 }
      ]
    }
  }
}
```

PropertyIds you can keyframe:

```
transform.x, transform.y, transform.z, transform.rotation,
transform.rotationX, transform.rotationY, transform.scaleX, transform.scaleY,
appearance.opacity, appearance.cornerRadius, appearance.fill,
layout.gap, layout.padding.top, layout.padding.right, layout.padding.bottom,
layout.padding.left, layout.direction, size.width, size.height, variant
```

EasingKind: `'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | { bezier: [x1, y1, x2, y2] } | { spring: { stiffness, damping, mass } }`.

### Stagger pattern

For a Jitter-style staggered entry on N children:

```json
{
  "tracks": {
    "fade-1": { "id": "fade-1", "nodeId": "child-1", "propertyId": "appearance.opacity",
                "defaultEasing": "ease-out",
                "keyframes": [{ "id":"a","time":0.0,"value":0}, {"id":"b","time":0.4,"value":1}] },
    "fade-2": { "id": "fade-2", "nodeId": "child-2", "propertyId": "appearance.opacity",
                "defaultEasing": "ease-out",
                "keyframes": [{ "id":"a","time":0.1,"value":0}, {"id":"b","time":0.5,"value":1}] },
    "fade-3": { "id": "fade-3", "nodeId": "child-3", "propertyId": "appearance.opacity",
                "defaultEasing": "ease-out",
                "keyframes": [{ "id":"a","time":0.2,"value":0}, {"id":"b","time":0.6,"value":1}] }
  }
}
```

Each child gets its own track on `appearance.opacity`, offset by `0.1s`
per index. Same pattern for slide-in (`transform.x` or `transform.y`)
or pop (`transform.scaleX` + `transform.scaleY`).

### Full author + render workflow

```
1. create_scene({ output: '/tmp/calendar.hype', scene: { ... } })
2. render_scene({ scene: '/tmp/calendar.hype', output: '~/Desktop/cal.mp4',
                  format: 'mp4', quality: '2k', fps: 60 })
```

Or from the terminal:

```sh
cat scene.json | hypermotion create ~/Desktop/calendar.hype --from -
hypermotion info ~/Desktop/calendar.hype
hypermotion render ~/Desktop/calendar.hype ~/Desktop/calendar.mp4 --quality 2k --fps 60
```

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

### Later — in-place editing, chapter / range rendering, batch rendering, headless watch mode

Likely v0.2.x. Track or propose in
[GitHub Discussions](https://github.com/psiddharthdesign/hypermotion/discussions).

---

## Contributing

The CLI source lives in [`cli/`](./cli) inside this repo. Patches
welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR.

## License

Apache 2.0. See [LICENSE](./LICENSE).

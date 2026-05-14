# hyper-motion

> A motion design tool with Figma's layout brain.

[hypermotion.app](https://hypermotion.app) · open source · Apache 2.0 · Mac and Windows

Jitter excels at the timeline. Figma excels at layout. hyper-motion is
the first to bring them together. Auto-layout containers that push
siblings around when content changes. Keyframes that target semantic
properties (variant state, opacity, scale, gap, padding) — not raw `x`
and `y`. When the design moves, the animation survives.

Plus everything you expect from a Jitter-class tool: a real timeline,
in/out presets, easing curves, 3D camera with depth-of-field, MP4 / WebM
/ GIF / Lottie export.

## Status — v0.1.0 research preview

The semantic-layout-animation bet works end-to-end. Real users haven't
validated it yet — that's the next milestone. Expect rough edges.

## Install

Download the latest release from
[github.com/psiddharthdesign/hypermotion/releases](https://github.com/psiddharthdesign/hypermotion/releases).

### macOS

```sh
# 1. Open the .dmg and drag hyper-motion to /Applications
# 2. Run this once in Terminal — strips the download quarantine attribute:
xattr -cr /Applications/hyper-motion.app

# 3. Open the app from Applications
```

**Why step 2?** hyper-motion v0.1.x ships unsigned. macOS Sequoia / Sonoma
flag any unsigned download as "damaged and can't be opened" before they
even check what's inside. `xattr -cr` removes the
`com.apple.quarantine` attribute that Safari / Brave / Chrome adds to
downloaded files — once that's gone, the app opens normally. This is a
one-time setup per install. Apple Developer signing + notarization
(which removes this step entirely) is on the v0.2 roadmap.

### Windows

Download the `.exe` and run it. Windows SmartScreen will warn — click
**"More info"** → **"Run anyway"**. Unsigned on Windows too for the
v0.1.x series.

### Build from source

If you'd like to skip the install warnings entirely, build locally — no
quarantine attribute is added to locally-built apps.

```sh
git clone https://github.com/psiddharthdesign/hypermotion.git
cd hypermotion
pnpm install
pnpm build:dir
open release/mac-arm64/hyper-motion.app
```

## What's in v0.1.0

- **Semantic keyframes.** Animate variant, opacity, scale, rotation, gap,
  padding — never raw `x` / `y`. Layouts can shift without breaking
  timing.
- **Auto-layout containers.** Flex with gap, padding, alignment. Same
  model designers think in from Figma.
- **3D camera** — X / Y / Z position, three-axis rotation, real
  depth-of-field with aperture and focus distance.
- **Timeline with chapters** — named sections you can isolate, loop,
  and export individually or concatenated.
- **Pixel-correct export.** MP4 up to 4K (WebCodecs + mp4-muxer), WebM
  via tab capture, GIF via gifenc. Captured directly from the renderer
  — no screen-recording compromise.
- **Figma import** — plugin that brings frames, text, layout sizing,
  per-corner radii, individual stroke weights, and layout grids into the
  canvas.
- **AI-driveable** — included CLI + Model Context Protocol server. Claude
  Code, Codex CLI, and any MCP-compatible agent can render scenes from
  the terminal. See [`cli/README.md`](./cli/README.md).
- **Open source from day one.** Apache 2.0. Yjs-backed data model so
  real-time collab arrives without a rewrite.

See [RELEASES.md](./RELEASES.md) for the full v0.1.0 notes and the
v0.1.1 roadmap.

## CLI + AI agents

hyper-motion ships a CLI and an MCP server so you can drive renders from
a script, a CI job, or an AI coding agent (Claude Code, Codex, Cursor,
etc.).

```sh
pnpm add -g @psiddharthdesign/hypermotion

# render the current scene from the terminal
hypermotion render -o demo.mp4 -q 4k

# wire it into Claude Code
claude mcp add -s user hypermotion -- hypermotion-mcp
```

Full guide — install, all CLI flags, every supported agent, what works
today vs. roadmap, troubleshooting — in **[AGENTS.md](./AGENTS.md)**.

## Build from source

```sh
pnpm install
pnpm dev          # Vite + Electron, hot-reload
pnpm build        # builds for current OS
pnpm build:mac    # macOS arm64 + x64 .dmg
pnpm build:win    # Windows x64 + arm64 .exe
pnpm typecheck    # tsc -b (non-blocking; baseline known errors)
pnpm lint         # eslint
```

Requires Node 20+ and pnpm 9+. If you don't have pnpm:
`corepack enable && corepack prepare pnpm@latest --activate`.

## Architecture

Read [CLAUDE.md](./CLAUDE.md) for the load-bearing invariants. Two
that matter most:

1. **Keyframes target semantic properties, not coordinates.** Animate
   variant, opacity, scale, flex gap, padding — never raw `x` / `y` on
   a child of an auto-layout parent.
2. **Imports flow one way:** `ui` → `state` → `anim` → `render` →
   `layout` → `scene`. Never reverse.

If a contribution fights either of these, open an issue first to discuss
the trade-off.

## Repository layout

```
src/
  scene/        Yjs document model — single source of truth
  layout/       Yoga WASM wrapper, dirty-flagged re-solve
  render/       PixiJS adapter (export); DOM renderer for the editor
  anim/         Keyframe store + easing + rAF tick loop
  timeline/     Track UI, ruler, chapters, multi-select keyframes
  export/       MP4 / WebM / GIF pipelines
  ui/           React panels — TopBar, Layers, Inspector, Canvas host
  state/        Zustand stores for UI-only state
electron/       Main process + preload bridge
cli/            @psiddharthdesign/hypermotion — CLI + MCP server
```

## Contributing

Bug reports, feature ideas, and PRs all welcome. Read
[CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR — the
architecture has strong opinions and a quick issue thread saves
rework. Behavior is governed by the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).

Apache 2.0 includes a patent grant from contributors to users (§3) and
explicit trademark protection (§6). See [NOTICE](./NOTICE) for the
copyright statement and third-party attribution.

Copyright 2026 Siddharth Ponnapalli.

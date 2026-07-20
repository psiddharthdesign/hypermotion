# hyper-motion

> A motion design tool with Figma's layout brain.

[hypermotion.app](https://hypermotion.app) · open source · Apache 2.0 · macOS (Windows coming soon)

Jitter excels at the timeline. Figma excels at layout. hyper-motion is
the first to bring them together. Auto-layout containers that push
siblings around when content changes. Keyframes that target semantic
properties (variant state, opacity, scale, gap, padding) — not raw `x`
and `y`. When the design moves, the animation survives.

Plus everything you expect from a Jitter-class tool: a real timeline,
in/out presets, easing curves, 3D camera with depth-of-field, and MP4 /
WebM / GIF export.

## Status — v0.1.14 research preview

The semantic-layout-animation bet works end-to-end, with desktop
editing, Figma import, pixel-correct export, and CLI / MCP workflows for
AI agents. This is still a research preview, so expect rough edges while
the product shape is validated with real projects.

## Install (macOS)

One line in Terminal — works for every release:

```sh
curl -fsSL https://raw.githubusercontent.com/psiddharthdesign/hypermotion/main/install.sh | bash
```

The script detects your Mac's architecture, pulls the latest release,
copies the app into `/Applications`, strips macOS's download quarantine,
applies a local ad-hoc signature, and opens it. No drag-to-Applications,
no "damaged" dialog, no per-version steps.

For a specific version: `curl ... | bash -s -- v0.1.14`.

### Manual install

Download the latest `.dmg` from
[github.com/psiddharthdesign/hypermotion/releases](https://github.com/psiddharthdesign/hypermotion/releases)
— `*-arm64.dmg` for Apple Silicon, `*.dmg` for Intel. Drag the app into
`/Applications`, then run two lines in Terminal:

```sh
xattr -cr /Applications/hyper-motion.app
codesign --force --deep --sign - /Applications/hyper-motion.app
```

Same effect as the one-liner above.

**Why is any of this needed?** macOS Sequoia / Sonoma flag any unsigned
download as "damaged" before they even check what's inside.
`xattr -cr` strips the `com.apple.quarantine` attribute that
Safari / Brave / Chrome add to downloaded files, and
`codesign --force --deep --sign -` re-applies an ad-hoc signature
**locally** (which Gatekeeper trusts in a way it doesn't trust the
downloaded one). Apple Developer signing + notarization — which removes
both steps entirely — is on the v0.2 roadmap.

> Windows build is not shipping yet. Track upcoming platform support in releases.

### Build from source

Build locally to skip the install warnings entirely — locally-built apps
never get the quarantine flag.

```sh
git clone https://github.com/psiddharthdesign/hypermotion.git
cd hypermotion
pnpm install
pnpm build:dir
open release/mac-arm64/hyper-motion.app
```

## Figma plugin

Copy frames, text, layout, and vector artwork from Figma straight into
hyper-motion. Payload v2 imports supported artwork as native vector-backed
layers and retains the canonical point/segment graph, Bézier controls,
transforms, ordered paints, gradient metadata, and detailed strokes. Version 1
payloads remain compatible, while complex constructs keep a sanitized SVG
fallback for visual fidelity. Direct point editing remains a follow-up. The
plugin source lives in
[`figma-plugin/`](./figma-plugin) inside this repo.

```sh
cd figma-plugin
pnpm install
pnpm build
# Then in Figma: Plugins → Development → Import plugin from manifest…
# → point at figma-plugin/manifest.json
```

Full step-by-step at [hypermotion.app/docs#figma-plugin](https://hypermotion.app/docs#figma-plugin).
Figma Community publish (one-click install) is on the v0.2 roadmap.

## What's in v0.1.14

- **Camera-accurate selection and resize.** Selection polygons, hit testing,
  and all eight resize handles now follow workspace zoom, camera XYZ, tilt,
  roll, FOV, and camera keyframe playback using the same projection as WebGL.
- **Curve-driven text animation.** Animate letters, words, lines, or whole
  layers with 21 presets, editable stagger curves, Bézier motion paths,
  and independent X / Y / Z travel.
- **Reversible stagger choreography.** Set layer or text order to Forward
  or Reverse, duplicate a stagger safely, or create an exact return that
  restores the original state.
- **Camera effects.** Add keyframeable Bloom and Chromatic Aberration
  alongside animated focus, aperture, falloff, and depth of field.
- **Smooth realtime preview.** Text-heavy scenes and camera effects use a
  bounded preview budget while final exports retain full quality.
- **Semantic keyframes + auto layout.** Animate variant, opacity, scale,
  rotation, gap, and padding without breaking the layout model.
- **Timeline with chapters** — named sections you can isolate, loop,
  and export individually or concatenated, with video and waveform-backed
  audio on the same timeline.
- **Pixel-correct export.** MP4 up to 4K (WebCodecs + mp4-muxer), WebM
  via tab capture, and GIF via gifenc, with stalled render workers cleaned
  up automatically.
- **Figma v2 vector import.** Bring supported Figma artwork across as native
  vector-backed layers with retained geometry, transforms, paint stacks,
  gradients, and detailed strokes; older payloads and complex SVGs continue
  through safe compatibility fallbacks.
- **Scriptable `.hype` scenes.** The included CLI and MCP server can create,
  inspect, patch, validate, open, and render saved scenes. See
  [`AGENTS.md`](./AGENTS.md).
- **Open source from day one.** Apache 2.0. Yjs-backed data model so
  real-time collab arrives without a rewrite.

See [RELEASES.md](./RELEASES.md) for release notes and roadmap details.

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

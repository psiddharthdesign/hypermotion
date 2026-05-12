# Releases

Human-friendly release notes. The GitHub Releases page mirrors the entries
below for the corresponding tag, plus auto-generated commit summaries.

## v0.1.0 — first cut (2026-05-12)

The semantic-layout-animation bet works end-to-end. This is a research
preview — expect rough edges, but the foundation is solid.

### Foundation

- Yjs-backed scene model with IndexedDB persistence (collab-ready, no
  rewrites required to add WebSockets / WebRTC later).
- Yoga WASM layout engine, dirty-flagged so it only re-solves on
  structural or layout-property changes.
- DOM renderer for the editor surface. (Pixi adapter for the editor
  itself is on the roadmap; Pixi already powers offscreen export.)

### Scene + layout

- Three layout modes per frame: `none` (free canvas), `flex` (Figma
  auto-layout), `grid` (row-major grid via flex-row + wrap).
- Per-corner border radii. Per-side stroke widths.
- Multiple shadows per node (stacked).
- Mask flag (`Cmd+Opt+M`) with `clip-path` rendering.
- Figma plugin importer — pulls in frames, text, layout sizing,
  per-corner radii, individual stroke weights, layout grids.

### Animation engine

- Hand-written timeline + keyframe store. No animation library
  dependency.
- Cubic-bezier easing + custom easing graph editor.
- Tracks keyed by `(nodeId, propertyId)`. AnimatedValues compose
  multiplicatively with static properties in the render pass.
- 13 IN / OUT presets (fade, slide, scale, pop variants).
- Camera node with X/Y/Z position, rotationX/Y, scale, real DOF
  (duplicate-render with focus distance + aperture).

### Timeline UI

- Tracks rows, playhead, ruler with stacked time + frame labels (Both /
  Time / Frames toggle).
- Group rows (`Cmd+G`) for collapsing related tracks under a single span
  bar.
- Pinch-zoom horizontal scaling.
- Keyframe marquee selection, snap on drag with Alt to disable, group
  span scale handles.
- Persistent named chapters (renamed from "sections"). Click to isolate;
  loop playback within isolated chapters.

### Export

- **MP4** — native pixel-correct path. `webContents.capturePage` (in
  the desktop wrapper) or WebCodecs (browser) walks frames offscreen at
  the chosen resolution, pipes into mp4-muxer. Levels picked
  automatically; 4K supported when running on a high-DPR display or
  inside the desktop wrapper.
- **WebM** — fast tab-capture path. `getDisplayMedia` + MediaRecorder,
  real-time speed.
- **GIF** — gifenc, 720p · 24fps default; quality picker applies.
- **Multi-chapter selection.** Pick any combination of chapters; output
  is one file with the selected spans concatenated back-to-back.
- Per-frame Pixi diagnostic logging behind a flag for export debugging.

### UI / polish

- Geist Mono throughout. Rad-spacing applied to panels.
- Figma-style border-mode picker (All / Top / Bottom / Left / Right /
  Custom) with one-click clear.
- Floating dock + simplified TopBar.
- Inspector mode toggle between Properties and Animate (preset picker).
- Inspector field primitives: NumberField, TextField, SelectField,
  CheckboxField, ColorField, LabeledSegmented, IconSegmented,
  SliderField — reused across Inspector, presets, and any future panel.
- Layers panel: drag-reorder, inline rename, eye + lock toggles,
  visibility cascade to children, type icons, tree indentation.
- Canvas pan/zoom with selection scroll-into-view on the Layers panel.
- Resizable Layers + Inspector sidebars (persisted widths).

### Desktop wrapper

- Electron 33, contextIsolation on, nodeIntegration off.
- `webContents.capturePage` IPC bridge for HQ export.
- macOS `.dmg` and Windows `.exe` via electron-builder.
- GitHub Actions release workflow that builds both on push of a
  `v*` tag.
- Currently unsigned — Gatekeeper warning on first open is expected.

### CLI / MCP server

- Companion package `@psiddharthdesign/hypermotion` (separate repo) —
  shipping in this same milestone. CLI commands: `render`,
  `info`, `serve --mcp`. MCP server registers `render_scene`,
  `apply_preset`, `add_keyframe` tools so AI coding agents (Claude
  Code, Codex) can drive scenes programmatically.

### Known gaps

- No FLIP yet for animating layout-property changes. The data model
  accepts keyframes on `flex.gap`, `padding`, etc., but the engine
  ignores them for MVP. Step 5.1 picks this up.
- Editor renders via DOM. Pixi-on-editor swap is a post-MVP item.
- No unit tests yet. CI runs `tsc -b` + `eslint` only.
- Code signing not configured. `.dmg` opens with a Gatekeeper
  warning until an Apple Developer cert is wired up.
- Linux build target exists in package.json but isn't released; tag
  pushes only produce DMG + EXE.

### Architecture

Read [CLAUDE.md](./CLAUDE.md) for the full design, invariants, and
phase order.

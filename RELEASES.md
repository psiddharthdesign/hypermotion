# Releases

Human-friendly release notes. The GitHub Releases page mirrors the entries
below for the corresponding tag, plus auto-generated commit summaries.

## v0.1.11 — Audio timeline + focus export workflow (2026-06-22)

This release makes Hyper Motion feel more like a complete motion timeline:
you can import media, place audio clips, preview a work area, and export
the final MP4 with sound.

- Added timeline-only audio clips with manual import, start-time
  positioning, trim handles, duplicate/delete actions, mute/unmute, volume,
  and loop controls.
- Added waveform rendering from the actual decoded audio buffer, including
  the currently visible trimmed region, so clips read like audio instead of
  generic blocks.
- Audio now plays inside the editor and preview in sync with the playhead,
  without creating visible canvas layers.
- MP4 export now mixes audio/video media into the rendered output, so scenes
  can ship with sound from the same Hyper Motion timeline.
- Added a shared work area for preview and export: drag the start/end
  handles, loop inside it while iterating, or stop playback at the end.
- Export can use the work area directly, alongside the existing full,
  custom, and chapter export modes.
- Camera focus blur/export path is cleaner: focus/blur survives final
  renders, high blur no longer creates dark vignette edges, and the blur
  controls are easier to judge in preview/export.
- Audio clips stay out of the normal visual layer tree and canvas, keeping
  media timing separate from scene objects.

## v0.1.10 — Import fidelity + update notifications (2026-05-22)

This release tightens the Figma-to-Hyper Motion path and adds the first
desktop update notification flow.

- Figma imports now preserve clipped rounded frames, drop shadows, alpha
  in fills and strokes, and zero-opacity strokes instead of dropping
  them from the scene.
- Text imported from Figma's auto-resize modes now keeps its expected
  bounds, preventing split labels like "Sign / Up".
- Inspector fill popovers now float above the panel instead of being
  clipped by the right sidebar.
- Transform alignment now uses rendered positions, so repeated center
  clicks stay stable instead of moving the layer farther away.
- The desktop app checks GitHub Releases on launch and every 5 minutes,
  showing a native notification and in-app banner when a newer version
  is available.

## v0.1.1 — CLI render hardening + Figma plugin docs (2026-05-14)

Focused fix release on top of v0.1.0. CLI render is dramatically more
reliable when used from AI coding agents, and the Figma plugin is
documented + bundled in the public repo. Foundation for the v0.1.2
`.hype` file format work is in place.

### CLI / MCP render reliability

- **Error sentinels** — when the renderer fails (in-flight rejection,
  unsupported format, runtime error), the main process now writes
  `<output>.error` next to the expected `<output>.done`. The CLI driver
  polls for either and surfaces the error to the calling agent in <1s
  instead of timing out at 5 minutes. Agents adapt; users don't wait.
- **WebM fail-fast in headless mode** — the tab-capture pipeline
  (`getDisplayMedia`) requires a user gesture, which doesn't exist when
  an agent triggers a render. WebM now rejects immediately with a clear
  message pointing at MP4 or GIF as alternatives. Rebuilding WebM on top
  of `webContents.capturePage` is on the v0.1.2 roadmap.
- **`--key=value` argv form** is now the default. Survives Chromium's
  `CommandLine` round-trip in the second-instance event payload, where
  bare `--key value` form drops the values. Old `--key value` still
  parsed for backward compat.
- **Locator failure is loud** — setting `HYPERMOTION_APP_PATH` to a
  bogus path used to silently fall through to OS search; now logs a
  clear error pointing at the bad path.

### Figma plugin

- The `figma-plugin/` source ships in the public repo (was previously
  only in the dev tree). Users get the plugin on clone.
- Step-by-step install guide at
  [hypermotion.app/docs#figma-plugin](https://hypermotion.app/docs#figma-plugin):
  build → import manifest → copy frames into hyper-motion.
- Figma Community publish (one-click install) deferred to v0.2.

### `.hype` file format primitives

- `src/scene/file.ts` exposes `sceneToBytes` / `applyBytesToScene` /
  `readScene` / `sceneToJson`. Foundation for the v0.1.2 scene authoring
  API (CLI + MCP scene create/edit/render).
- `.hype` files are raw `Y.encodeStateAsUpdate(doc)` bytes — preserves
  the Yjs CRDT structure so collaboration works seamlessly later.
- `applyJsonToScene` is stubbed (throws explicit "not yet implemented")
  pending the full agent authoring surface in v0.1.2.

### Distribution

- **macOS-only for v0.1.x.** Windows build pipeline works but isn't
  shipping yet — release workflow narrowed to `macos-latest`, package
  metadata + landing copy + docs all reflect this. Windows resumes once
  signing + the Windows DX has had focused attention.
- DMG ships **ad-hoc signed**. macOS Sequoia still shows a "damaged"
  dialog (Apple requires paid Developer notarization for clean opens),
  so the install path documents the verified two-line workaround:
  ```sh
  xattr -cr /Applications/hyper-motion.app
  codesign --force --deep --sign - /Applications/hyper-motion.app
  ```
- Build scripts no longer gate on `tsc -b` — `pnpm typecheck` is a
  separate command. 49 pre-existing type errors are tracked tech debt,
  not blockers.

### Landing + docs

- Landing redesigned with the Hers minimal pattern — pure white,
  left-aligned, generous whitespace, single dark CTA.
- New `/docs` route with the canonical install guide and the Figma
  plugin steps; rest of the docs flagged "coming soon" in a grid.
- AGENTS.md cleaned up to reflect macOS-only and the WebM caveat.

### v0.1.2 roadmap (next)

- `.hype` file save / open in the desktop app (File menu)
- CLI `scene new / open / info / list / delete / duplicate`
- CLI `render <scene.hype> -o out.mp4` (currently only renders the
  current IndexedDB scene)
- JSON I/O: `export-json` / `import-json` for agent authoring
- MCP tools: `create_scene`, `import_scene_from_json`, `info_scene`
  (real, not stub)
- WebM via `webContents.capturePage` (no more user-gesture dependency)
- Per-layer blur effect (animatable, decoupled from camera DOF)

---

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

- **MP4** — native pixel-correct path. `webContents.capturePage` walks
  frames offscreen at the chosen resolution and pipes into mp4-muxer.
  Levels picked automatically; 4K supported on high-DPR displays.
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

### Desktop app

- Built on Electron 33 with contextIsolation on, nodeIntegration off.
- `webContents.capturePage` IPC bridge for HQ export.
- macOS `.dmg` via electron-builder. Windows `.exe` builds but isn't
  shipping yet — coming in a later v0.1.x release.
- GitHub Actions release workflow that builds both on push of a
  `v*` tag.
- Currently unsigned — Gatekeeper warning on first open is expected
  until an Apple Developer cert is wired up.

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

# Releases

Human-friendly release notes. The GitHub Releases page mirrors the matching
entry below for each corresponding tag.

## v0.1.16 — Compact editor polish and downloadable Figma setup (2026-07-20)

Hyper Motion's editor chrome is denser and more consistent, the Figma importer
now follows the familiar download-and-import flow, and unfinished asset-library
actions are clearly gated. The release pipeline also publishes the standalone
Figma plugin automatically alongside every desktop build.

### Clearer Figma setup

- Lead with a direct link to the latest Hyper Motion release instead of a
  hidden Application Support path.
- Reduce setup to three steps: download and unzip the plugin, import
  `manifest.json` in Figma Desktop, then copy the selection into Hyper Motion.
- Keep every visible modal label and instruction in capitals, with compact
  spacing, keyboard focus containment, and focus restoration on close.
- Publish a versioned `hyper-motion-figma-plugin-v*.zip` release asset containing
  the manifest, compiled plugin runtime, UI, license, notice, and guide.

### Denser, consistent editor chrome

- Move the editor to an 11px general type size with 10px support text and 9px
  metadata while leaving authored canvas text and exported compositions alone.
- Preserve explicit control typography instead of globally overriding form
  sizes, so compact mode does not collapse intentionally larger controls.
- Keep the Animated Layers timeline tab on one line at narrow panel widths.

### Assets safely gated

- Mark the Assets panel as **Coming Soon** without changing the Layers panel.
- Disable View All, component selection, double-click editing, dragging, and
  imported-media interactions until the asset library is ready.
- Block the legacy component browser modal from opening through any Assets
  panel path.

### Install on macOS

Download the Apple Silicon or Intel DMG from this release, or use the one-line
installer in the [installation guide](https://hypermotion.app/docs#install).
The v0.1.x builds remain unsigned and macOS-only, so macOS may require the
first-time setup described in that guide.

## v0.1.15 — Built-in Figma importer and compact editor (2026-07-20)

Figma import no longer requires cloning the repository, building plugin source,
or keeping a release download folder. Hyper Motion now ships the importer inside
the desktop app, installs it to a stable per-user location, and guides the
one-time Figma setup directly from the editor. The editor interface is also
denser while preserving typography inside authored compositions.

### Figma setup from the app

- Add a Figma import button to the editor top bar with a focused setup modal.
- Reveal the exact manifest users should select in Figma Desktop instead of
  making them locate an app bundle or copy a path manually.
- Bundle the manifest, compiled plugin code, and plugin UI with every macOS
  release; no repository checkout, package install, source build, or terminal
  command is needed.
- Keep Figma's registered manifest path stable across Hyper Motion updates and
  refresh the installed plugin payload whenever the app launches.
- Explain the one-time **Plugins → Development → Import plugin from manifest…**
  flow while Community marketplace distribution remains a later option.

### Denser editor chrome

- Reduce oversized interface typography by roughly 12–16 percent with a
  legible minimum size.
- Scope the density pass to editor chrome so canvas text, imported designs, and
  exported media retain their authored sizes.
- Keep menus, inspectors, dialogs, timeline labels, and the Figma setup modal
  readable without introducing clipped controls.

### Safe packaging and updates

- Copy bundled plugin files into Application Support atomically and retain the
  last working copy if a packaged payload is incomplete.
- Cover first installation, update refresh, and fallback behavior with focused
  Electron tests.
- Build the Figma plugin before development and release builds and include its
  runtime files in the packaged application.

### Install on macOS

Download the Apple Silicon or Intel DMG from this release, or use the one-line
installer in the [installation guide](https://hypermotion.app/docs#install).
The v0.1.x builds remain unsigned and macOS-only, so macOS may require the
first-time setup described in that guide.

## v0.1.14 — Camera-accurate selection and resize (2026-07-20)

Selection chrome now uses the same world planes and live camera projection as
the WebGL scene. Outlines, click targets, and resize handles stay attached to
their layers through workspace zoom, camera movement, perspective changes, and
camera animation instead of drifting back to the untransformed layout box.

### Selection follows the active camera

- Project every selected layer's four real world-space corners through camera
  X, Y, and Z movement, dolly, X/Y tilt, roll, and field of view.
- Update selection polygons continuously during camera keyframe playback,
  timeline scrubbing, and transient camera gestures.
- Sample the current animation-engine and gesture-preview camera state for
  click and double-click hit testing, avoiding stale UI-frame coordinates.
- Keep accurate individual outlines for multi-selection and the fixed viewport
  outline for the root artboard.

### Perspective-correct resize handles

- Place all eight handles at projected corners and edge midpoints instead of
  an axis-aligned approximation.
- Rotate resize cursors to match the visible layer axes after camera or layer
  rotation.
- Ray-cast pointer movement back into the selected plane's local coordinates,
  so every handle changes the intended width or height under perspective.
- Refresh the drag projection while the camera animates rather than retaining
  the camera frame captured at pointer-down.

### Scoped realtime work

- Resolve only selected nodes and the ancestor paths needed for their world
  transforms, avoiding a second full-scene plane build on every camera frame.
- Preserve the existing DOM selection fallback when WebGL is unavailable or
  inline text editing temporarily owns the canvas.
- Keep all editor selection chrome out of exported media.

### Install on macOS

Download the Apple Silicon or Intel DMG from this release, or use the one-line
installer in the [installation guide](https://hypermotion.app/docs#install).
The v0.1.x builds remain unsigned and macOS-only, so macOS may require the
first-time setup described in that guide.

## v0.1.13 — Figma v2 vector import (2026-07-20)

Hyper Motion's Figma importer now brings supported vector artwork across as
native vector-backed layers instead of flattening it to an image-only node.
Payload v2 retains vector geometry, transforms, paint stacks, gradients, and
detailed stroke metadata, while older payloads and complex artwork continue
through safe compatibility paths.

### Native vector-backed imports

- Retain stable points, segments, Bézier controls, contours, regions, and path
  winding in the scene document for supported Figma vectors.
- Preserve direct-parent transforms through nested groups and boolean
  operations, plus Figma sizing metadata for more faithful placement.
- Keep version 1 clipboard payloads readable; legacy vectors continue through
  the existing SVG image path.

### Higher-fidelity appearance

- Retain ordered fill and stroke stacks, opacity and blend metadata, gradient
  stops and transforms, plus stroke width, alignment, dashes, offset, caps,
  joins, and miter limits.
- Keep a sanitized copy of the original SVG when artwork uses constructs that
  cannot yet be converted losslessly to the canonical vector graph.
- Use a PNG fallback only when Figma returns no usable SVG or reports collapsed
  vector bounds.
- Render vector-backed layers consistently in realtime preview and final Pixi
  export, with a stable raster cache for animation frames.

### More reliable paste flow

- Prefer a fresh Figma clipboard payload over stale in-app copied layers.
- Fall back to Electron's native clipboard bridge when the browser paste event
  cannot expose text.
- Show clear progress, success, unsupported-selection, malformed-data, and
  plugin-version messages without interfering with ordinary text paste.

### Install on macOS

Download the Apple Silicon or Intel DMG from this release, or use the one-line
installer in the [installation guide](https://hypermotion.app/docs#install).
The v0.1.x builds remain unsigned and macOS-only, so macOS may require the
first-time setup described in that guide.

## v0.1.12 — Curve-driven text motion + camera effects (2026-07-20)

Hyper Motion's text system can now animate letters, words, lines, or whole
layers through editable motion. Shape stagger timing with custom Bézier
curves, move text through XYZ along adjustable paths, reverse sequence order,
build exact return animations, and finish scenes with camera-wide Bloom and
Chromatic Aberration.

### Curve-driven text animation

- Animate by letter, word, line, or whole layer with 21 presets, including
  Curve Drop, Scramble, Typewriter, Character Wave, Blur, Flip, and Gradient
  Reveal.
- Draw editable Bézier motion paths on the canvas or in the inspector, with
  independent X, Y, and Z travel controls.
- Shape stagger progression with a point-and-handle curve editor for
  continuous, progressive entry instead of isolated letter drops.
- Switch segmentation or animation type without breaking the stagger
  relationship or manufacturing disconnected keyframes.

### Reversible stagger choreography

- Set Layer, Letter, Word, and Line order to Forward or Reverse without
  reversing the underlying motion.
- Duplicate a stagger as an independent animation or create an exact return
  that restores the state before the stagger began.
- Preserve custom paths, timing curves, values, and Bézier easing when
  reversing or returning motion.

### Camera effects and depth

- Add camera-wide Bloom and Chromatic Aberration, with keyframeable amount,
  direction, strength, radius, and threshold controls.
- Keep the same effect in editor preview, fallback rendering, and final
  export.
- Improved depth-of-field movement, focus transitions, bokeh quality, and
  opacity consistency across flat, 3D-plane, and grouped 3D render modes.

### Smoother playback and safer exports

- Reduced per-frame work for segment-based text animation and effect-heavy
  scenes through cached geometry, coalesced updates, and adaptive realtime
  quality. Final exports remain full quality.
- Stabilized playhead timing, keyboard playback, zoom behavior, hit testing,
  and stacked text-animation ordering.
- Added automatic cleanup for stalled or orphaned hidden export workers so a
  reload cannot leave a 4K render consuming CPU and GPU in the background.
- Suspended hidden WebGL work while editing text to keep direct manipulation
  responsive.

### CLI and scene workflows

- Expanded `.hype` workflows for creating, inspecting, patching, validating,
  opening, and rendering saved scenes through the CLI and MCP server.
- Added the new text-animation, stagger-path, camera-focus, and camera-effect
  properties to scene authoring and validation.
- Hardened scene and render argument validation, path handling, and error
  reporting for agent-driven workflows.

### Install on macOS

Download the Apple Silicon or Intel DMG from this release, or use the
one-line installer in the [installation guide](https://hypermotion.app/docs#install).
The v0.1.x builds remain unsigned and macOS-only, so macOS may require the
first-time setup described in that guide.

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

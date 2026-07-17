// SPDX-License-Identifier: Apache-2.0

import { create } from 'zustand'
import type { EasingPresetId } from '@/anim/easingPresets'

/**
 * UI-only state for the motion tool.
 *
 * Scope: things that affect the chrome around the canvas — which tool is
 * active, what's selected, which panels are visible, where the playhead is,
 * how the workspace is zoomed/panned.
 *
 * NOT in scope: scene graph data, keyframes, layout results. Those live in
 * the Yjs doc (src/scene) and the animation engine (src/anim). This store
 * is intentionally small so it can be replaced or split without touching
 * the core engines.
 *
 * Note: `playhead` and `playing` live here for now because the transport
 * controls and timeline scrubber need a single source of truth. Once the
 * animation engine lands (Step 5), the engine owns the authoritative
 * playhead and pushes updates here on each tick.
 */

export type Tool = 'select' | 'rect' | 'ellipse' | 'text' | 'frame' | 'hand'
export type PanelKey = 'layers' | 'inspector' | 'timeline'
export type InspectorMode = 'properties' | 'animate'
/**
 * App color theme.
 *
 *   'dark'   — the original chrome (low-light editor surface).
 *   'light'  — bright surface for daylight / printing / pairing screens.
 *   'system' — follow the OS preference via prefers-color-scheme.
 *
 * The active value is persisted to localStorage so reloads honor the
 * user's pick. 'system' is the implicit default for first-runs.
 */
export type ThemePreference = 'dark' | 'light' | 'system'

/**
 * What the timeline ruler shows at each major tick — and what the
 * ancillary readouts (TRACKS-corner pill, floating playhead pill in
 * the ruler) display alongside.
 *
 *   'both'   — time row on top, frame row below (the default; gives
 *               motion designers and animators what each prefers).
 *   'time'   — seconds only.
 *   'frames' — frame numbers only.
 *
 * Persisted so the user's choice survives reload.
 */
export type RulerLabelsMode = 'both' | 'time' | 'frames'
export interface WorkAreaRange {
  start: number
  end: number
}
export type WorkAreaPlaybackMode = 'loop' | 'stop'

const THEME_STORAGE_KEY = 'hyper-motion.theme'
const RULER_LABELS_KEY = 'hyper-motion.rulerLabels'

/**
 * Generic numeric prefs persistence — used for sidebar widths and any
 * other UI dimension we want sticky across reloads. Keeps the per-key
 * boilerplate (try/catch, NaN guard) in one place.
 */
function readStoredNumber(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  try {
    const v = window.localStorage.getItem(key)
    if (v === null) return fallback
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

function writeStoredNumber(key: string, value: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    /* private mode / quota — best-effort */
  }
}

function readStoredTheme(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (v === 'dark' || v === 'light' || v === 'system') return v
  } catch {
    // localStorage may throw in private mode / quota; fall through to default.
  }
  return 'system'
}

function writeStoredTheme(theme: ThemePreference): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Best-effort persistence; ignore failures.
  }
}

function readStoredRulerLabels(): RulerLabelsMode {
  if (typeof window === 'undefined') return 'both'
  try {
    const v = window.localStorage.getItem(RULER_LABELS_KEY)
    if (v === 'both' || v === 'time' || v === 'frames') return v
  } catch {
    /* private mode / quota — best-effort */
  }
  return 'both'
}

function writeStoredRulerLabels(mode: RulerLabelsMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RULER_LABELS_KEY, mode)
  } catch {
    /* ignore */
  }
}

/**
 * Apply the chosen theme to <html> by setting a data-theme attribute
 * (or removing it for 'system' so the prefers-color-scheme media query
 * takes over). Called on store init and from `setTheme`.
 */
function applyThemeToDocument(theme: ThemePreference): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (theme === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', theme)
  }
}

/**
 * Workspace view: pan offset + zoom level applied to the canvas frame
 * inside <Workspace>. Separate from canvas coordinates — a click at
 * workspace (200, 100) with zoom=2, pan=(10, 20) maps to canvas
 * ((200 - 10) / 2, (100 - 20) / 2) = (95, 40).
 */
export interface WorkspaceView {
  zoom: number
  panX: number
  panY: number
}

/**
 * A single row in the right-click menu. `onClick` is invoked after the
 * menu closes, so handlers can call into UI state without the menu
 * still painting.
 */
export interface ContextMenuItem {
  kind?: 'item' | 'separator'
  label?: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  onClick?: () => void
}

export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

interface UIState {
  tool: Tool
  selection: string[]
  /**
   * Anchor for Shift+click range selection. This is the node that a
   * future shift-click will extend from. Set by plain clicks and by
   * Cmd/Meta-clicks (which *do* move the anchor, matching Figma), but
   * NOT by shift-clicks themselves — that way you can shrink/grow a
   * range from the same starting point across multiple shift-clicks.
   */
  selectionAnchor: string | null
  panels: Record<PanelKey, boolean>
  playhead: number
  playing: boolean
  inspectorMode: InspectorMode
  view: WorkspaceView
  componentEditId: string | null
  contextMenu: ContextMenuState | null
  /**
   * Layers-panel collapse state: set of node IDs whose children are
   * hidden in the tree. "Collapsed" rather than "expanded" because the
   * default is expanded (empty set = everything open) and a fresh
   * session shouldn't hide anything. Keyed by node id, so stable across
   * rename / reorder.
   */
  layersCollapsed: Set<string>
  /**
   * Current easing preset + strength selected in the Animate tab. Lives
   * in UI state (not the scene) because it's a transient editing tool:
   * "the easing I'm dialing in right now". When the user clicks Apply
   * or picks an In/Out preset, this value is what gets written onto the
   * generated tracks.
   */
  easingPresetId: EasingPresetId
  /** Strength 0–100 for the active easing preset. */
  easingStrength: number
  /**
   * Timeline panel height in pixels. Drives the timeline section's
   * flex-basis so the user can resize it by dragging the top edge.
   * Clamped by `setTimelineHeight` so the panel never collapses below
   * the ruler or eats the entire canvas.
   */
  timelineHeight: number
  /**
   * When true, the Inspector's Scale X and Scale Y inputs are locked
   * together — editing either one mirrors to the other. Persisted in
   * UI state so the lock survives selection changes. Default OFF —
   * surprise mirroring (typing into X and watching Y change) is more
   * disorienting than a single explicit click on the link toggle to
   * opt in. Mirrors how Figma ships transform fields.
   */
  scaleLinked: boolean
  /**
   * Stagger controls on the Animate panel. When on, clicking a preset
   * spreads it across multiple targets — either the direct children of
   * a single selected parent, or the members of a multi-selection. Each
   * target `i` starts at `playhead + i * staggerDelay`, first child
   * first. `staggerDelay` is in seconds to match the rest of the tool
   * (keyframe times, scene duration, playhead). The delay field stays
   * in UI state so it survives selection changes.
   */
  staggerOn: boolean
  staggerDelay: number
  /**
   * Auto-keyframe ("record") mode. When on, any committed value change
   * on an animatable property (transform.*, appearance.opacity, corner,
   * fill) also stamps a keyframe at the current playhead. Mirrors
   * After Effects's stopwatch/record UI. Default off so property edits
   * don't silently create keyframes the user didn't intend.
   */
  recording: boolean
  /**
   * Multi-select rename dialog visibility. The dialog acts on whatever
   * is currently in `selection` — keeping the targets implicit means
   * we don't have to capture a snapshot when opening, and the modal
   * follows the "edit the current selection" mental model the rest of
   * the Inspector uses. `null` when closed.
   */
  renameDialogOpen: boolean
  /**
   * Id of the text node currently in inline-edit mode, or null when
   * no text is being edited. Set when the user presses Enter on a
   * selected text node (or double-clicks one in the canvas). The
   * Canvas renders a contentEditable instead of a static span for
   * the node whose id matches.
   */
  editingTextId: string | null
  /**
   * The track row the user most recently clicked in the Timeline panel,
   * or null when no track is focused. The global Delete keyboard
   * shortcut consults this first: if a track is focused, Delete removes
   * that track (just the property's keyframes) instead of the owning
   * scene node. Cleared when the user selects a node from the Layers
   * panel or canvas — those actions imply "I'm working on layers, not
   * tracks." */
  selectedTrackId: string | null
  /**
   * Layers panel width in pixels. User can drag the right edge to
   * resize. Persisted to localStorage so reloads keep the layout the
   * user set. Clamped by setLayersWidth to keep the panel readable.
   */
  layersWidth: number
  /** Inspector panel width in pixels. Symmetric to layersWidth. */
  inspectorWidth: number
  /**
   * Active color theme preference. Persists to localStorage so reloads
   * honor the user's pick. Components should read CSS tokens (which
   * the index.css palette switches on `data-theme`) rather than this
   * value directly — only the theme toggle UI needs to know which
   * mode is active.
   */
  theme: ThemePreference
  /**
   * Timeline ruler labels mode — see RulerLabelsMode. Drives the
   * ruler's tick labels, the floating playhead pill in the ruler,
   * and the corner pill in the TRACKS column header so they all
   * stay consistent.
   */
  rulerLabels: RulerLabelsMode
  /**
   * Camera id currently waiting for a canvas click to place its focus
   * target. Null means regular canvas interactions are active.
   */
  focusPickingCameraId: string | null

  setTool: (tool: Tool) => void
  setSelection: (ids: string[]) => void
  toggleInSelection: (id: string, additive: boolean) => void
  /**
   * Replace the selection with every id in `orderedIds` between the
   * anchor and `id` (inclusive, any direction). Used for Shift+click in
   * the Layers panel, and any future list-based selection surface.
   * Falls back to selecting just `id` if there's no anchor yet.
   *
   * `filter` runs after the range slice. Panels with scene-graph
   * awareness (the Layers tree) use it to drop descendants of ids
   * already in the range — "selecting a parent implies its whole
   * subtree", so also selecting its children is redundant.
   */
  extendSelectionTo: (
    id: string,
    orderedIds: string[],
    filter?: (ids: string[]) => string[],
  ) => void
  /** Select every id in `orderedIds`. Anchor resets to the first one. */
  selectAll: (orderedIds: string[]) => void
  clearSelection: () => void
  togglePanel: (key: PanelKey) => void
  setPlayhead: (t: number) => void
  setPlaying: (p: boolean) => void
  setInspectorMode: (mode: InspectorMode) => void
  setView: (patch: Partial<WorkspaceView>) => void
  setComponentEditId: (id: string | null) => void
  /**
   * Zoom around an origin-relative workspace point.
   *
   * The transform container is anchored at the workspace center via CSS
   * `left-1/2 top-1/2`, so (x, y) here are measured from that center —
   * *not* from the workspace's top-left. Pass (0, 0) to zoom around
   * the workspace center (what Cmd+=/- does).
   *
   * Callers converting a pointer position do:
   *   x = clientX - rect.left - rect.width / 2
   *   y = clientY - rect.top  - rect.height / 2
   */
  zoomAt: (nextZoom: number, originX: number, originY: number) => void
  /** Reset pan to 0 and zoom to 1. */
  resetView: () => void
  openContextMenu: (menu: ContextMenuState) => void
  closeContextMenu: () => void
  /** Flip a layer row between expanded and collapsed. */
  toggleLayerCollapsed: (id: string) => void
  /** Update both easing preset and strength in one setState. */
  setEasing: (preset: EasingPresetId, strength: number) => void
  /** Clamp + set the timeline panel height. */
  setTimelineHeight: (px: number) => void
  /** Flip the Scale X / Scale Y link. */
  toggleScaleLinked: () => void
  /** Turn the Animate panel's stagger on or off. */
  setStaggerOn: (on: boolean) => void
  /** Set the stagger delay in seconds. Clamped to >= 0. */
  setStaggerDelay: (seconds: number) => void
  /**
   * Flip the auto-keyframe (record) mode on or off. Inspector edits,
   * canvas drags, and any other committed property change will stamp a
   * keyframe at the current playhead while this is true.
   */
  setRecording: (on: boolean) => void
  /** Open or close the multi-select rename dialog. */
  setRenameDialogOpen: (open: boolean) => void
  /** Enter or exit inline text-edit mode for the given node id. */
  setEditingTextId: (id: string | null) => void
  /** Set the timeline-focused track (or null to clear). */
  setSelectedTrackId: (id: string | null) => void
  /**
   * Persistent keyframe groups. Keys are arbitrary group ids; values
   * are the `${trackId}:${kfId}` keys of every keyframe in that group.
   * Groups outlive a single click — once two keyframes are grouped,
   * clicking either one selects both, dragging either drags both,
   * deleting either deletes both. Stored in UI state (not the Yjs
   * doc) because grouping is a per-editor convenience, not part of
   * the document — collaborators don't need to share these.
   *
   * Membership is exclusive: a given keyframe key lives in at most
   * one group. Adding a key to a new group removes it from any
   * previous group.
   */
  /**
   * Live timeline keyframe selection — `${trackId}:${kfId}` keys.
   * Mirrors what the user has selected via clicks / marquee. Lifted
   * to the UI store so the right-side Animate panel can react.
   */
  selectedKeyframes: string[]
  setSelectedKeyframes: (keys: string[]) => void
  // NOTE: trackGroups / kfGroups / kfGroupCollapsed used to live in
  // this Zustand store. They've moved into the Y.Doc's `uiState`
  // slab so Y.UndoManager covers grouping operations alongside
  // scene mutations — read them via `api.getUiState()` and write
  // via the helpers in `@/state/groupActions`. Keeping Zustand-side
  // state for these would mean two sources of truth and diverging
  // history.
  /**
   * Horizontal zoom level on the timeline, in pixels per second.
   * Default 80 (1s = 80px). Pinch or Cmd/Ctrl-scroll over the
   * timeline body scales this; the rest of the timeline's render
   * math scales accordingly. Persisted so the user's preferred
   * zoom level survives reloads.
   */
  timelinePxPerSecond: number
  /** Clamp + commit a new horizontal zoom level. */
  setTimelinePxPerSecond: (px: number) => void
  /**
   * Multi-track selection in the timeline left column. Clicking a
   * track label sets this; shift / cmd-click extends it. Cmd+G on
   * a selection of 2+ tracks creates a Jitter-style track group —
   * "Composed" when every selected track belongs to one layer, or
   * "Sequence" when the group spans multiple layers.
   *
   * Stored as an array (not Set) so Zustand shallow-compares it
   * cheaply and persistence stays serializable.
   */
  selectedTrackIds: string[]
  setSelectedTrackIds: (ids: string[]) => void
  toggleTrackInSelection: (id: string) => void
  /**
   * When non-null, the timeline visually clamps to this section —
   * the ruler, ticks, keyframes, and playhead all behave as if
   * `[start, end]` were the comp duration. Markers above the ruler
   * still draw, but only the section's interior is interactive.
   *
   * Lives in UI state (not Yjs) because isolation is a per-editor
   * focus mode, not a property of the document — collaborators in a
   * future sync session shouldn't pull each other into different
   * sections.
   *
   * `label` is optional, just for the exit banner copy.
   */
  isolatedRange: { start: number; end: number; label?: string } | null
  setIsolatedRange: (
    range: { start: number; end: number; label?: string } | null,
  ) => void
  /**
   * Shared preview/export work area. Preview edits this range directly;
   * Export can use it as a range mode so both surfaces agree.
   */
  workAreaRange: WorkAreaRange | null
  setWorkAreaRange: (range: WorkAreaRange | null) => void
  workAreaPlaybackMode: WorkAreaPlaybackMode
  setWorkAreaPlaybackMode: (mode: WorkAreaPlaybackMode) => void
  // Track groups also live in Yjs — see uiState slab + groupActions.
  /** Clamp + commit a new Layers panel width. */
  setLayersWidth: (px: number) => void
  /** Clamp + commit a new Inspector panel width. */
  setInspectorWidth: (px: number) => void
  /**
   * Set the active theme. Updates the <html> data-theme attribute and
   * persists to localStorage. Pass 'system' to defer to the OS
   * preference (prefers-color-scheme).
   */
  setTheme: (theme: ThemePreference) => void
  /** Set the ruler labels mode. Persists to localStorage. */
  setRulerLabels: (mode: RulerLabelsMode) => void
  /** Cycle the ruler labels mode: both → time → frames → both. */
  cycleRulerLabels: () => void
  /** Enter or exit click-to-focus placement for a camera. */
  setFocusPickingCameraId: (id: string | null) => void
  /**
   * Full filesystem path of the currently-open `.hype` document, or
   * null if the user hasn't saved yet (acts like Figma's "Untitled").
   * The TopBar shows `basename(path)` here so the user always sees the
   * file they're editing.
   *
   * Tracked in UI state (not the scene) because the path is a property
   * of the editing session — a collaborator opening the same doc on
   * their machine will have a different path. The scene's `meta.name`
   * is the display name that travels with the doc.
   */
  currentFilePath: string | null
  /**
   * Epoch ms of the last successful save (or load — opening a file
   * counts as "everything on disk matches the doc"). Null means the
   * doc has never been saved. The TopBar renders this as a relative
   * time (`Saved 2m ago`) and a polling re-render keeps it fresh
   * without an extra subscription.
   */
  lastSavedAt: number | null
  /** Update the file metadata after a save / open / save-as. */
  setCurrentFile: (path: string | null, savedAt: number | null) => void
}

const MIN_ZOOM = 0.05
const MAX_ZOOM = 16

export const useUI = create<UIState>((set) => ({
  tool: 'select',
  selection: [],
  selectionAnchor: null,
  panels: { layers: true, inspector: true, timeline: true },
  playhead: 0,
  playing: false,
  inspectorMode: 'properties',
  view: { zoom: 1, panX: 0, panY: 0 },
  componentEditId: null,
  contextMenu: null,
  layersCollapsed: new Set<string>(),
  easingPresetId: 'smooth',
  easingStrength: 50,
  timelineHeight: 224, // matches the old h-56 default (14rem)
  timelinePxPerSecond: readStoredNumber('hyper-motion.timelinePxPerSec', 80),
  selectedTrackIds: [],
  setSelectedTrackIds: (ids) =>
    set((s) => {
      if (
        s.selectedTrackIds.length === ids.length &&
        s.selectedTrackIds.every((id, i) => id === ids[i])
      ) {
        return s
      }
      return { selectedTrackIds: ids }
    }),
  toggleTrackInSelection: (id) =>
    set((s) => {
      const has = s.selectedTrackIds.includes(id)
      return {
        selectedTrackIds: has
          ? s.selectedTrackIds.filter((x) => x !== id)
          : [...s.selectedTrackIds, id],
      }
    }),
  isolatedRange: null,
  setIsolatedRange: (range) => set({ isolatedRange: range }),
  workAreaRange: null,
  setWorkAreaRange: (range) => set({ workAreaRange: range }),
  workAreaPlaybackMode: 'loop',
  setWorkAreaPlaybackMode: (mode) => set({ workAreaPlaybackMode: mode }),
  // trackGroups moved into Yjs (uiState slab). Helpers in
  // @/state/groupActions handle the mutations.
  scaleLinked: false,
  staggerOn: false,
  // 0.1s is the "designer default" for staggers — noticeable but not
  // glacial at 60fps. Users tweak this per-animation.
  staggerDelay: 0.1,
  recording: false,
  renameDialogOpen: false,
  editingTextId: null,
  selectedTrackId: null,
  layersWidth: readStoredNumber('hyper-motion.layersWidth', 256),
  inspectorWidth: readStoredNumber('hyper-motion.inspectorWidth', 288),
  // Read once at store init, then immediately apply to <html>. The
  // store init runs before React hydrates so the FIRST paint already
  // matches the user's preference — no flash of wrong theme.
  theme: (() => {
    const t = readStoredTheme()
    applyThemeToDocument(t)
    return t
  })(),
  rulerLabels: readStoredRulerLabels(),
  focusPickingCameraId: null,

  setTool: (tool) => set({ tool }),
  // Layer-selection actions clear `selectedTrackId`. Reasoning: if the
  // user just clicked a layer (in canvas / layers panel / timeline node
  // header), they're no longer "in track-edit mode," so a follow-up
  // Delete should hit the layer they just selected — not a stale track.
  setSelection: (ids) =>
    set({
      selection: ids,
      selectionAnchor: ids[ids.length - 1] ?? null,
      selectedTrackId: null,
      selectedTrackIds: [],
      selectedKeyframes: [],
    }),
  toggleInSelection: (id, additive) =>
    set((s) => {
      if (!additive)
        return {
          selection: [id],
          selectionAnchor: id,
          selectedTrackId: null,
          selectedTrackIds: [],
          selectedKeyframes: [],
        }
      const next = s.selection.includes(id)
        ? s.selection.filter((x) => x !== id)
        : [...s.selection, id]
      // Anchor follows the just-touched node so a subsequent Shift+click
      // extends from here, not from some stale plain-click anchor.
      return {
        selection: next,
        selectionAnchor: id,
        selectedTrackId: null,
        selectedTrackIds: [],
        selectedKeyframes: [],
      }
    }),
  extendSelectionTo: (id, orderedIds, filter) =>
    set((s) => {
      const anchor = s.selectionAnchor
      const finish = (range: string[]) => ({
        selection: filter ? filter(range) : range,
        selectedTrackId: null,
        selectedTrackIds: [],
        selectedKeyframes: [],
      })
      // No anchor yet — behave like a plain click, but don't move the
      // anchor (mirrors Figma: shift-click with no prior selection just
      // picks the clicked row).
      if (!anchor || !orderedIds.includes(anchor)) {
        return finish([id])
      }
      if (anchor === id) return finish([id])
      const aIdx = orderedIds.indexOf(anchor)
      const bIdx = orderedIds.indexOf(id)
      if (aIdx < 0 || bIdx < 0) return finish([id])
      const [lo, hi] = aIdx <= bIdx ? [aIdx, bIdx] : [bIdx, aIdx]
      return finish(orderedIds.slice(lo, hi + 1))
      // Intentionally NOT touching selectionAnchor — shift-clicks grow
      // the range from the same pinned start point.
    }),
  selectAll: (orderedIds) =>
    set({
      selection: orderedIds.slice(),
      selectionAnchor: orderedIds[0] ?? null,
      selectedTrackId: null,
      selectedTrackIds: [],
      selectedKeyframes: [],
    }),
  clearSelection: () =>
    set({
      selection: [],
      selectionAnchor: null,
      selectedTrackId: null,
      selectedTrackIds: [],
      selectedKeyframes: [],
    }),
  togglePanel: (key) =>
    set((s) => ({ panels: { ...s.panels, [key]: !s.panels[key] } })),
  setPlayhead: (t) => set({ playhead: t }),
  setPlaying: (p) => set({ playing: p }),
  setInspectorMode: (mode) => set({ inspectorMode: mode }),
  setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),
  setComponentEditId: (id) =>
    set({
      componentEditId: id,
      selectedTrackId: null,
      selectedTrackIds: [],
      selectedKeyframes: [],
      playing: false,
    }),
  zoomAt: (nextZoom, originX, originY) =>
    set((s) => {
      const z = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
      const { zoom, panX, panY } = s.view
      // Coordinates are origin-relative (see docstring). The transform
      // container sits at the workspace center, so a canvas point
      // (cx, cy) ends up at origin-space (panX + cx*zoom, panY + cy*zoom).
      // Inverting gives cx = (ox - panX) / zoom. After zoom change to z,
      // we want the same cx to still sit under (ox, oy), so:
      //   newPanX = ox - cx * z
      const canvasX = (originX - panX) / zoom
      const canvasY = (originY - panY) / zoom
      return {
        view: {
          zoom: z,
          panX: originX - canvasX * z,
          panY: originY - canvasY * z,
        },
      }
    }),
  resetView: () => set({ view: { zoom: 1, panX: 0, panY: 0 } }),
  openContextMenu: (menu) => set({ contextMenu: menu }),
  closeContextMenu: () => set({ contextMenu: null }),
  toggleLayerCollapsed: (id) =>
    set((s) => {
      const next = new Set(s.layersCollapsed)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { layersCollapsed: next }
    }),
  setEasing: (preset, strength) =>
    set({ easingPresetId: preset, easingStrength: strength }),
  setTimelineHeight: (px) =>
    // 120 keeps the transport bar + ruler + at least one row visible.
    // The upper cap is derived from the viewport at call time so the
    // canvas can't be squeezed out of existence; we approximate here by
    // letting it go up to 80% of the current window height.
    set({
      timelineHeight: clamp(
        px,
        120,
        typeof window === 'undefined' ? 800 : Math.round(window.innerHeight * 0.8),
      ),
    }),
  toggleScaleLinked: () => set((s) => ({ scaleLinked: !s.scaleLinked })),
  setStaggerOn: (on) => set({ staggerOn: on }),
  setStaggerDelay: (seconds) =>
    set({ staggerDelay: Math.max(0, seconds) }),
  setRecording: (on) => set({ recording: on }),
  setRenameDialogOpen: (open) => set({ renameDialogOpen: open }),
  setEditingTextId: (id) => set({ editingTextId: id }),
  setSelectedTrackId: (id) => set({ selectedTrackId: id }),
  selectedKeyframes: [],
  setSelectedKeyframes: (keys) =>
    set((s) => {
      // Cheap shallow equality — keep the same array reference when
      // nothing changed so subscribers don't re-render gratuitously.
      if (
        s.selectedKeyframes.length === keys.length &&
        s.selectedKeyframes.every((k, i) => k === keys[i])
      ) {
        return s
      }
      return { selectedKeyframes: keys }
    }),
  // trackGroups / kfGroups / kfGroupCollapsed moved into the Y.Doc;
  // the Zustand-side fields and actions are gone. See
  // @/state/groupActions for the helpers that read / write them.
  setTimelinePxPerSecond: (px) => {
    // 5 px/sec is so zoomed-out that a 30s scene still fits a small
    // panel; 800 px/sec lets the user pick a single frame at 60fps
    // (1/60s ≈ 13px wide). Pinch ramps from one to the other.
    const next = clamp(px, 5, 800)
    writeStoredNumber('hyper-motion.timelinePxPerSec', next)
    set({ timelinePxPerSecond: next })
  },
  setLayersWidth: (px) => {
    const next = clamp(px, 180, 600)
    writeStoredNumber('hyper-motion.layersWidth', next)
    set({ layersWidth: next })
  },
  setInspectorWidth: (px) => {
    const next = clamp(px, 220, 600)
    writeStoredNumber('hyper-motion.inspectorWidth', next)
    set({ inspectorWidth: next })
  },
  setTheme: (theme) => {
    applyThemeToDocument(theme)
    writeStoredTheme(theme)
    set({ theme })
  },
  setRulerLabels: (mode) => {
    writeStoredRulerLabels(mode)
    set({ rulerLabels: mode })
  },
  cycleRulerLabels: () => {
    const next: Record<RulerLabelsMode, RulerLabelsMode> = {
      both: 'time',
      time: 'frames',
      frames: 'both',
    }
    set((s) => {
      const m = next[s.rulerLabels]
      writeStoredRulerLabels(m)
      return { rulerLabels: m }
    })
  },
  setFocusPickingCameraId: (id) => set({ focusPickingCameraId: id }),
  currentFilePath: null,
  lastSavedAt: null,
  setCurrentFile: (path, savedAt) =>
    set({ currentFilePath: path, lastSavedAt: savedAt }),
}))

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

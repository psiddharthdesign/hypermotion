// SPDX-License-Identifier: Apache-2.0

import * as Y from 'yjs'
import type {
  Appearance,
  CameraNode,
  Fill,
  FrameNode,
  ImageNode,
  Keyframe,
  Layout,
  Node,
  NodeId,
  NodeKind,
  PropertyId,
  Scene,
  Section,
  SceneMeta,
  Size,
  TextNode,
  Track,
  TrackId,
  Transform,
} from '@/scene/types'
import { normalizeTextAnimation } from '@/anim/textAnimations'

/**
 * Persistent, undoable UI state — track groups, keyframe groups,
 * and their collapse flags. Lives inside the Y.Doc so the existing
 * Y.UndoManager picks up changes; otherwise grouping a few tracks
 * with Cmd+G would silently fall outside the user's undo timeline.
 *
 * Each grouping bag is a plain `Record<string, …>`; the doc stores
 * it as a JSON-serializable value on the slab. We swap the whole
 * record on each write — fine for v1; if we ever hit collab on this
 * data, splitting into per-group Y.Maps is the upgrade path.
 */
export interface UiStateSlab {
  trackGroups: Record<
    string,
    { trackIds: string[]; collapsed: boolean; name?: string }
  >
  kfGroups: Record<string, string[]>
  kfGroupCollapsed: Record<string, boolean>
}

const DEFAULT_UI_STATE: UiStateSlab = {
  trackGroups: {},
  kfGroups: {},
  kfGroupCollapsed: {},
}

/**
 * Y.Doc shape:
 *
 *   doc.getMap('scene')
 *     ├── meta    Y.Map<unknown>          // flat SceneMeta fields
 *     ├── root    string (NodeId of the scene root)
 *     ├── nodes   Y.Map<Y.Map<unknown>>   // each value is a node's flat Y.Map
 *     └── tracks  Y.Map<Y.Map<unknown>>   // each value is a track's flat Y.Map
 *
 * Nodes are stored as Y.Maps with FLAT keys. Whole property groups
 * (transform, layout, appearance, size) are stored as plain JS objects
 * under a single key. This means two collaborators editing different
 * fields of the same transform will conflict at the group level, not
 * the field level. Acceptable for v1 — split into nested Y.Maps in a
 * later pass when real-time collab lands.
 *
 * Children are stored as Y.Array<NodeId> on the node Y.Map under key
 * `children` so reorder/insert-at-index operations preserve intent
 * when collaborators edit in parallel.
 */

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export interface SceneAPI {
  /** The underlying Y.Doc — exposed so persistence and collab layers can attach. */
  readonly doc: Y.Doc

  // --- queries -------------------------------------------------------------
  getMeta(): SceneMeta
  getRoot(): NodeId
  /**
   * Id of the scene's active camera, or null if none is set. In
   * practice new docs always seed a default camera, so this returns
   * null only if the doc was persisted with an invalid id. Callers
   * that read the camera's fields should handle the null case.
   */
  getActiveCameraId(): NodeId | null
  /** Convenience — returns the active camera node (or null). */
  getActiveCamera(): CameraNode | null
  /** Switches which camera is active. The id must exist and be a camera node. */
  setActiveCameraId(id: NodeId): void
  getNode(id: NodeId): Node | null
  /** Ordered list of child nodes. Returns [] for nonexistent ids. */
  getChildren(id: NodeId): Node[]
  /** All node ids in the scene. */
  getAllNodeIds(): NodeId[]
  getTrack(id: TrackId): Track | null
  /** All animation tracks in insertion order. */
  getAllTracks(): Track[]
  getTracksForNode(nodeId: NodeId): Track[]

  // --- mutations -----------------------------------------------------------
  setMeta(patch: Partial<SceneMeta>): void
  createNode(kind: NodeKind, parent: NodeId | null, props?: Partial<Node>): NodeId
  deleteNode(id: NodeId): void
  /** Partial update of one group on a node. See comment above on granularity. */
  setNodeProperty<K extends keyof NodeBaseMutable>(
    nodeId: NodeId,
    key: K,
    value: NodeBaseMutable[K]
  ): void
  appendChild(parent: NodeId, child: NodeId): void
  moveChild(parent: NodeId, childId: NodeId, toIndex: number): void

  // --- tracks --------------------------------------------------------------
  /** Upsert a track. Replaces the existing track with the same id, if any. */
  setTrack(track: Track): void
  /** Remove a track by id. No-op if it doesn't exist. */
  deleteTrack(id: TrackId): void

  // --- sections -------------------------------------------------------------
  /** All sections, sorted by start time ASC. */
  getSections(): Section[]
  /** Upsert one section. End is clamped to >= start. */
  setSection(section: Section): void
  /** Delete a section by id. No-op if it doesn't exist. */
  deleteSection(id: string): void

  // --- custom fonts --------------------------------------------------------
  /**
   * Embed a font into this scene. The font's raw bytes ship with the
   * .hype file — opening on another machine restores the font without
   * a network fetch. Idempotent on (font.id): a second call with the
   * same id overwrites the prior entry, useful when re-uploading a
   * fixed file. Returns the stored CustomFont.
   */
  setCustomFont(font: import('@/scene/types').CustomFont): void
  /** Retrieve one font by id. Returns null if not embedded. */
  getCustomFont(id: string): import('@/scene/types').CustomFont | null
  /** All embedded fonts, in insertion order. */
  getAllCustomFonts(): import('@/scene/types').CustomFont[]
  /** Remove a font by id. No-op if not embedded. */
  removeCustomFont(id: string): void

  // --- ui state (track groups, keyframe groups, collapse flags) ------------
  /**
   * Read the persistent UI state slab. Lives inside the scene's
   * Y.Doc so Y.UndoManager covers track-group and keyframe-group
   * mutations alongside the rest of the document — Cmd+Z undoes a
   * grouping just like it undoes a transform edit.
   *
   * Returns a defensive plain object; mutating the result has no
   * effect on the doc. To write, call `setUiState(patch)` with the
   * keys you want to merge in. Unspecified keys keep their prior
   * value.
   */
  getUiState(): UiStateSlab
  /** Merge `patch` into the ui-state slab. Wrapped in a transaction. */
  setUiState(patch: Partial<UiStateSlab>): void

  // --- subscription --------------------------------------------------------
  /** Returns a monotonically-increasing version that bumps on any change. */
  getVersion(): number
  subscribe(listener: () => void): () => void
}

/** A mutable view of node fields that may be set via setNodeProperty. */
export interface NodeBaseMutable {
  name: string
  transform: Transform
  appearance: Appearance
  layout: Layout
  size: Size
  visible: boolean
  locked: boolean
  position: import('@/scene/types').Position
  isMask: boolean
  text: string
  textAnimation: import('@/anim/textAnimations').TextAnimationConfig | null
  // image-kind fields — settable via Inspector on ImageNode. The scene
  // API doesn't (yet) enforce that these keys only land on an image
  // node, so callers should only pass them through when they know
  // `node.kind === 'image'`.
  src: string
  fit: 'cover' | 'contain' | 'fill' | 'none'
  importWarning: string
  // media-kind fields — used by audio/video layers.
  volume: number
  muted: boolean
  startTime: number
  trimStart: number
  trimEnd: number
  loop: boolean
  // camera-kind fields — settable via Inspector on CameraNode.
  /** Camera's viewport-wide background fill. Null = no fill. */
  background: Fill | null
  /** Camera focal length in canvas-pixel units. Drives both Z-driven
   *  scale and the CSS perspective wrapper. */
  focalLength: number
  fieldOfView: number
  pointOfInterestX: number
  pointOfInterestY: number
  pointOfInterestZ: number
  nearClip: number
  farClip: number
  depthOfField: boolean
  focusMode: 'plane' | 'target' | 'screen'
  focusX: number
  focusY: number
  focusWorldX: number
  focusWorldY: number
  focusWorldZ: number
  focusTargetNodeId: NodeId | null
  focusDistance: number
  focusRadius: number
  focusFalloff: number
  aperture: number
  iso: number
  blurLevel: number
  blurQuality: number
  showFocusPlane: boolean
  /** Stack of layout guides — only meaningful on FrameNode. */
  layoutGuides: import('@/scene/types').LayoutGuide[]
  // ... add kind-specific fields as they become mutable through the API
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_META: SceneMeta = {
  id: 'scene',
  name: 'Untitled',
  duration: 5,
  frameRate: 60,
  canvas: { width: 960, height: 540 },
}

const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
  rotationX: 0,
  rotationY: 0,
  scaleX: 1,
  scaleY: 1,
  anchorX: 0.5,
  anchorY: 0.5,
  anchorZ: 0,
  space: 'local',
  renderMode: 'flat',
}

const DEFAULT_APPEARANCE: Appearance = {
  opacity: 1,
  fill: { kind: 'solid', color: 'oklch(0.62 0.21 250)' },
  stroke: null,
  cornerRadius: 0,
  effects: [],
}

/**
 * Text renders as glyphs, not as a filled box — a background fill behind
 * text makes it look like a labeled button by default, which is almost
 * never what users want. The glyph color lives on `TextNode.color`, so
 * appearance-level `fill` stays null and the text just paints itself.
 * Frames similarly go fill-less elsewhere (appearanceForKind in
 * Canvas.tsx) but text needs the no-fill default at the data-model level
 * because the measure function runs before the draw commit.
 */
const TEXT_DEFAULT_APPEARANCE: Appearance = {
  opacity: 1,
  fill: null,
  stroke: null,
  cornerRadius: 0,
  effects: [],
}

const DEFAULT_LAYOUT: Layout = {
  mode: 'none',
  direction: 'row',
  justify: 'start',
  align: 'start',
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  wrap: false,
  columns: 3,
  rowGap: 0,
  columnGap: 0,
}

/**
 * Backfill missing fields on a Layout read from Y.Doc. Older documents
 * persisted before `mode` / grid fields existed — read them through this
 * helper so the rest of the codebase can always treat Layout as complete.
 */
function normalizeLayout(raw: unknown): Layout {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LAYOUT }
  const l = raw as Partial<Layout>
  // If mode is missing, infer from the presence of non-zero flex fields.
  // Previously every frame had "flex defaults" but only frames with an
  // intentional gap / padding / non-start justify were actually using
  // auto layout. Treat any of those as a signal that the user wanted
  // flex; everything else becomes 'none'.
  const looksFlex =
    !!l.justify && l.justify !== 'start' ||
    !!l.align && l.align !== 'start' ||
    (l.gap ?? 0) > 0 ||
    (l.padding &&
      (l.padding.top > 0 ||
        l.padding.right > 0 ||
        l.padding.bottom > 0 ||
        l.padding.left > 0))
  const mode = l.mode ?? (looksFlex ? 'flex' : 'none')
  return {
    mode,
    direction: l.direction ?? 'row',
    justify: l.justify ?? 'start',
    align: l.align ?? 'start',
    gap: l.gap ?? 0,
    padding: l.padding ?? { top: 0, right: 0, bottom: 0, left: 0 },
    wrap: l.wrap ?? false,
    columns: l.columns ?? 3,
    rowGap: l.rowGap ?? (l.gap ?? 0),
    columnGap: l.columnGap ?? (l.gap ?? 0),
  }
}

const DEFAULT_SIZE: Size = { width: 100, height: 100 }

const DEFAULT_VARIANT_TRANSITION: import('@/scene/types').VariantTransition = {
  duration: 0.3,
  easing: 'ease-in-out',
  presetId: 'smooth',
  strength: 50,
}

// ---------------------------------------------------------------------------
// Y.Doc factory + API
// ---------------------------------------------------------------------------

export function createSceneAPI(doc: Y.Doc = new Y.Doc()): SceneAPI {
  const scene = doc.getMap<unknown>('scene')

  // Lazy-init the sub-maps on first access so a freshly loaded doc from
  // IndexedDB keeps its existing content instead of being stomped.
  const nodes = ensureMap(scene, 'nodes') as Y.Map<Y.Map<unknown>>
  const tracks = ensureMap(scene, 'tracks') as Y.Map<Y.Map<unknown>>
  const meta = ensureMap(scene, 'meta') as Y.Map<unknown>
  // Persistent UI-state slab (track groups, kf groups, collapse flags).
  // Lives inside the doc so Y.UndoManager catches grouping operations
  // alongside scene mutations.
  // Sections — named, length-bearing regions of the comp. Stored
  // by id so updates / deletes are O(1) and undo handles them
  // granularly. Replaced the earlier point-marker model — designers
  // wanted explicit section spans they could resize.
  const sections = ensureMap(scene, 'sections') as Y.Map<Section>
  const uiState = ensureMap(scene, 'uiState') as Y.Map<unknown>
  // Custom fonts embedded in the scene. Each entry is a CustomFont
  // (see types.ts). Bytes live inline so the .hype file is fully
  // portable — no external font references that could break on
  // another machine.
  const customFonts = ensureMap(scene, 'customFonts') as Y.Map<
    import('@/scene/types').CustomFont
  >
  // Seed default ui-state on a fresh doc; existing docs keep their
  // persisted bag (which may have grown since v1).
  for (const [k, v] of Object.entries(DEFAULT_UI_STATE)) {
    if (!uiState.has(k)) uiState.set(k, v)
  }

  // Seed meta defaults only if the doc is brand new.
  for (const [k, v] of Object.entries(DEFAULT_META)) {
    if (!meta.has(k)) meta.set(k, v)
  }

  // --- versioning + subscription ----------------------------------------
  let version = 0
  const listeners = new Set<() => void>()
  const bump = () => {
    version++
    for (const l of listeners) l()
  }
  doc.on('update', bump)

  // --- helpers ----------------------------------------------------------
  const ensureNode = (id: NodeId): Y.Map<unknown> => {
    const n = nodes.get(id)
    if (!n) throw new Error(`Node not found: ${id}`)
    return n
  }

  const yNodeToNode = (y: Y.Map<unknown>): Node => {
    const childrenValue = y.get('children') as
      | Y.Array<NodeId>
      | NodeId[]
      | undefined
    const children = Array.isArray(childrenValue)
      ? childrenValue
      : childrenValue
        ? childrenValue.toArray()
        : []
    const base = {
      id: y.get('id') as NodeId,
      name: (y.get('name') as string) ?? 'Layer',
      kind: y.get('kind') as NodeKind,
      parent: (y.get('parent') as NodeId | null) ?? null,
      children,
      // Ensure `z` exists on every read — older docs predate the
      // 3D-camera era and persisted Transform without `z`. Spread
      // defaults under the persisted shape so the field is always
      // numeric, never undefined.
      transform: {
        ...DEFAULT_TRANSFORM,
        ...((y.get('transform') as Partial<Transform>) ?? {}),
      },
      appearance: (y.get('appearance') as Appearance) ?? DEFAULT_APPEARANCE,
      visible: (y.get('visible') as boolean) ?? true,
      locked: (y.get('locked') as boolean) ?? false,
      // Default to 'flow' for legacy documents predating the field. New
      // nodes write the value explicitly in createNode below.
      position: ((y.get('position') as 'flow' | 'absolute') ?? 'flow'),
      // `isMask` defaults to false on legacy docs that predate the
      // mask feature. createNode writes false explicitly so newly-
      // created nodes are also non-masks until the user opts in.
      isMask: ((y.get('isMask') as boolean | undefined) ?? false),
      componentSourceId:
        (y.get('componentSourceId') as NodeId | null | undefined) ?? null,
      workspaceOnly: (y.get('workspaceOnly') as boolean | undefined) ?? false,
    }
    const kind = base.kind
    switch (kind) {
      case 'frame':
        return {
          ...base,
          kind,
          size: (y.get('size') as Size) ?? DEFAULT_SIZE,
          layout: normalizeLayout(y.get('layout')),
          clipsContent: (y.get('clipsContent') as boolean) ?? true,
          // Default to no guides on legacy / fresh frames. The
          // Inspector's Layout-guide section adds entries on demand.
          layoutGuides:
            (y.get('layoutGuides') as FrameNode['layoutGuides']) ?? [],
        } as FrameNode
      case 'rect':
      case 'ellipse':
      case 'image':
        return {
          ...base,
          kind,
          size: (y.get('size') as Size) ?? DEFAULT_SIZE,
          ...(kind === 'image'
            ? {
                src: (y.get('src') as string) ?? '',
                fit: (y.get('fit') as 'cover' | 'contain' | 'fill' | 'none') ?? 'cover',
                importWarning: (y.get('importWarning') as string | undefined) ?? undefined,
              }
            : {}),
        } as Node
      case 'video':
      case 'audio':
        return {
          ...base,
          kind,
          // Audio nodes get a compact default chip size; video keeps the
          // normal 100×100 so it's visible immediately. Both honor any
          // caller-supplied size override.
          size:
            (y.get('size') as Size) ??
            (kind === 'audio' ? { width: 120, height: 40 } : DEFAULT_SIZE),
          src: (y.get('src') as string) ?? '',
          duration: (y.get('duration') as number) ?? 0,
          volume: (y.get('volume') as number) ?? 1,
          startTime: (y.get('startTime') as number) ?? 0,
          trimStart: (y.get('trimStart') as number) ?? 0,
          trimEnd:
            (y.get('trimEnd') as number | undefined) ??
            ((y.get('duration') as number) ?? 0),
          loop: (y.get('loop') as boolean) ?? false,
          muted:
            (y.get('muted') as boolean | undefined) ??
            (kind === 'video' ? true : false),
          ...(kind === 'video'
            ? {
                fit: (y.get('fit') as 'cover' | 'contain' | 'fill' | 'none') ?? 'cover',
              }
            : {}),
        } as Node
      case 'text':
        return {
          ...base,
          kind,
          // Default to hug/hug so legacy documents (pre-size) come back
          // sized to their content — the visual intent for text without
          // an explicit box is "as wide/tall as the glyphs need".
          size: (y.get('size') as Size) ?? { width: 'hug', height: 'hug' },
          text: (y.get('text') as string) ?? '',
          fontFamily: (y.get('fontFamily') as string) ?? 'Inter',
          fontSize: (y.get('fontSize') as number) ?? 16,
          fontWeight: (y.get('fontWeight') as number) ?? 400,
          lineHeight: (y.get('lineHeight') as number) ?? 1.4,
          letterSpacing: (y.get('letterSpacing') as number) ?? 0,
          textAlign: (y.get('textAlign') as 'start' | 'center' | 'end') ?? 'start',
          color: (y.get('color') as string) ?? '#0a0a0c',
          textAnimation: normalizeTextAnimation(y.get('textAnimation')),
        } as Node
      case 'component':
        return {
          ...base,
          kind,
          size: (y.get('size') as Size) ?? DEFAULT_SIZE,
          layout: normalizeLayout(y.get('layout')),
          variants:
            (y.get('variants') as import('@/scene/types').VariantAxis[]) ?? [],
          defaultSelection:
            (y.get('defaultSelection') as Record<string, string>) ?? {},
          variantOverrides:
            (y.get('variantOverrides') as import('@/scene/types').VariantOverride[]) ?? [],
          variantPositions:
            (y.get('variantPositions') as import('@/scene/types').ComponentNode['variantPositions']) ?? {},
          componentProperties:
            (y.get('componentProperties') as import('@/scene/types').ComponentPropertyDefinition[]) ?? [],
          variantTransition:
            (y.get('variantTransition') as import('@/scene/types').VariantTransition) ??
            DEFAULT_VARIANT_TRANSITION,
          timelines:
            (y.get('timelines') as import('@/scene/types').ComponentNode['timelines']) ?? {},
          interactions:
            (y.get('interactions') as import('@/scene/types').Interaction[]) ?? [],
        } as Node
      case 'instance':
        return {
          ...base,
          kind,
          size: (y.get('size') as Size) ?? DEFAULT_SIZE,
          layout: normalizeLayout(y.get('layout')),
          componentId: y.get('componentId') as NodeId,
          selection: (y.get('selection') as Record<string, string>) ?? {},
          overrides: (y.get('overrides') as Record<NodeId, Record<string, unknown>>) ?? {},
          interactions:
            (y.get('interactions') as import('@/scene/types').Interaction[]) ?? [],
        } as Node
      case 'camera': {
        const canvas =
          (meta.get('canvas') as SceneMeta['canvas'] | undefined) ??
          DEFAULT_META.canvas
        const centerX = canvas.width / 2
        const centerY = canvas.height / 2
        const rawFocusX = y.get('focusX') as number | undefined
        const rawFocusY = y.get('focusY') as number | undefined
        return {
          ...base,
          kind,
          // Legacy-safe defaults: '2d' + enabled=true. Older persisted
          // cameras (if any exist before migration) will read through
          // these so the render path never sees undefined.
          projection:
            (y.get('projection') as CameraNode['projection'] | undefined) ?? '2d',
          enabled: (y.get('enabled') as boolean) ?? true,
          // Background fill predates v2 cameras → default null. The
          // renderer interprets null as "use workspace chrome behind
          // the camera viewport," matching old behavior.
          background:
            (y.get('background') as CameraNode['background']) ?? null,
          focalLength: (y.get('focalLength') as number | undefined) ?? 1000,
          fieldOfView: (y.get('fieldOfView') as number | undefined) ?? 35,
          pointOfInterestX:
            (y.get('pointOfInterestX') as number | undefined) ??
            ((y.get('focusWorldX') as number | undefined) ??
              ((y.get('transform') as Transform | undefined)?.x ?? 0)),
          pointOfInterestY:
            (y.get('pointOfInterestY') as number | undefined) ??
            ((y.get('focusWorldY') as number | undefined) ??
              ((y.get('transform') as Transform | undefined)?.y ?? 0)),
          pointOfInterestZ:
            (y.get('pointOfInterestZ') as number | undefined) ??
            ((y.get('focusWorldZ') as number | undefined) ?? 0),
          nearClip: (y.get('nearClip') as number | undefined) ?? 1,
          farClip: (y.get('farClip') as number | undefined) ?? 100000,
          depthOfField: (y.get('depthOfField') as boolean | undefined) ?? false,
          focusMode:
            (y.get('focusMode') as CameraNode['focusMode'] | undefined) ?? 'screen',
          focusX: rawFocusX ?? centerX,
          focusY: rawFocusY ?? centerY,
          focusWorldX:
            (y.get('focusWorldX') as number | undefined) ??
            (rawFocusX ?? centerX),
          focusWorldY:
            (y.get('focusWorldY') as number | undefined) ??
            (rawFocusY ?? centerY),
          focusWorldZ:
            (y.get('focusWorldZ') as number | undefined) ??
            ((y.get('focusDistance') as number | undefined) ?? 0),
          focusTargetNodeId:
            (y.get('focusTargetNodeId') as NodeId | null | undefined) ?? null,
          focusDistance: (y.get('focusDistance') as number | undefined) ?? 0,
          focusRadius: (y.get('focusRadius') as number | undefined) ?? 160,
          focusFalloff: (y.get('focusFalloff') as number | undefined) ?? 180,
          aperture: (y.get('aperture') as number | undefined) ?? 0,
          iso: (y.get('iso') as number | undefined) ?? 100,
          blurLevel: (y.get('blurLevel') as number | undefined) ?? 1,
          blurQuality: (y.get('blurQuality') as number | undefined) ?? 8,
          showFocusPlane: (y.get('showFocusPlane') as boolean | undefined) ?? false,
        } as CameraNode
      }
      default: {
        // Exhaustiveness check — TS will fail here if a NodeKind is unhandled.
        const _exhaustive: never = kind
        throw new Error(`Unhandled node kind: ${String(_exhaustive)}`)
      }
    }
  }

  const yTrackToTrack = (y: Y.Map<unknown>): Track => ({
    id: y.get('id') as TrackId,
    nodeId: y.get('nodeId') as NodeId,
    propertyId: y.get('propertyId') as PropertyId,
    keyframes: (y.get('keyframes') as Keyframe[]) ?? [],
    defaultEasing: (y.get('defaultEasing') as Track['defaultEasing']) ?? 'ease-in-out',
    textAnimation: normalizeTextAnimation(y.get('textAnimation')),
  })

  // --- API implementation -----------------------------------------------
  const api: SceneAPI = {
    doc,

    getMeta: () => {
      const out: Record<string, unknown> = {}
      for (const key of meta.keys()) out[key] = meta.get(key)
      return out as unknown as SceneMeta
    },

    getRoot: () => (scene.get('root') as NodeId | undefined) ?? '',

    getActiveCameraId: () => (scene.get('activeCameraId') as NodeId | undefined) ?? null,

    getActiveCamera: () => {
      const id = scene.get('activeCameraId') as NodeId | undefined
      if (!id) return null
      const y = nodes.get(id)
      if (!y) return null
      const n = yNodeToNode(y)
      return n.kind === 'camera' ? n : null
    },

    setActiveCameraId: (id) => {
      const y = nodes.get(id)
      if (!y) throw new Error(`Camera not found: ${id}`)
      const kind = y.get('kind') as NodeKind
      if (kind !== 'camera') {
        throw new Error(`Node ${id} is not a camera (kind=${kind})`)
      }
      doc.transact(() => {
        scene.set('activeCameraId', id)
      })
    },

    getNode: (id) => {
      const y = nodes.get(id)
      return y ? yNodeToNode(y) : null
    },

    getChildren: (id) => {
      const y = nodes.get(id)
      if (!y) return []
      const childrenValue = y.get('children') as
        | Y.Array<NodeId>
        | NodeId[]
        | undefined
      const childIds = Array.isArray(childrenValue)
        ? childrenValue
        : childrenValue
          ? childrenValue.toArray()
          : []
      return childIds
        .map((cid) => nodes.get(cid))
        .filter((n): n is Y.Map<unknown> => !!n)
        .map(yNodeToNode)
    },

    getAllNodeIds: () => Array.from(nodes.keys()),

    getTrack: (id) => {
      const y = tracks.get(id)
      return y ? yTrackToTrack(y) : null
    },

    getAllTracks: () => Array.from(tracks.values()).map(yTrackToTrack),

    getTracksForNode: (nodeId) => {
      const out: Track[] = []
      for (const t of tracks.values()) {
        if ((t.get('nodeId') as NodeId) === nodeId) out.push(yTrackToTrack(t))
      }
      return out
    },

    setMeta: (patch) => {
      doc.transact(() => {
        for (const [k, v] of Object.entries(patch)) meta.set(k, v)
      })
    },

    createNode: (kind, parent, props) => {
      const id = genId()
      doc.transact(() => {
        const y = new Y.Map<unknown>()
        y.set('id', id)
        y.set('kind', kind)
        y.set('name', props?.name ?? defaultName(kind))
        y.set('parent', parent)
        y.set('children', new Y.Array<NodeId>())
        y.set('transform', (props as Partial<FrameNode>)?.transform ?? DEFAULT_TRANSFORM)
        // Text picks a fill-less default; every other kind falls through
        // to DEFAULT_APPEARANCE. Any caller-supplied appearance wins.
        const defaultAppearance =
          kind === 'text' ? TEXT_DEFAULT_APPEARANCE : DEFAULT_APPEARANCE
        y.set('appearance', (props as Partial<FrameNode>)?.appearance ?? defaultAppearance)
        y.set('visible', props?.visible ?? true)
        y.set('locked', props?.locked ?? false)
        // Default to 'flow' so new nodes participate in their parent's
        // auto layout. Callers can override via props (e.g. drawn-into
        // a flex parent might want 'absolute' so the user's drop point
        // is honored — see Step 3.66 follow-up).
        y.set('position', (props as { position?: 'flow' | 'absolute' })?.position ?? 'flow')
        // Mask flag — see NodeBase.isMask for semantics. Default false.
        y.set('isMask', (props as { isMask?: boolean })?.isMask ?? false)
        y.set(
          'componentSourceId',
          (props as { componentSourceId?: NodeId | null })?.componentSourceId ?? null,
        )
        y.set('workspaceOnly', (props as { workspaceOnly?: boolean })?.workspaceOnly ?? false)

        // kind-specific defaults
        if (kind === 'frame' || kind === 'component') {
          y.set('size', (props as Partial<FrameNode>)?.size ?? DEFAULT_SIZE)
          y.set('layout', (props as Partial<FrameNode>)?.layout ?? DEFAULT_LAYOUT)
          if (kind === 'frame') {
            y.set('clipsContent', (props as Partial<FrameNode>)?.clipsContent ?? true)
            y.set(
              'layoutGuides',
              (props as Partial<FrameNode>)?.layoutGuides ?? [],
            )
          } else {
            const cp = props as Partial<import('@/scene/types').ComponentNode> | undefined
            y.set('variants', cp?.variants ?? [])
            y.set('defaultSelection', cp?.defaultSelection ?? {})
            y.set('variantOverrides', cp?.variantOverrides ?? [])
            y.set('componentProperties', cp?.componentProperties ?? [])
            y.set('variantTransition', cp?.variantTransition ?? DEFAULT_VARIANT_TRANSITION)
            y.set('timelines', cp?.timelines ?? {})
            y.set('interactions', cp?.interactions ?? [])
          }
        }
        if (kind === 'rect' || kind === 'ellipse' || kind === 'image') {
          y.set('size', (props as Partial<FrameNode>)?.size ?? DEFAULT_SIZE)
        }
        if (kind === 'video' || kind === 'audio') {
          // Video takes the normal 100×100 default; audio gets a compact
          // speaker-chip footprint (audio doesn't paint anything, it's
          // just a handle on the canvas + a row in the layers panel).
          type MediaProps = Partial<{
            size: Size; src: string; duration: number; volume: number;
            startTime: number; trimStart: number; trimEnd: number; loop: boolean;
            fit: 'cover' | 'contain' | 'fill' | 'none'; muted: boolean;
          }>
          const mp = (props ?? {}) as MediaProps
          const defaultSize: Size =
            kind === 'audio' ? { width: 120, height: 40 } : DEFAULT_SIZE
          y.set('size', mp.size ?? defaultSize)
          y.set('src', mp.src ?? '')
          y.set('duration', mp.duration ?? 0)
          y.set('volume', mp.volume ?? 1)
          y.set('startTime', mp.startTime ?? 0)
          y.set('trimStart', mp.trimStart ?? 0)
          y.set('trimEnd', mp.trimEnd ?? mp.duration ?? 0)
          y.set('loop', mp.loop ?? false)
          y.set('muted', mp.muted ?? (kind === 'video'))
          if (kind === 'video') {
            y.set('fit', mp.fit ?? 'cover')
            // Motion tools are primarily visual — default to muted so
            // a dropped MP4 doesn't surprise the user with audio.
          }
        }
        if (kind === 'image') {
          // Image src is a full URL or data: URL. For the MVP this is
          // typically a base64 data URL produced by readFileAsDataUrl()
          // at import time, which keeps the Yjs doc self-contained so
          // persistence + reopening Just Works. Later we'll move to a
          // content-addressed asset store (Cloudflare R2 when we ship
          // collab) so large images don't bloat the doc.
          const ip = props as Partial<ImageNode> | undefined
          y.set('src', ip?.src ?? '')
          y.set('fit', ip?.fit ?? 'cover')
          if (ip?.importWarning) y.set('importWarning', ip.importWarning)
        }
        if (kind === 'instance') {
          const ip = props as Partial<import('@/scene/types').InstanceNode> | undefined
          y.set('size', ip?.size ?? DEFAULT_SIZE)
          y.set('layout', ip?.layout ?? DEFAULT_LAYOUT)
          y.set('componentId', ip?.componentId ?? '')
          y.set('selection', ip?.selection ?? {})
          y.set('overrides', ip?.overrides ?? {})
          y.set('interactions', ip?.interactions ?? [])
        }
        if (kind === 'text') {
          // Text boxes default to hug/hug so a plain stamp ("click with
          // the T tool") sizes to its glyphs. If the caller (e.g. the
          // draw-to-place pointerup OR Cmd+D duplicate) passed an
          // explicit prop, honor it — every one of these needs to ??
          // through `props` so duplicates carry font, size, color, etc.
          // Previous revision hardcoded every text field, which meant
          // duplicates silently reset their typography.
          const tp = props as Partial<TextNode> | undefined
          y.set('size', tp?.size ?? { width: 'hug', height: 'hug' })
          y.set('text', tp?.text ?? 'Text')
          y.set('fontFamily', tp?.fontFamily ?? 'Inter')
          y.set('fontSize', tp?.fontSize ?? 16)
          y.set('fontWeight', tp?.fontWeight ?? 400)
          y.set('lineHeight', tp?.lineHeight ?? 1.4)
          y.set('letterSpacing', tp?.letterSpacing ?? 0)
          y.set('textAlign', tp?.textAlign ?? 'start')
          y.set('color', tp?.color ?? '#0a0a0c')
          y.set('textAnimation', normalizeTextAnimation(tp?.textAnimation) ?? null)
        }
        if (kind === 'camera') {
          // Cameras carry no size / layout / fill. They exist at the
          // document level (parent: null, not a child of root), and
          // their transform is interpreted by the render layer as the
          // view transform — inverse-applied to the artboard so
          // "camera x=100" pans the viewport right by 100px.
          const cp = props as Partial<CameraNode> | undefined
          y.set('projection', cp?.projection ?? '2d')
          y.set('enabled', cp?.enabled ?? true)
          // Background defaults to null — the camera's viewport falls
          // back to the workspace chrome until the user picks a fill
          // in the inspector.
          y.set('background', cp?.background ?? null)
          // Focal length default = 1000, matching the historical
          // hardcoded perspective value so legacy scenes render the
          // same. Larger = more telephoto (less distortion).
          y.set('focalLength', cp?.focalLength ?? 1000)
          y.set('fieldOfView', cp?.fieldOfView ?? 35)
          y.set('pointOfInterestX', cp?.pointOfInterestX ?? (cp?.focusWorldX ?? (cp?.transform?.x ?? 0)))
          y.set('pointOfInterestY', cp?.pointOfInterestY ?? (cp?.focusWorldY ?? (cp?.transform?.y ?? 0)))
          y.set('pointOfInterestZ', cp?.pointOfInterestZ ?? (cp?.focusWorldZ ?? 0))
          y.set('nearClip', cp?.nearClip ?? 1)
          y.set('farClip', cp?.farClip ?? 100000)
          const canvas =
            (meta.get('canvas') as SceneMeta['canvas'] | undefined) ??
            DEFAULT_META.canvas
          const centerX = canvas.width / 2
          const centerY = canvas.height / 2
          y.set('depthOfField', cp?.depthOfField ?? false)
          y.set('focusMode', cp?.focusMode ?? 'screen')
          y.set('focusX', cp?.focusX ?? centerX)
          y.set('focusY', cp?.focusY ?? centerY)
          y.set('focusWorldX', cp?.focusWorldX ?? (cp?.focusX ?? centerX))
          y.set('focusWorldY', cp?.focusWorldY ?? (cp?.focusY ?? centerY))
          y.set('focusWorldZ', cp?.focusWorldZ ?? (cp?.focusDistance ?? 0))
          y.set('focusTargetNodeId', cp?.focusTargetNodeId ?? null)
          y.set('focusDistance', cp?.focusDistance ?? 0)
          y.set('focusRadius', cp?.focusRadius ?? 160)
          y.set('focusFalloff', cp?.focusFalloff ?? 180)
          y.set('aperture', cp?.aperture ?? 0)
          y.set('iso', cp?.iso ?? 100)
          y.set('blurLevel', cp?.blurLevel ?? 1)
          y.set('blurQuality', cp?.blurQuality ?? 8)
          y.set('showFocusPlane', cp?.showFocusPlane ?? false)
        }

        nodes.set(id, y)

        // Link to parent's children array if a parent was given.
        if (parent) {
          const p = ensureNode(parent)
          const arr = p.get('children') as Y.Array<NodeId>
          arr.push([id])
        } else if (
          !scene.get('root') &&
          kind !== 'camera' &&
          !((props as { workspaceOnly?: boolean })?.workspaceOnly ?? false)
        ) {
          // First parentless non-camera node becomes the root. Cameras
          // are always parent=null but must never win root — the root
          // slot is reserved for the artboard Frame.
          scene.set('root', id)
        }
      })
      return id
    },

    deleteNode: (id) => {
      const y = nodes.get(id)
      if (!y) return
      doc.transact(() => {
        // Detach from parent
        const parent = y.get('parent') as NodeId | null
        if (parent) {
          const p = nodes.get(parent)
          if (p) {
            const arr = p.get('children') as Y.Array<NodeId> | undefined
            if (arr) {
              const list = arr.toArray()
              const idx = list.indexOf(id)
              if (idx >= 0) arr.delete(idx, 1)
            }
          }
        }
        // Recursively delete children
        const kids = y.get('children') as Y.Array<NodeId> | undefined
        const kidIds = kids ? [...kids.toArray()] : []
        for (const k of kidIds) api.deleteNode(k)
        nodes.delete(id)
        if (scene.get('root') === id) scene.set('root', '')
      })
    },

    setNodeProperty: (nodeId, key, value) => {
      const y = ensureNode(nodeId)
      doc.transact(() => {
        y.set(key, value)
      })
    },

    appendChild: (parent, child) => {
      const p = ensureNode(parent)
      const c = ensureNode(child)
      doc.transact(() => {
        const oldParent = c.get('parent') as NodeId | null
        if (oldParent) {
          const op = nodes.get(oldParent)
          if (op) {
            const arr = op.get('children') as Y.Array<NodeId>
            const idx = arr.toArray().indexOf(child)
            if (idx >= 0) arr.delete(idx, 1)
          }
        }
        c.set('parent', parent)
        const arr = p.get('children') as Y.Array<NodeId>
        arr.push([child])
      })
    },

    moveChild: (parent, childId, toIndex) => {
      const p = ensureNode(parent)
      doc.transact(() => {
        const arr = p.get('children') as Y.Array<NodeId>
        const list = arr.toArray()
        const fromIndex = list.indexOf(childId)
        if (fromIndex < 0) return
        arr.delete(fromIndex, 1)
        const clamp = Math.max(0, Math.min(toIndex, arr.length))
        arr.insert(clamp, [childId])
      })
    },

    setTrack: (track) => {
      doc.transact(() => {
        let y = tracks.get(track.id)
        if (!y) {
          y = new Y.Map<unknown>()
          tracks.set(track.id, y)
        }
        y.set('id', track.id)
        y.set('nodeId', track.nodeId)
        y.set('propertyId', track.propertyId)
        y.set('defaultEasing', track.defaultEasing)
        y.set('textAnimation', normalizeTextAnimation(track.textAnimation) ?? null)
        // Keyframes are a plain array — swap wholesale. Fine for v1;
        // collaborators editing the same track keyframe list will
        // last-writer-wins. Split into nested Y.Array later if needed.
        y.set('keyframes', track.keyframes)
      })
    },

    deleteTrack: (id) => {
      doc.transact(() => {
        tracks.delete(id)
      })
    },

    getSections: () => {
      const out: Section[] = []
      sections.forEach((s) => {
        if (s && typeof s.id === 'string') out.push(s)
      })
      out.sort((a, b) => a.start - b.start)
      return out
    },

    setSection: (section) => {
      // Clamp end >= start so the renderer never has to deal with
      // a backwards span. Negative-width pills are confusing and
      // break drag math.
      const clamped: Section = {
        ...section,
        end: Math.max(section.end, section.start),
      }
      doc.transact(() => {
        sections.set(clamped.id, clamped)
      })
    },

    deleteSection: (id) => {
      doc.transact(() => {
        sections.delete(id)
      })
    },

    setCustomFont: (font) => {
      // Idempotent on font.id — overwrite if present. Useful when
      // re-uploading a corrected file (e.g. user fixed the family
      // name) without churning a new id through every text node.
      doc.transact(() => {
        customFonts.set(font.id, font)
      })
    },

    getCustomFont: (id) => {
      const v = customFonts.get(id)
      return v ?? null
    },

    getAllCustomFonts: () => {
      const out: import('@/scene/types').CustomFont[] = []
      customFonts.forEach((f) => {
        if (f && typeof f.id === 'string') out.push(f)
      })
      return out
    },

    removeCustomFont: (id) => {
      doc.transact(() => {
        customFonts.delete(id)
      })
    },

    getUiState: () => {
      // Defensive read — a fresh / partial doc may have any subset of
      // the slab keys missing, so spread the defaults under the
      // persisted shape. Returns a plain object; callers must round-
      // trip through setUiState to persist mutations.
      return {
        ...DEFAULT_UI_STATE,
        ...((uiState.get('trackGroups')
          ? { trackGroups: uiState.get('trackGroups') as UiStateSlab['trackGroups'] }
          : {}) as Partial<UiStateSlab>),
        ...((uiState.get('kfGroups')
          ? { kfGroups: uiState.get('kfGroups') as UiStateSlab['kfGroups'] }
          : {}) as Partial<UiStateSlab>),
        ...((uiState.get('kfGroupCollapsed')
          ? { kfGroupCollapsed: uiState.get('kfGroupCollapsed') as UiStateSlab['kfGroupCollapsed'] }
          : {}) as Partial<UiStateSlab>),
      }
    },

    setUiState: (patch) => {
      doc.transact(() => {
        for (const [k, v] of Object.entries(patch)) {
          uiState.set(k, v)
        }
      })
    },

    getVersion: () => version,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  // Seed a default active camera if the doc doesn't already have one,
  // OR if the stored id points to a node that no longer exists (which
  // can happen if the user deleted the camera — we never promise the
  // API keeps activeCameraId in sync on delete, so self-heal here).
  //
  // Legacy docs persisted before the camera model existed come in
  // without activeCameraId; the check below backfills them silently
  // on first open so every scene is guaranteed a working camera.
  // Also covers brand-new docs where this is the first write.
  //
  // The default position places the camera at the artboard center. The
  // render layer treats the camera's position as the pivot for rotation
  // and zoom (standard 2D-camera math), so starting at center means
  // users get "rotation spins around the middle of the scene" out of
  // the box — the natural expectation.
  {
    const existingId = scene.get('activeCameraId') as NodeId | undefined
    const existingOk = existingId && nodes.has(existingId)
    // Don't seed if the stored id is valid AND still refers to a camera.
    const existingKind = existingOk
      ? (nodes.get(existingId)!.get('kind') as NodeKind)
      : null
    const needsSeed = !existingOk || existingKind !== 'camera'
    if (needsSeed) {
      const metaNow = api.getMeta()
      const camId = api.createNode('camera', null, {
        name: 'Camera',
        transform: {
          x: metaNow.canvas.width / 2,
          y: metaNow.canvas.height / 2,
          z: 0,
          rotation: 0,
          rotationX: 0,
          rotationY: 0,
          scaleX: 1,
          scaleY: 1,
        },
      })
      doc.transact(() => {
        scene.set('activeCameraId', camId)
      })
    } else if (existingId) {
      // Migration: older docs persisted a camera whose transform defaulted
      // to (0, 0) — the generic DEFAULT_TRANSFORM — because the seed
      // above wasn't yet in place (or an intermediate bug dropped the
      // caller-supplied transform). A camera at the artboard origin
      // instead of its center makes the view transform reduce to
      // `translate(W/2, H/2)`, which shifts every piece of scene chrome
      // (selection outlines, distance labels, draw previews) down-right
      // by half the artboard while the artboard fill itself stays put.
      // Reads visually as "the scene is disconnected from the camera."
      //
      // Detect the degenerate identity pose and reseat the camera at
      // artboard center. Only runs when the transform is EXACTLY the
      // default — if the user had panned / scaled / rotated, we respect
      // their edit and stay out of the way.
      const camY = nodes.get(existingId)!
      const camT = camY.get('transform') as Transform | undefined
      const meta2 = api.getMeta()
      const targetX = meta2.canvas.width / 2
      const targetY = meta2.canvas.height / 2
      const isDegenerateDefault =
        !!camT &&
        camT.x === 0 &&
        camT.y === 0 &&
        camT.rotation === 0 &&
        camT.scaleX === 1 &&
        camT.scaleY === 1
      if (isDegenerateDefault) {
        doc.transact(() => {
          camY.set('transform', {
            x: targetX,
            y: targetY,
            z: 0,
            rotation: 0,
            rotationX: 0,
            rotationY: 0,
            scaleX: 1,
            scaleY: 1,
          } satisfies Transform)
        })
      }
      const hasFocusPositionTrack = Array.from(tracks.values()).some((track) => {
        if ((track.get('nodeId') as NodeId | undefined) !== existingId) return false
        const propertyId = track.get('propertyId') as PropertyId | undefined
        return propertyId === 'camera.focusX' || propertyId === 'camera.focusY'
      })
      const focusMode = camY.get('focusMode') as CameraNode['focusMode'] | undefined
      const focusX = camY.get('focusX') as number | undefined
      const focusY = camY.get('focusY') as number | undefined
      const isOldPlaneOriginFocus =
        !hasFocusPositionTrack &&
        (focusMode === undefined || focusMode === 'plane' || focusMode === 'screen') &&
        (focusX === undefined || focusX === 0) &&
        (focusY === undefined || focusY === 0)
      if (isOldPlaneOriginFocus) {
        doc.transact(() => {
          camY.set('focusMode', 'screen')
          camY.set('focusX', targetX)
          camY.set('focusY', targetY)
          camY.set('focusWorldX', targetX)
          camY.set('focusWorldY', targetY)
          camY.set('focusWorldZ', camY.get('focusWorldZ') ?? 0)
          camY.set('focusTargetNodeId', null)
        })
      }
    }
  }

  return api
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function ensureMap(parent: Y.Map<unknown>, key: string): Y.Map<unknown> {
  let m = parent.get(key) as Y.Map<unknown> | undefined
  if (!m) {
    m = new Y.Map<unknown>()
    parent.set(key, m)
  }
  return m
}

function genId(): NodeId {
  // Short, URL-safe, collision-resistant-enough for a client-local scene.
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
}

function defaultName(kind: NodeKind): string {
  switch (kind) {
    case 'frame': return 'Frame'
    case 'rect': return 'Rectangle'
    case 'ellipse': return 'Ellipse'
    case 'text': return 'Text'
    case 'image': return 'Image'
    case 'video': return 'Video'
    case 'audio': return 'Audio'
    case 'component': return 'Component'
    case 'instance': return 'Instance'
    case 'camera': return 'Camera'
  }
}

/** Convenience: read the whole scene as a plain object (expensive — for export/debug only). */
export function snapshotScene(api: SceneAPI): Scene {
  const nodes: Record<NodeId, Node> = {}
  for (const id of api.getAllNodeIds()) {
    const n = api.getNode(id)
    if (n) nodes[id] = n
  }
  const sections: Record<string, Section> = {}
  for (const s of api.getSections()) sections[s.id] = s
  const customFonts: Record<string, import('@/scene/types').CustomFont> = {}
  for (const f of api.getAllCustomFonts()) customFonts[f.id] = f
  const tracks: Record<TrackId, Track> = {}
  for (const t of api.getAllTracks()) tracks[t.id] = t
  return {
    meta: api.getMeta(),
    root: api.getRoot(),
    activeCameraId: api.getActiveCameraId() ?? '',
    nodes,
    tracks,
    sections,
    customFonts,
  }
}

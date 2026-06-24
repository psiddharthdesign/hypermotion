// SPDX-License-Identifier: Apache-2.0

/**
 * Build a `.hype` file from a plain JSON scene description.
 *
 * The CLI is standalone — it doesn't import the desktop app's
 * SceneAPI. To produce a `.hype` we mirror the SceneAPI's Y.Doc
 * layout directly: a top-level `scene` Y.Map carrying `nodes`,
 * `tracks`, `meta`, `sections`, plus the scalar `root` and
 * `activeCameraId`. The encoded update bytes are byte-identical
 * (mod CRDT history details) to what the desktop app's
 * `sceneToBytes` produces, so the desktop app reads our output
 * back without any special handling.
 *
 * Why duplicate the Y layout instead of importing the desktop app's
 * code: the CLI ships independently on npm and the desktop app's
 * SceneAPI pulls in React, Zustand, Pixi — none of which belong
 * inside a Node-only CLI. We treat the Y layout as a wire format
 * and write to it directly.
 */

import * as Y from 'yjs'

// Plain JSON types the CLI accepts. We don't import the desktop
// app's `Scene` shape because the CLI is its own npm package, but
// the schema below is the same shape the agent produces.

export interface SceneJson {
  meta?: {
    id?: string
    name?: string
    duration?: number
    frameRate?: number
    canvas?: { width: number; height: number }
  }
  root?: string
  activeCameraId?: string
  nodes?: Record<string, NodeJson>
  tracks?: Record<string, TrackJson>
  sections?: Record<string, SectionJson>
}

export interface NodeJson {
  id: string
  kind:
    | 'frame'
    | 'rect'
    | 'ellipse'
    | 'text'
    | 'image'
    | 'video'
    | 'audio'
    | 'component'
    | 'instance'
    | 'camera'
  name?: string
  parent?: string | null
  children?: string[]
  visible?: boolean
  locked?: boolean
  position?: 'flow' | 'absolute'
  isMask?: boolean
  componentSourceId?: string | null
  transform?: {
    x: number
    y: number
    z?: number
    rotation: number
    rotationX?: number
    rotationY?: number
    scaleX: number
    scaleY: number
    anchorX?: number
    anchorY?: number
    anchorZ?: number
    space?: 'local' | 'world'
    renderMode?: 'flat' | 'plane' | 'group3d'
  }
  appearance?: Record<string, unknown>
  size?: { width: number | 'hug' | 'fill'; height: number | 'hug' | 'fill' }
  layout?: Record<string, unknown>
  variants?: unknown[]
  defaultSelection?: Record<string, string>
  variantOverrides?: unknown[]
  variantTransition?: unknown
  timelines?: Record<string, unknown>
  interactions?: unknown[]
  componentId?: string
  selection?: Record<string, string>
  overrides?: Record<string, Record<string, unknown>>
  clipsContent?: boolean
  layoutGuides?: unknown[]
  // kind-specific
  text?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  lineHeight?: number
  letterSpacing?: number
  textAlign?: 'start' | 'center' | 'end'
  color?: string
  src?: string
  fit?: 'cover' | 'contain' | 'fill' | 'none'
  duration?: number
  volume?: number
  startTime?: number
  trimStart?: number
  trimEnd?: number
  loop?: boolean
  muted?: boolean
  projection?: '2d' | '3d'
  enabled?: boolean
  background?: unknown
  focalLength?: number
  fieldOfView?: number
  pointOfInterestX?: number
  pointOfInterestY?: number
  pointOfInterestZ?: number
  nearClip?: number
  farClip?: number
  depthOfField?: boolean
  focusMode?: 'plane' | 'target' | 'screen'
  focusX?: number
  focusY?: number
  focusWorldX?: number
  focusWorldY?: number
  focusWorldZ?: number
  focusTargetNodeId?: string | null
  focusDistance?: number
  focusRadius?: number
  focusFalloff?: number
  aperture?: number
  iso?: number
  blurLevel?: number
  blurQuality?: number
  showFocusPlane?: boolean
}

export interface TrackJson {
  id: string
  nodeId: string
  propertyId: string
  defaultEasing?: unknown
  keyframes: Array<{
    id: string
    time: number
    value: unknown
    easingOut?: unknown
    presetOrigin?: 'in' | 'out'
  }>
}

export interface SectionJson {
  id: string
  name: string
  color: string
  start: number
  end: number
}

const DEFAULT_TRANSFORM = {
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

const DEFAULT_APPEARANCE = {
  opacity: 1,
  fill: null,
  stroke: null,
  cornerRadius: 0,
  effects: [],
}

const DEFAULT_PADDING = { top: 0, right: 0, bottom: 0, left: 0 }

const DEFAULT_LAYOUT = {
  mode: 'none',
  direction: 'column',
  justify: 'start',
  align: 'start',
  gap: 0,
  padding: DEFAULT_PADDING,
  wrap: false,
  columns: 1,
  rowGap: 0,
  columnGap: 0,
}

const DEFAULT_SIZE = { width: 100, height: 100 }

const DEFAULT_META = {
  id: 'scene',
  name: 'Untitled',
  duration: 5,
  frameRate: 60,
  canvas: { width: 960, height: 540 },
}

/**
 * Construct a Y.Doc that matches what the desktop app would persist,
 * then return its encoded update bytes (the `.hype` payload).
 *
 * IDs in the JSON are used as-is — no mapping. The desktop app's
 * `applyJsonToScene` does map IDs because it loads INTO an existing
 * doc with auto-seeded entries; here we're building a fresh doc so
 * there's nothing to collide with.
 */
export function buildSceneBytes(json: SceneJson): Uint8Array {
  const doc = new Y.Doc()
  const scene = doc.getMap<unknown>('scene')

  // --- meta ---
  const meta = new Y.Map<unknown>()
  scene.set('meta', meta)
  const metaIn = { ...DEFAULT_META, ...(json.meta ?? {}) }
  for (const [k, v] of Object.entries(metaIn)) meta.set(k, v)

  // --- nodes ---
  const nodes = new Y.Map<Y.Map<unknown>>()
  scene.set('nodes', nodes)

  for (const [agentId, node] of Object.entries(json.nodes ?? {})) {
    const y = new Y.Map<unknown>()
    y.set('id', agentId)
    y.set('kind', node.kind)
    y.set('name', node.name ?? defaultName(node.kind))
    y.set('parent', node.parent ?? null)
    // Children: store as Y.Array so reorder ops work in the editor.
    const childArr = new Y.Array<string>()
    for (const c of node.children ?? []) childArr.push([c])
    y.set('children', childArr)
    y.set(
      'transform',
      mergeWithDefaults(DEFAULT_TRANSFORM, node.transform as Partial<typeof DEFAULT_TRANSFORM>),
    )
    y.set(
      'appearance',
      mergeWithDefaults(
        defaultAppearance(node.kind) as Record<string, unknown>,
        node.appearance,
      ),
    )
    y.set('visible', node.visible ?? true)
    y.set('locked', node.locked ?? false)
    y.set('position', node.position ?? 'flow')
    y.set('isMask', node.isMask ?? false)
    y.set('componentSourceId', node.componentSourceId ?? null)

    // kind-specific fields
    if (node.kind === 'frame' || node.kind === 'component') {
      y.set('size', mergeWithDefaults(DEFAULT_SIZE, node.size as Partial<typeof DEFAULT_SIZE>))
      y.set(
        'layout',
        mergeWithDefaults(
          DEFAULT_LAYOUT as Record<string, unknown>,
          node.layout,
        ),
      )
      if (node.kind === 'frame') {
        y.set('clipsContent', node.clipsContent ?? true)
        y.set('layoutGuides', node.layoutGuides ?? [])
      } else {
        y.set('variants', node.variants ?? [])
        y.set('defaultSelection', node.defaultSelection ?? {})
        y.set('variantOverrides', node.variantOverrides ?? [])
        y.set('variantTransition', node.variantTransition ?? {
          duration: 0.3,
          easing: 'ease-in-out',
          presetId: 'smooth',
          strength: 50,
        })
        y.set('timelines', node.timelines ?? {})
        y.set('interactions', node.interactions ?? [])
      }
    }
    if (node.kind === 'rect' || node.kind === 'ellipse' || node.kind === 'image') {
      y.set('size', mergeWithDefaults(DEFAULT_SIZE, node.size as Partial<typeof DEFAULT_SIZE>))
    }
    if (node.kind === 'image') {
      y.set('src', node.src ?? '')
      y.set('fit', node.fit ?? 'cover')
    }
    if (node.kind === 'instance') {
      y.set('size', mergeWithDefaults(DEFAULT_SIZE, node.size as Partial<typeof DEFAULT_SIZE>))
      y.set(
        'layout',
        mergeWithDefaults(
          DEFAULT_LAYOUT as Record<string, unknown>,
          node.layout,
        ),
      )
      y.set('componentId', node.componentId ?? '')
      y.set('selection', node.selection ?? {})
      y.set('overrides', node.overrides ?? {})
      y.set('interactions', node.interactions ?? [])
    }
    if (node.kind === 'video' || node.kind === 'audio') {
      y.set(
        'size',
        node.size ?? (node.kind === 'audio' ? { width: 120, height: 40 } : { width: 100, height: 100 }),
      )
      y.set('src', node.src ?? '')
      y.set('duration', node.duration ?? 0)
      y.set('volume', node.volume ?? 1)
      y.set('startTime', node.startTime ?? 0)
      y.set('trimStart', node.trimStart ?? 0)
      y.set('trimEnd', node.trimEnd ?? node.duration ?? 0)
      y.set('loop', node.loop ?? false)
      y.set('muted', node.muted ?? node.kind === 'video')
      if (node.kind === 'video') {
        y.set('fit', node.fit ?? 'cover')
      }
    }
    if (node.kind === 'text') {
      y.set('size', node.size ?? { width: 'hug', height: 'hug' })
      y.set('text', node.text ?? 'Text')
      y.set('fontFamily', node.fontFamily ?? 'Inter')
      y.set('fontSize', node.fontSize ?? 16)
      y.set('fontWeight', node.fontWeight ?? 400)
      y.set('lineHeight', node.lineHeight ?? 1.4)
      y.set('letterSpacing', node.letterSpacing ?? 0)
      y.set('textAlign', node.textAlign ?? 'start')
      y.set('color', node.color ?? '#0a0a0c')
    }
    if (node.kind === 'camera') {
      const centerX = metaIn.canvas.width / 2
      const centerY = metaIn.canvas.height / 2
      y.set('projection', node.projection ?? '2d')
      y.set('enabled', node.enabled ?? true)
      y.set('background', node.background ?? null)
      y.set('focalLength', node.focalLength ?? 1000)
      y.set('fieldOfView', node.fieldOfView ?? 35)
      y.set('pointOfInterestX', node.pointOfInterestX ?? node.focusWorldX ?? node.transform?.x ?? 0)
      y.set('pointOfInterestY', node.pointOfInterestY ?? node.focusWorldY ?? node.transform?.y ?? 0)
      y.set('pointOfInterestZ', node.pointOfInterestZ ?? node.focusWorldZ ?? 0)
      y.set('nearClip', node.nearClip ?? 1)
      y.set('farClip', node.farClip ?? 100000)
      y.set('depthOfField', node.depthOfField ?? false)
      y.set('focusMode', node.focusMode ?? 'screen')
      y.set('focusX', node.focusX ?? centerX)
      y.set('focusY', node.focusY ?? centerY)
      y.set('focusWorldX', node.focusWorldX ?? node.focusX ?? centerX)
      y.set('focusWorldY', node.focusWorldY ?? node.focusY ?? centerY)
      y.set('focusWorldZ', node.focusWorldZ ?? node.focusDistance ?? 0)
      y.set('focusTargetNodeId', node.focusTargetNodeId ?? null)
      y.set('focusDistance', node.focusDistance ?? 0)
      y.set('focusRadius', node.focusRadius ?? 160)
      y.set('focusFalloff', node.focusFalloff ?? 180)
      y.set('aperture', node.aperture ?? 0)
      y.set('iso', node.iso ?? 100)
      y.set('blurLevel', node.blurLevel ?? 1)
      y.set('blurQuality', node.blurQuality ?? 8)
      y.set('showFocusPlane', node.showFocusPlane ?? false)
    }

    nodes.set(agentId, y)
  }

  // --- tracks ---
  const tracks = new Y.Map<Y.Map<unknown>>()
  scene.set('tracks', tracks)
  for (const [trackId, track] of Object.entries(json.tracks ?? {})) {
    const y = new Y.Map<unknown>()
    y.set('id', track.id ?? trackId)
    y.set('nodeId', track.nodeId)
    y.set('propertyId', track.propertyId)
    y.set('defaultEasing', track.defaultEasing ?? 'ease-in-out')
    y.set('keyframes', track.keyframes ?? [])
    tracks.set(trackId, y)
  }

  // --- sections ---
  const sections = new Y.Map<unknown>()
  scene.set('sections', sections)
  for (const [sectionId, section] of Object.entries(json.sections ?? {})) {
    sections.set(sectionId, section)
  }

  // --- scalars ---
  // root + activeCameraId. The desktop app auto-promotes the first
  // parentless non-camera node to root on load, so we don't strictly
  // need to set this — but doing so matches what `Save` produces and
  // makes round-trips byte-stable.
  if (json.root) scene.set('root', json.root)
  else {
    // Infer: first parentless non-camera node.
    for (const [agentId, node] of Object.entries(json.nodes ?? {})) {
      if (!node.parent && node.kind !== 'camera') {
        scene.set('root', agentId)
        break
      }
    }
  }
  if (json.activeCameraId) {
    scene.set('activeCameraId', json.activeCameraId)
  } else {
    // Infer: first camera node.
    for (const [agentId, node] of Object.entries(json.nodes ?? {})) {
      if (node.kind === 'camera') {
        scene.set('activeCameraId', agentId)
        break
      }
    }
  }

  // Seed an empty uiState map so the desktop app's ensureMap reads
  // back stable shape (groups, collapse flags, etc. are empty for a
  // freshly-built scene).
  scene.set('uiState', new Y.Map<unknown>())

  return Y.encodeStateAsUpdate(doc)
}

/**
 * Decode `.hype` bytes and return a plain JSON summary. Used by the
 * `info` command and the `info_scene` MCP tool. We pull just the
 * fields agents (and humans at a terminal) care about — full round-
 * trip isn't needed here, so we skip Y.Array → plain conversion for
 * children and keyframes if the caller doesn't ask for them.
 */
export function readSceneSummary(bytes: Uint8Array): {
  meta: Record<string, unknown>
  root: string | null
  activeCameraId: string | null
  layerCount: number
  trackCount: number
  sectionCount: number
  keyframeCount: number
} {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, bytes)
  const scene = doc.getMap<unknown>('scene')

  const metaMap = scene.get('meta') as Y.Map<unknown> | undefined
  const meta: Record<string, unknown> = {}
  if (metaMap) {
    for (const [k, v] of metaMap.entries()) meta[k] = v
  }

  const nodes = scene.get('nodes') as Y.Map<Y.Map<unknown>> | undefined
  const tracks = scene.get('tracks') as Y.Map<Y.Map<unknown>> | undefined
  const sections = scene.get('sections') as Y.Map<unknown> | undefined

  // Count keyframes across every track. Each track's `keyframes` is a
  // plain JS array (we store it via .set(arr), not as a Y.Array) so
  // we read it back with .get and check length.
  let keyframeCount = 0
  if (tracks) {
    for (const t of tracks.values()) {
      const kfs = t.get('keyframes') as unknown[] | undefined
      keyframeCount += kfs?.length ?? 0
    }
  }

  return {
    meta,
    root: (scene.get('root') as string | undefined) ?? null,
    activeCameraId: (scene.get('activeCameraId') as string | undefined) ?? null,
    layerCount: nodes?.size ?? 0,
    trackCount: tracks?.size ?? 0,
    sectionCount: sections?.size ?? 0,
    keyframeCount,
  }
}

/**
 * Merge agent-supplied partial fields onto a defaults object, recursing
 * into nested objects. Returns a fresh object — never mutates input.
 *
 * Critical for `appearance`, `transform`, `layout` — the desktop app
 * reads fields like `appearance.cornerRadius` and `layout.padding.top`
 * directly and calls `.toFixed()` / arithmetic on them. If the agent
 * passes `{ opacity: 1, fill: ... }` without cornerRadius, a shallow
 * `?? default` keeps the partial as-is and the desktop crashes on
 * `undefined.toFixed`. Deep-merge guarantees every leaf has a value.
 */
function mergeWithDefaults<T extends Record<string, unknown>>(
  defaults: T,
  patch: Partial<T> | undefined,
): T {
  if (!patch) return { ...defaults }
  const out: Record<string, unknown> = { ...defaults }
  for (const [k, v] of Object.entries(patch)) {
    const d = (defaults as Record<string, unknown>)[k]
    if (
      d != null &&
      typeof d === 'object' &&
      !Array.isArray(d) &&
      v != null &&
      typeof v === 'object' &&
      !Array.isArray(v)
    ) {
      out[k] = mergeWithDefaults(
        d as Record<string, unknown>,
        v as Record<string, unknown>,
      )
    } else {
      out[k] = v
    }
  }
  return out as T
}

function defaultName(kind: NodeJson['kind']): string {
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

function defaultAppearance(kind: NodeJson['kind']): Record<string, unknown> {
  if (kind === 'text') {
    return { ...DEFAULT_APPEARANCE, fill: null }
  }
  return { ...DEFAULT_APPEARANCE }
}

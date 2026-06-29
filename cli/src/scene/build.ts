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
    canvas?: Partial<SceneCanvas>
  }
  root?: string
  activeCameraId?: string | null
  nodes?: Record<string, NodeJson>
  tracks?: Record<string, TrackJson>
  sections?: Record<string, SectionJson>
}

export type TextAlignJson = 'start' | 'center' | 'end'

export type NodeKindJson =
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

export const NODE_KINDS = [
  'frame',
  'rect',
  'ellipse',
  'text',
  'image',
  'video',
  'audio',
  'component',
  'instance',
  'camera',
] as const satisfies readonly NodeKindJson[]

export interface SizeJson extends Record<string, unknown> {
  width?: number | 'hug' | 'fill'
  height?: number | 'hug' | 'fill'
}

export interface GradientStopJson {
  at: number
  color: string
}

export type FillJson =
  | { kind: 'solid'; color: string }
  | { kind: 'linear'; stops: GradientStopJson[]; angle: number }
  | {
      kind: 'radial'
      stops: GradientStopJson[]
      cx: number
      cy: number
      shape: 'circle' | 'ellipse'
    }
  | {
      kind: 'conic'
      stops: GradientStopJson[]
      angle: number
      cx: number
      cy: number
    }
  | {
      kind: 'image'
      src: string
      fit: 'cover' | 'contain' | 'fill' | 'tile'
    }

export type StrokeStyleJson = 'solid' | 'dashed' | 'dotted'

export type MediaFitJson = 'cover' | 'contain' | 'fill' | 'none'

export interface StrokeJson {
  color: string
  width: number
  align: 'inside' | 'center' | 'outside'
  style: StrokeStyleJson
  dashLength: number
  dashGap: number
  widths?: {
    top: number
    right: number
    bottom: number
    left: number
  }
  fill?: FillJson | null
}

export interface LayoutJson extends Record<string, unknown> {
  mode?: 'none' | 'flex' | 'grid'
  direction?: 'row' | 'column'
  justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around'
  align?: 'start' | 'center' | 'end' | 'stretch'
  gap?: number
  padding?: Partial<PaddingJson>
  wrap?: boolean
  columns?: number
  rowGap?: number
  columnGap?: number
}

export interface PaddingJson {
  top: number
  right: number
  bottom: number
  left: number
}

export interface NodeJson {
  id: string
  kind: NodeKindJson
  name?: string
  parent?: string | null
  children?: string[]
  visible?: boolean
  locked?: boolean
  position?: 'flow' | 'absolute'
  isMask?: boolean
  componentSourceId?: string | null
  workspaceOnly?: boolean
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
  appearance?: AppearanceJson
  size?: SizeJson
  layout?: LayoutJson
  variants?: VariantAxisJson[]
  defaultSelection?: Record<string, string>
  variantOverrides?: VariantOverrideJson[]
  variantPositions?: Record<string, { x: number; y: number }>
  componentProperties?: ComponentPropertyDefinitionJson[]
  variantTransition?: VariantTransitionJson
  timelines?: Record<string, ComponentTimelineJson>
  interactions?: InteractionJson[]
  componentId?: string
  selection?: Record<string, string>
  overrides?: Record<string, JsonObject>
  clipsContent?: boolean
  layoutGuides?: LayoutGuideJson[]
  // kind-specific
  text?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  lineHeight?: number
  letterSpacing?: number
  textAlign?: TextAlignJson
  color?: string
  src?: string
  fit?: MediaFitJson
  importWarning?: string
  duration?: number
  volume?: number
  startTime?: number
  trimStart?: number
  trimEnd?: number
  loop?: boolean
  muted?: boolean
  projection?: '2d' | 'perspective'
  enabled?: boolean
  background?: FillJson | null
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
  propertyId: PropertyIdJson
  defaultEasing?: EasingJson
  textAnimation?: TextAnimationJson | null
  keyframes?: KeyframeJson[]
}

export interface TextAnimationJson {
  id: string
  mode: 'in' | 'out'
  applyTo: 'letters' | 'words' | 'lines'
  order: 'forward' | 'reverse' | 'random'
  delay: number
  smoothing: 'none' | 'smooth'
  duration: number
  startTime: number
  acceleration: 'linear' | 'speed-up' | 'slow-down'
  easingPresetId: string
  easingStrength: number
  direction: 'up' | 'down' | 'left' | 'right'
  travelDistance: number
  blurRadius: number
}

export interface AppearanceJson {
  [key: string]: unknown
  opacity?: number
  fill?: FillJson | null
  stroke?: StrokeJson | null
  cornerRadius?: number
  cornerRadii?: {
    tl: number
    tr: number
    br: number
    bl: number
  }
  effects?: JsonValue[]
}

export const PROPERTY_IDS = [
  'transform.x',
  'transform.y',
  'transform.z',
  'transform.rotation',
  'transform.rotationX',
  'transform.rotationY',
  'transform.scaleX',
  'transform.scaleY',
  'transform.anchorX',
  'transform.anchorY',
  'transform.anchorZ',
  'camera.focusDistance',
  'camera.focusX',
  'camera.focusY',
  'camera.focusWorldX',
  'camera.focusWorldY',
  'camera.focusWorldZ',
  'camera.focusRadius',
  'camera.focusFalloff',
  'camera.pointOfInterestX',
  'camera.pointOfInterestY',
  'camera.pointOfInterestZ',
  'camera.focalLength',
  'camera.fieldOfView',
  'camera.nearClip',
  'camera.farClip',
  'camera.aperture',
  'camera.iso',
  'camera.blurLevel',
  'camera.blurQuality',
  'appearance.opacity',
  'appearance.cornerRadius',
  'appearance.cornerRadii',
  'appearance.cornerRadii.tl',
  'appearance.cornerRadii.tr',
  'appearance.cornerRadii.br',
  'appearance.cornerRadii.bl',
  'appearance.fill',
  'text.progress',
  'layout.gap',
  'layout.padding.top',
  'layout.padding.right',
  'layout.padding.bottom',
  'layout.padding.left',
  'layout.direction',
  'size.width',
  'size.height',
  'variant',
] as const

export type PropertyIdJson = (typeof PROPERTY_IDS)[number]

export type EasingJson =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | { bezier: [number, number, number, number] }
  | { spring: { stiffness: number; damping: number; mass: number } }

export interface VariantTransitionJson {
  duration: number
  easing: EasingJson
  presetId?: string
  strength?: number
}

export interface VariantAxisJson {
  name: string
  values: string[]
}

export type VariantSelectionJson = Record<string, string>

export interface VariantOverrideJson {
  match: VariantSelectionJson
  overrides: Record<string, JsonObject>
}

export type ComponentPropertyTypeJson =
  | 'text'
  | 'fill'
  | 'color'
  | 'number'
  | 'size'
  | 'stroke'
  | 'boolean'

export interface ComponentPropertyDefinitionJson {
  id: string
  name: string
  nodeId: string
  path: string
  type: ComponentPropertyTypeJson
}

export interface ComponentTimelineJson {
  id: string
  name: string
  duration: number
  tracks: TrackJson[]
  loop?: boolean
}

export type InteractionEventKindJson =
  | 'click'
  | 'pointerDown'
  | 'pointerUp'
  | 'hoverIn'
  | 'hoverOut'

export type InteractionTargetJson =
  | { kind: 'self' }
  | { kind: 'instance'; instanceId: string }
  | { kind: 'node'; nodeId: string }

export type InteractionActionJson =
  | {
      type: 'playTimeline'
      timelineId: string
      target?: InteractionTargetJson
      restart?: boolean
    }
  | {
      type: 'setVariant'
      selection: VariantSelectionJson
      target?: InteractionTargetJson
    }
  | {
      type: 'toggleVariant'
      axis: string
      values: [string, string]
      target?: InteractionTargetJson
    }
  | {
      type: 'after'
      delay: number
      action: InteractionActionJson
    }

export interface InteractionJson {
  id: string
  sourceNodeId?: string
  event: InteractionEventKindJson
  actions: InteractionActionJson[]
}

export interface KeyframeJson {
  id: string
  time: number
  value: KeyframeValueJson
  easingOut?: EasingJson
  presetOrigin?: 'in' | 'out'
}

export type KeyframeValueJson =
  | number
  | string
  | null
  | JsonObject
  | 'row'
  | 'column'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject

export interface JsonObject {
  [key: string]: JsonValue
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K]
}

export interface SectionJson {
  id: string
  name: string
  color: string
  start: number
  end: number
}

export interface LayoutGuideJson {
  id: string
  axis: 'x' | 'y'
  position: number
}

export interface ScenePatch {
  ops: PatchOperation[]
}

export const PATCH_OPERATION_TYPES = [
  'setMeta',
  'setRoot',
  'setActiveCameraId',
  'createNode',
  'deleteNode',
  'setNode',
  'setNodeProperty',
  'appendChild',
  'moveChild',
  'setTrack',
  'deleteTrack',
  'setSection',
  'deleteSection',
] as const satisfies readonly PatchOperation['op'][]

export type PatchOperation =
  | { op: 'setMeta'; patch: JsonObject }
  | { op: 'setRoot'; nodeId: string }
  | { op: 'setActiveCameraId'; cameraId: string | null }
  | { op: 'createNode'; node: NodeJson }
  | { op: 'deleteNode'; nodeId: string }
  | { op: 'setNode'; nodeId: string; patch: JsonObject }
  | { op: 'setNodeProperty'; nodeId: string; key: string; value: unknown }
  | { op: 'appendChild'; parentId: string; nodeId: string }
  | { op: 'moveChild'; parentId: string; nodeId: string; toIndex: number }
  | { op: 'setTrack'; track: TrackJson }
  | { op: 'deleteTrack'; trackId: string }
  | { op: 'setSection'; section: SectionJson }
  | { op: 'deleteSection'; sectionId: string }

type LayoutMode = 'none' | 'flex' | 'grid'
type FlexDirection = 'row' | 'column'
type FlexJustify = 'start' | 'center' | 'end' | 'space-between' | 'space-around'
type FlexAlign = 'start' | 'center' | 'end' | 'stretch'

type SceneTransform = NonNullable<NodeJson['transform']> & {
  anchorX: number
  anchorY: number
  anchorZ: number
  space: 'local' | 'world'
  renderMode: 'flat' | 'plane' | 'group3d'
}

type SceneSize = Record<string, unknown> & {
  width: number | 'hug' | 'fill'
  height: number | 'hug' | 'fill'
}
export interface SceneCanvas {
  width: number
  height: number
}
export type SceneMeta = Required<Omit<NonNullable<SceneJson['meta']>, 'canvas'>> & {
  canvas: SceneCanvas
}

export type SceneSummaryMeta = Record<string, unknown> &
  Partial<Omit<SceneMeta, 'canvas'>> & {
    canvas?: Partial<SceneCanvas> & Record<string, unknown>
  }

export interface SceneSummary {
  meta: SceneSummaryMeta
  root: string | null
  activeCameraId: string | null
  layerCount: number
  trackCount: number
  sectionCount: number
  keyframeCount: number
}

interface SceneAppearance {
  opacity: number
  fill: unknown | null
  stroke: unknown | null
  cornerRadius: number
  cornerRadii?: AppearanceJson['cornerRadii']
  effects: unknown[]
}

type ScenePadding = PaddingJson

type SceneLayout = Record<string, unknown> & {
  mode: LayoutMode
  direction: FlexDirection
  justify: FlexJustify
  align: FlexAlign
  gap: number
  padding: ScenePadding
  wrap: boolean
  columns: number
  rowGap: number
  columnGap: number
}

const DEFAULT_TRANSFORM: SceneTransform = {
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

const DEFAULT_APPEARANCE: SceneAppearance = {
  opacity: 1,
  fill: null,
  stroke: null,
  cornerRadius: 0,
  effects: [],
}

const DEFAULT_PADDING: ScenePadding = { top: 0, right: 0, bottom: 0, left: 0 }

const DEFAULT_LAYOUT: SceneLayout = {
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

const DEFAULT_SIZE: SceneSize = { width: 100, height: 100 }

const DEFAULT_META: SceneMeta = {
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
 * Declared IDs in the JSON are used as-is and become the Y.Map keys.
 * Input record keys are treated as aliases so generated JSON can be
 * forgiving about object shape. The desktop app's `applyJsonToScene`
 * does map IDs because it loads INTO an existing doc with auto-seeded
 * entries; here we're building a fresh doc so there's nothing to
 * collide with.
 */
export function buildSceneBytes(json: SceneJson): Uint8Array {
  const doc = new Y.Doc()
  const scene = doc.getMap<unknown>('scene')

  // --- meta ---
  const meta = new Y.Map<unknown>()
  scene.set('meta', meta)
  const metaIn = mergeWithDefaults(DEFAULT_META, json.meta)
  for (const [k, v] of Object.entries(metaIn)) meta.set(k, v)

  // --- nodes ---
  const nodes = new Y.Map<Y.Map<unknown>>()
  scene.set('nodes', nodes)

  for (const node of Object.values(json.nodes ?? {})) {
    const y = new Y.Map<unknown>()
    y.set('id', node.id)
    y.set('kind', node.kind)
    y.set('name', node.name ?? defaultName(node.kind))
    y.set('parent', node.parent ?? null)
    // Children: store as Y.Array so reorder ops work in the editor.
    const childArr = new Y.Array<string>()
    for (const c of node.children ?? []) childArr.push([c])
    y.set('children', childArr)
    y.set(
      'transform',
      mergeWithDefaults(DEFAULT_TRANSFORM, node.transform),
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
    y.set('workspaceOnly', node.workspaceOnly ?? false)

    // kind-specific fields
    if (node.kind === 'frame' || node.kind === 'component') {
      y.set('size', mergeWithDefaults(DEFAULT_SIZE, node.size))
      y.set(
        'layout',
        mergeLayoutWithDefaults(
          DEFAULT_LAYOUT,
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
        y.set('variantPositions', node.variantPositions ?? {})
        y.set('componentProperties', node.componentProperties ?? [])
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
      y.set('size', mergeWithDefaults(DEFAULT_SIZE, node.size))
    }
    if (node.kind === 'image') {
      y.set('src', node.src ?? '')
      y.set('fit', node.fit ?? 'cover')
      if (node.importWarning !== undefined) y.set('importWarning', node.importWarning)
    }
    if (node.kind === 'instance') {
      y.set('size', mergeWithDefaults(DEFAULT_SIZE, node.size))
      y.set(
        'layout',
        mergeLayoutWithDefaults(
          DEFAULT_LAYOUT,
          node.layout,
        ),
      )
      y.set('componentId', node.componentId ?? '')
      y.set('selection', node.selection ?? {})
      y.set('overrides', node.overrides ?? {})
      y.set('interactions', node.interactions ?? [])
    }
    if (node.kind === 'video' || node.kind === 'audio') {
      const defaultMediaSize: SceneSize = node.kind === 'audio'
        ? { width: 120, height: 40 }
        : { width: 100, height: 100 }
      y.set(
        'size',
        mergeWithDefaults(defaultMediaSize, node.size),
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
      const defaultTextSize: SceneSize = { width: 'hug', height: 'hug' }
      y.set(
        'size',
        mergeWithDefaults(defaultTextSize, node.size),
      )
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

    nodes.set(node.id, y)
  }

  // --- tracks ---
  const tracks = new Y.Map<Y.Map<unknown>>()
  scene.set('tracks', tracks)
  for (const track of Object.values(json.tracks ?? {})) {
    const y = new Y.Map<unknown>()
    y.set('id', track.id)
    y.set('nodeId', track.nodeId)
    y.set('propertyId', track.propertyId)
    y.set('defaultEasing', track.defaultEasing ?? 'ease-in-out')
    if (track.textAnimation !== undefined) y.set('textAnimation', track.textAnimation)
    y.set('keyframes', track.keyframes ?? [])
    tracks.set(track.id, y)
  }

  // --- sections ---
  const sections = new Y.Map<unknown>()
  scene.set('sections', sections)
  for (const section of Object.values(json.sections ?? {})) {
    sections.set(section.id, section)
  }

  // --- scalars ---
  // root + activeCameraId. The desktop app auto-promotes the first
  // parentless non-camera node to root on load, so we don't strictly
  // need to set this — but doing so matches what `Save` produces and
  // makes round-trips byte-stable.
  if (json.root) scene.set('root', json.root)
  else {
    // Infer: first parentless non-camera node.
    for (const node of Object.values(json.nodes ?? {})) {
      if (!node.parent && node.kind !== 'camera') {
        scene.set('root', node.id)
        break
      }
    }
  }
  if (json.activeCameraId !== undefined) {
    scene.set('activeCameraId', json.activeCameraId)
  } else {
    // Infer: first camera node.
    for (const node of Object.values(json.nodes ?? {})) {
      if (node.kind === 'camera') {
        scene.set('activeCameraId', node.id)
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

export function inspectScene(bytes: Uint8Array): Record<string, unknown> {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, bytes)
  const scene = doc.getMap<unknown>('scene')
  return yToPlain(scene) as Record<string, unknown>
}

export interface SceneValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

export function validateScene(bytes: Uint8Array): SceneValidationResult {
  const data = inspectScene(bytes)
  const errors: string[] = []
  const warnings: string[] = []
  const nodes = asRecord(data.nodes)
  const tracks = asRecord(data.tracks)
  const root = typeof data.root === 'string' ? data.root : ''
  const activeCameraId = typeof data.activeCameraId === 'string' ? data.activeCameraId : ''

  if (!root) errors.push('scene.root is missing')
  else if (!nodes[root]) errors.push(`scene.root points to missing node: ${root}`)
  else if (asRecord(nodes[root]).kind !== 'frame') {
    errors.push(`scene.root is not a frame node: ${root}`)
  } else if (typeof asRecord(nodes[root]).parent === 'string') {
    errors.push(`scene.root must be scene-level with parent: null: ${root}`)
  }

  if (!activeCameraId) warnings.push('scene.activeCameraId is missing')
  else if (!nodes[activeCameraId]) errors.push(`scene.activeCameraId points to missing node: ${activeCameraId}`)
  else if (asRecord(nodes[activeCameraId]).kind !== 'camera') {
    errors.push(`scene.activeCameraId is not a camera node: ${activeCameraId}`)
  }

  for (const [id, raw] of Object.entries(nodes)) {
    const node = asRecord(raw)
    if (node.id !== id) errors.push(`node map key ${id} does not match node id: ${String(node.id)}`)
    if (typeof node.kind !== 'string' || !isNodeKind(node.kind)) {
      errors.push(`node ${id} has unsupported kind: ${String(node.kind)}`)
    }
    const parent = typeof node.parent === 'string' ? node.parent : null
    if (node.kind === 'camera' && parent) {
      errors.push(`camera node ${id} must be scene-level with parent: null`)
    }
    if (parent && !nodes[parent]) errors.push(`node ${id} has missing parent: ${parent}`)
    else if (parent) {
      const parentChildren = asRecord(nodes[parent]).children
      if (!Array.isArray(parentChildren) || !parentChildren.includes(id)) {
        errors.push(`node ${id} parent ${parent} does not list it as a child`)
      }
    }
    if (node.children !== undefined && !Array.isArray(node.children)) {
      errors.push(`node ${id} children must be an array`)
    }
    const children = Array.isArray(node.children) ? node.children : []
    const seenChildren = new Set<string>()
    for (const child of children) {
      if (typeof child !== 'string' || !nodes[child]) errors.push(`node ${id} has missing child: ${String(child)}`)
      else if (seenChildren.has(child)) errors.push(`node ${id} lists duplicate child: ${child}`)
      else if (asRecord(nodes[child]).parent !== id) {
        errors.push(`node ${id} lists child ${child}, but child's parent is ${String(asRecord(nodes[child]).parent)}`)
      }
      if (typeof child === 'string') seenChildren.add(child)
    }
  }

  const cameraIds = Object.entries(nodes)
    .filter(([, raw]) => asRecord(raw).kind === 'camera')
    .map(([id]) => id)
  if (cameraIds.length > 1) {
    errors.push(`scene has multiple camera nodes: ${cameraIds.join(', ')}`)
  }

  for (const [id, raw] of Object.entries(tracks)) {
    const track = asRecord(raw)
    if (track.id !== id) errors.push(`track map key ${id} does not match track id: ${String(track.id)}`)
    const nodeId = track.nodeId
    if (typeof nodeId !== 'string' || !nodes[nodeId]) {
      errors.push(`track ${id} points to missing node: ${String(nodeId)}`)
    }
    if (!Array.isArray(track.keyframes)) {
      errors.push(`track ${id} keyframes must be an array`)
    }
    if (typeof track.propertyId !== 'string' || !isPropertyId(track.propertyId)) {
      errors.push(`track ${id} has unsupported propertyId: ${String(track.propertyId)}`)
    }
  }

  const sections = asRecord(data.sections)
  for (const [id, raw] of Object.entries(sections)) {
    const section = asRecord(raw)
    if (section.id !== id) errors.push(`section map key ${id} does not match section id: ${String(section.id)}`)
  }

  return { ok: errors.length === 0, errors, warnings }
}

function isNodeKind(value: string): value is NodeKindJson {
  return (NODE_KINDS as readonly string[]).includes(value)
}

function isPropertyId(value: string): value is PropertyIdJson {
  return (PROPERTY_IDS as readonly string[]).includes(value)
}

export function applyScenePatch(bytes: Uint8Array, patch: ScenePatch | PatchOperation[]): Uint8Array {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, bytes)
  const scene = doc.getMap<unknown>('scene')
  const ops = Array.isArray(patch) ? patch : patch.ops
  if (!Array.isArray(ops)) {
    throw new Error('patch must be an array of operations or { ops: [...] }')
  }

  doc.transact(() => {
    for (const op of ops) applyPatchOperation(scene, op)
  })

  return Y.encodeStateAsUpdate(doc)
}

function applyPatchOperation(scene: Y.Map<unknown>, op: PatchOperation): void {
  switch (op.op) {
    case 'setMeta': {
      const meta = ensureMap(scene, 'meta')
      for (const [k, v] of Object.entries(op.patch)) meta.set(k, v)
      return
    }
    case 'setRoot':
      scene.set('root', op.nodeId)
      return
    case 'setActiveCameraId':
      scene.set('activeCameraId', op.cameraId)
      return
    case 'createNode': {
      const nodes = ensureMap(scene, 'nodes') as Y.Map<Y.Map<unknown>>
      if (nodes.has(op.node.id)) {
        throw new Error(`node already exists: ${op.node.id}`)
      }
      const y = nodeToYMap(op.node)
      nodes.set(op.node.id, y)
      if (op.node.parent) {
        const parent = nodes.get(op.node.parent)
        if (!parent) throw new Error(`parent does not exist: ${op.node.parent}`)
        const arr = ensureNodeChildren(parent)
        if (!arr.toArray().includes(op.node.id)) arr.push([op.node.id])
      }
      return
    }
    case 'deleteNode':
      deleteNode(scene, op.nodeId)
      return
    case 'setNode': {
      const node = getNodeMap(scene, op.nodeId)
      for (const [k, v] of Object.entries(op.patch)) {
        if (k === 'children' && Array.isArray(v)) node.set(k, arrayToY(v))
        else node.set(k, v)
      }
      return
    }
    case 'setNodeProperty': {
      const node = getNodeMap(scene, op.nodeId)
      if (op.key === 'children' && Array.isArray(op.value)) node.set(op.key, arrayToY(op.value))
      else node.set(op.key, op.value)
      return
    }
    case 'appendChild': {
      const nodes = getNodesMap(scene)
      const parent = getNodeMap(scene, op.parentId)
      const child = getNodeMap(scene, op.nodeId)
      detachFromParent(nodes, op.nodeId, child.get('parent') as string | null)
      child.set('parent', op.parentId)
      const arr = ensureNodeChildren(parent)
      if (!arr.toArray().includes(op.nodeId)) arr.push([op.nodeId])
      return
    }
    case 'moveChild': {
      const parent = getNodeMap(scene, op.parentId)
      const arr = ensureNodeChildren(parent)
      const list = arr.toArray()
      const from = list.indexOf(op.nodeId)
      if (from < 0) throw new Error(`node ${op.nodeId} is not a child of ${op.parentId}`)
      arr.delete(from, 1)
      arr.insert(Math.max(0, Math.min(op.toIndex, arr.length)), [op.nodeId])
      return
    }
    case 'setTrack': {
      const tracks = ensureMap(scene, 'tracks') as Y.Map<Y.Map<unknown>>
      const y = new Y.Map<unknown>()
      y.set('id', op.track.id)
      y.set('nodeId', op.track.nodeId)
      y.set('propertyId', op.track.propertyId)
      y.set('defaultEasing', op.track.defaultEasing ?? 'ease-in-out')
      if (op.track.textAnimation !== undefined) y.set('textAnimation', op.track.textAnimation)
      y.set('keyframes', op.track.keyframes ?? [])
      tracks.set(op.track.id, y)
      return
    }
    case 'deleteTrack':
      ensureMap(scene, 'tracks').delete(op.trackId)
      return
    case 'setSection':
      ensureMap(scene, 'sections').set(op.section.id, op.section)
      return
    case 'deleteSection':
      ensureMap(scene, 'sections').delete(op.sectionId)
      return
  }
}

function nodeToYMap(node: NodeJson): Y.Map<unknown> {
  const y = new Y.Map<unknown>()
  const handledKeys = new Set([
    'id',
    'kind',
    'name',
    'parent',
    'children',
    'transform',
    'appearance',
    'visible',
    'locked',
    'position',
    'isMask',
    'componentSourceId',
    'workspaceOnly',
  ])
  y.set('id', node.id)
  y.set('kind', node.kind)
  y.set('name', node.name ?? defaultName(node.kind))
  y.set('parent', node.parent ?? null)
  y.set('children', arrayToY(node.children ?? []))
  y.set('transform', mergeWithDefaults(DEFAULT_TRANSFORM, node.transform as Partial<typeof DEFAULT_TRANSFORM>))
  y.set('appearance', mergeWithDefaults(defaultAppearance(node.kind), node.appearance))
  y.set('visible', node.visible ?? true)
  y.set('locked', node.locked ?? false)
  y.set('position', node.position ?? 'flow')
  y.set('isMask', node.isMask ?? false)
  y.set('componentSourceId', node.componentSourceId ?? null)
  y.set('workspaceOnly', node.workspaceOnly ?? false)
  if (node.kind === 'text') {
    for (const key of [
      'size',
      'text',
      'fontFamily',
      'fontSize',
      'fontWeight',
      'lineHeight',
      'letterSpacing',
      'textAlign',
      'color',
    ]) {
      handledKeys.add(key)
    }
    const defaultTextSize: SceneSize = { width: 'hug', height: 'hug' }
    y.set('size', mergeWithDefaults(defaultTextSize, node.size))
    y.set('text', node.text ?? 'Text')
    y.set('fontFamily', node.fontFamily ?? 'Inter')
    y.set('fontSize', node.fontSize ?? 16)
    y.set('fontWeight', node.fontWeight ?? 400)
    y.set('lineHeight', node.lineHeight ?? 1.4)
    y.set('letterSpacing', node.letterSpacing ?? 0)
    y.set('textAlign', node.textAlign ?? 'start')
    y.set('color', node.color ?? '#0a0a0c')
  }
  if (node.kind === 'rect' || node.kind === 'ellipse' || node.kind === 'image') {
    handledKeys.add('size')
    y.set('size', mergeWithDefaults(DEFAULT_SIZE, node.size))
  }
  if (node.kind === 'frame' || node.kind === 'component') {
    for (const key of [
      'size',
      'layout',
      'clipsContent',
      'layoutGuides',
      'variants',
      'defaultSelection',
      'variantOverrides',
      'variantPositions',
      'componentProperties',
      'variantTransition',
      'timelines',
      'interactions',
    ]) {
      handledKeys.add(key)
    }
    y.set('size', mergeWithDefaults(DEFAULT_SIZE, node.size))
    y.set('layout', mergeLayoutWithDefaults(DEFAULT_LAYOUT, node.layout))
    if (node.kind === 'frame') {
      y.set('clipsContent', node.clipsContent ?? true)
      y.set('layoutGuides', node.layoutGuides ?? [])
    } else {
      y.set('variants', node.variants ?? [])
      y.set('defaultSelection', node.defaultSelection ?? {})
      y.set('variantOverrides', node.variantOverrides ?? [])
      y.set('variantPositions', node.variantPositions ?? {})
      y.set('componentProperties', node.componentProperties ?? [])
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
  if (node.kind === 'instance') {
    for (const key of [
      'size',
      'layout',
      'componentId',
      'selection',
      'overrides',
      'interactions',
    ]) {
      handledKeys.add(key)
    }
    y.set('size', mergeWithDefaults(DEFAULT_SIZE, node.size))
    y.set('layout', mergeLayoutWithDefaults(DEFAULT_LAYOUT, node.layout))
    y.set('componentId', node.componentId ?? '')
    y.set('selection', node.selection ?? {})
    y.set('overrides', node.overrides ?? {})
    y.set('interactions', node.interactions ?? [])
  }
  for (const [k, v] of Object.entries(node)) {
    if (handledKeys.has(k)) continue
    y.set(k, v)
  }
  return y
}

function deleteNode(scene: Y.Map<unknown>, nodeId: string): void {
  const nodes = getNodesMap(scene)
  const node = nodes.get(nodeId)
  if (!node) return
  const parent = node.get('parent') as string | null
  detachFromParent(nodes, nodeId, parent)
  const children = node.get('children')
  const childIds = children instanceof Y.Array ? children.toArray() as string[] : []
  for (const childId of childIds) deleteNode(scene, childId)
  nodes.delete(nodeId)
  if (scene.get('root') === nodeId) scene.set('root', '')
  if (scene.get('activeCameraId') === nodeId) scene.set('activeCameraId', '')
}

function detachFromParent(nodes: Y.Map<Y.Map<unknown>>, nodeId: string, parentId: string | null): void {
  if (!parentId) return
  const parent = nodes.get(parentId)
  if (!parent) return
  const arr = parent.get('children')
  if (!(arr instanceof Y.Array)) return
  const idx = arr.toArray().indexOf(nodeId)
  if (idx >= 0) arr.delete(idx, 1)
}

function getNodesMap(scene: Y.Map<unknown>): Y.Map<Y.Map<unknown>> {
  return ensureMap(scene, 'nodes') as Y.Map<Y.Map<unknown>>
}

function getNodeMap(scene: Y.Map<unknown>, nodeId: string): Y.Map<unknown> {
  const node = getNodesMap(scene).get(nodeId)
  if (!node) throw new Error(`node does not exist: ${nodeId}`)
  return node
}

function ensureMap(parent: Y.Map<unknown>, key: string): Y.Map<unknown> {
  const existing = parent.get(key)
  if (existing instanceof Y.Map) return existing
  const next = new Y.Map<unknown>()
  parent.set(key, next)
  return next
}

function ensureNodeChildren(node: Y.Map<unknown>): Y.Array<string> {
  const existing = node.get('children')
  if (existing instanceof Y.Array) return existing as Y.Array<string>
  const next = new Y.Array<string>()
  node.set('children', next)
  return next
}

function arrayToY(items: unknown[]): Y.Array<unknown> {
  const arr = new Y.Array<unknown>()
  if (items.length > 0) arr.push(items)
  return arr
}

function yToPlain(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of value.entries()) out[k] = yToPlain(v)
    return out
  }
  if (value instanceof Y.Array) return value.toArray().map(yToPlain)
  return value
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Decode `.hype` bytes and return a plain JSON summary. Used by the
 * `info` command and the `info_scene` MCP tool. We pull just the
 * fields agents (and humans at a terminal) care about — full
 * round-trip conversion for node children and keyframe payloads is not
 * needed for a count-only summary.
 */
export function readSceneSummary(bytes: Uint8Array): SceneSummary {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, bytes)
  const scene = doc.getMap<unknown>('scene')

  const metaMap = scene.get('meta') as Y.Map<unknown> | undefined
  const meta: SceneSummaryMeta = {}
  if (metaMap) {
    for (const [k, v] of metaMap.entries()) meta[k] = v
  }

  const nodes = scene.get('nodes') as Y.Map<Y.Map<unknown>> | undefined
  const tracks = scene.get('tracks') as Y.Map<Y.Map<unknown>> | undefined
  const sections = scene.get('sections') as Y.Map<unknown> | undefined

  // Count keyframes across every track. Newly-authored CLI scenes store
  // keyframes as plain arrays, while older or hand-built docs may contain
  // Y.Array values, so accept both shapes.
  let keyframeCount = 0
  if (tracks) {
    for (const t of tracks.values()) {
      keyframeCount += keyframeLength(t.get('keyframes'))
    }
  }

  return {
    meta,
    root: nonEmptySceneId(scene.get('root')),
    activeCameraId: nonEmptySceneId(scene.get('activeCameraId')),
    layerCount: nodes?.size ?? 0,
    trackCount: tracks?.size ?? 0,
    sectionCount: sections?.size ?? 0,
    keyframeCount,
  }
}

function nonEmptySceneId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
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
  patch: DeepPartial<T> | undefined,
): T {
  const out: Record<string, unknown> = clonePlainObject(defaults)
  if (!patch) return out as T
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

function mergeLayoutWithDefaults(
  defaults: SceneLayout,
  patch: LayoutJson | undefined,
): SceneLayout {
  return mergeWithDefaults(defaults, patch as DeepPartial<SceneLayout> | undefined)
}

function clonePlainObject<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (Array.isArray(v)) {
      out[k] = [...v]
    } else if (v != null && typeof v === 'object') {
      out[k] = clonePlainObject(v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out as T
}

function keyframeLength(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (value instanceof Y.Array) return value.length
  return 0
}

function defaultName(kind: NodeKindJson): string {
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

function defaultAppearance(kind: NodeKindJson): Record<string, unknown> {
  if (kind === 'text') {
    return { ...DEFAULT_APPEARANCE, fill: null }
  }
  return { ...DEFAULT_APPEARANCE }
}

// SPDX-License-Identifier: Apache-2.0

/**
 * Build a `.hype` file from a plain JSON scene description.
 *
 * The CLI is standalone — it doesn't import the desktop app's
 * SceneAPI. To produce a `.hype` we mirror the SceneAPI's Y.Doc
 * layout directly: a top-level `scene` Y.Map carrying `nodes`,
 * `tracks`, `meta`, `sections`, and `uiState`, plus scene-level
 * camera ownership/cut metadata and the scalar `root` and
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
  meta?: SceneMetaJson
  root?: string
  activeCameraId?: string | null
  /** Project compositions. Nodes and tracks remain project-global. */
  compositionScenes?: Record<string, CompositionSceneJson>
  /** Ordered occurrences reference compositions by sceneId. */
  sequenceItems?: Record<string, SequenceItemJson>
  /** Sequence item ids in master-timeline order. */
  sequenceOrder?: string[]
  activeCompositionId?: string
  /** Current project/sequence persistence schema. */
  sequenceSchemaVersion?: number
  /**
   * Cameras owned by this scene. Omit for legacy behavior, which
   * infers ownership from every scene-level camera node.
   */
  cameraIds?: string[]
  /**
   * Camera used before the first timed cut. Omit to fall back to the
   * active camera, then the first owned camera.
   */
  defaultCameraId?: string | null
  /** Timed hard cuts, keyed by each cut's declared id. */
  cameraCuts?: Record<string, CameraCutJson>
  nodes?: Record<string, NodeJson>
  tracks?: Record<string, TrackJson>
  sections?: Record<string, SectionJson>
}

export interface SceneMetaJson {
  id?: string
  name?: string
  duration?: number
  frameRate?: number
  canvas?: Partial<SceneCanvas>
}

export type TextAlignJson = 'start' | 'center' | 'end'
export type NodePositionJson = 'flow' | 'absolute'

export const MIN_LAYER_Z_INDEX = -9_999
export const MAX_LAYER_Z_INDEX = 9_999

export function normalizeLayerZIndex(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(
    MIN_LAYER_Z_INDEX,
    Math.min(MAX_LAYER_Z_INDEX, Math.round(value)),
  )
}

export const PAPER_SHADER_TYPES = [
  'mesh-gradient',
  'smoke-ring',
  'neuro-noise',
  'dot-orbit',
  'dot-grid',
  'simplex-noise',
  'metaballs',
  'waves',
  'perlin-noise',
  'voronoi',
  'warp',
  'god-rays',
  'spiral',
  'swirl',
  'dithering',
  'grain-gradient',
  'pulsing-border',
  'color-panels',
  'static-mesh-gradient',
  'static-radial-gradient',
  'paper-texture',
  'fluted-glass',
  'water',
  'image-dithering',
  'halftone-dots',
  'halftone-cmyk',
  'heatmap',
  'liquid-metal',
  'gem-smoke',
] as const

export type PaperShaderTypeJson = (typeof PAPER_SHADER_TYPES)[number]

export type NodeKindJson =
  | 'frame'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'image'
  | 'shader'
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
  'shader',
  'video',
  'audio',
  'component',
  'instance',
  'camera',
] as const satisfies readonly NodeKindJson[]

export const NODE_POSITIONS = [
  'flow',
  'absolute',
] as const satisfies readonly NodePositionJson[]

const NODE_KIND_SET: ReadonlySet<NodeKindJson> = new Set(NODE_KINDS)
const NODE_POSITION_SET: ReadonlySet<NodePositionJson> = new Set(NODE_POSITIONS)

export interface SizeJson extends Record<string, unknown> {
  width?: number | 'hug' | 'fill'
  height?: number | 'hug' | 'fill'
}

export interface GradientStopJson {
  at: number
  color: string
}

export type ImageFillFitJson = 'cover' | 'contain' | 'fill' | 'tile'

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
      fit: ImageFillFitJson
    }

export type BlendModeJson =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'

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
  position?: NodePositionJson
  /** Sibling paint order. Larger values render in front; default 0. */
  zIndex?: number
  isMask?: boolean
  componentSourceId?: string | null
  workspaceOnly?: boolean
  /** Optional pixel-space Bézier rail followed by this layer. */
  motionPath?: LayerMotionPathJson | null
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
  /** Editable pie/donut geometry for ellipse nodes. */
  arc?: {
    startAngle?: number
    sweep?: number
    innerRadius?: number
  }
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
  shaderType?: PaperShaderTypeJson
  colors?: string[]
  params?: JsonObject
  sourceNodeId?: string
  sourceImage?: string
  speed?: number
  scale?: number
  distortion?: number
  swirl?: number
  grain?: number
  duration?: number
  volume?: number
  playbackRate?: number
  startTime?: number
  trimStart?: number
  trimEnd?: number
  loop?: boolean
  muted?: boolean
  beatAnalysis?: {
    algorithmVersion?: 2 | 3
    status?: 'ok' | 'ambiguous' | 'no-pulse'
    bpm: number
    confidence: number
    firstBeatTime: number
    transients: Array<{ time: number; strength: number }>
    beatTransients: Array<{ time: number; strength: number }>
    candidates: Array<{
      bpm: number
      confidence: number
      relationship?: 'direct' | '3:2' | '2:3'
      firstBeatTime?: number
    }>
  }
  beatGrid?: {
    version: 1
    bpm: number
    firstBeatTime: number
    beatsPerBar: number
    beatUnit: 1 | 2 | 4 | 8 | 16 | 32
    swingPercent?: number
    subdivisions: Array<{
      id?: string
      startBar: number
      endBar: number
      division: 1 | 2 | 4 | 8 | 16 | 32
    }>
  }
  projection?: '2d' | 'perspective'
  enabled?: boolean
  background?: FillJson | null
  focalLength?: number
  scrollSensitivity?: number
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
  fStop?: number
  bladeCount?: number
  bladeRotation?: number
  bokehRatio?: number
  dofPreviewQuality?: 'draft' | 'balanced' | 'high'
  iso?: number
  blurLevel?: number
  blurQuality?: number
  chromaticAberrationEnabled?: boolean
  chromaticAberrationAmount?: number
  chromaticAberrationAngle?: number
  bloomEnabled?: boolean
  bloomStrength?: number
  bloomRadius?: number
  bloomThreshold?: number
  vhsEnabled?: boolean
  vhsIntensity?: number
  vhsNoise?: number
  vhsScanlines?: number
  vhsColorBleed?: number
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
  applyTo: 'layer' | 'letters' | 'words' | 'lines'
  order: 'forward' | 'reverse' | 'random'
  delay: number
  smoothing: 'none' | 'soft' | 'smooth'
  /** Optional monotonic profile sampled by each segment as the trail travels. */
  staggerCurve?: TextStaggerCurveJson | null
  duration: number
  startTime: number
  acceleration: 'linear' | 'speed-up' | 'slow-down' | 'smooth' | 'spring'
  easingPresetId: string
  easingStrength: number
  direction: 'up' | 'down' | 'left' | 'right'
  travelDistance: number
  /**
   * Per-segment offset in line-height multiples: +X right, +Y down, +Z toward
   * the viewer. Null/omitted uses direction + travelDistance.
   */
  motionVector?: { x: number; y: number; z: number } | null
  /**
   * Editable cubic spatial path in line-height units. t=0 is the settled
   * origin and t=1 is the segment's authored start/hidden position.
   */
  motionPath?: TextMotionPathJson | null
  blurRadius: number
}

export interface TextStaggerCurveJson {
  version: 1
  points: Array<{
    id: string
    x: number
    y: number
    inX: number
    inY: number
    outX: number
    outY: number
  }>
}

export interface TextMotionPathJson {
  version: 1
  points: Array<{
    id: string
    t: number
    x: number
    y: number
    z: number
    inX: number
    inY: number
    inZ: number
    outX: number
    outY: number
    outZ: number
  }>
}

export interface LayerMotionPathJson extends TextMotionPathJson {
  /** Static 0..1 amount used when no motionPath.progress track is active. */
  progress?: number
  /** Rotate the layer so its local X axis follows the rail tangent. */
  autoOrient?: boolean
  /** Degrees added after automatic tangent orientation. */
  rotationOffset?: number
  /** Arc-length mode produces approximately constant travel speed. */
  parameterization?: 'parametric' | 'arc-length'
}

const MAX_LAYER_MOTION_PATH_POINTS = 64
const MAX_LAYER_MOTION_PATH_COORDINATE = 1_000_000

export interface AppearanceJson {
  [key: string]: unknown
  opacity?: number
  fill?: FillJson | null
  stroke?: StrokeJson | null
  cornerRadius?: number
  blendMode?: BlendModeJson
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
  'camera.fStop',
  'camera.bladeCount',
  'camera.bladeRotation',
  'camera.bokehRatio',
  'camera.iso',
  'camera.blurLevel',
  'camera.blurQuality',
  'camera.chromaticAberrationAmount',
  'camera.chromaticAberrationAngle',
  'camera.bloomStrength',
  'camera.bloomRadius',
  'camera.bloomThreshold',
  'camera.vhsIntensity',
  'camera.vhsNoise',
  'camera.vhsScanlines',
  'camera.vhsColorBleed',
  'appearance.opacity',
  'appearance.cornerRadius',
  'appearance.cornerRadii',
  'appearance.cornerRadii.tl',
  'appearance.cornerRadii.tr',
  'appearance.cornerRadii.br',
  'appearance.cornerRadii.bl',
  'appearance.fill',
  'appearance.blendMode',
  'shape.arcStart',
  'shape.arcSweep',
  'shape.arcInnerRadius',
  'text.progress',
  'motionPath.progress',
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

export type EffectBlurPropertyIdJson =
  `appearance.effects.${string}.blur`
export type PropertyIdJson =
  | (typeof PROPERTY_IDS)[number]
  | EffectBlurPropertyIdJson

const PROPERTY_ID_SET: ReadonlySet<string> = new Set(PROPERTY_IDS)
const EFFECT_BLUR_PROPERTY_ID =
  /^appearance\.effects\.[A-Za-z0-9_-]+\.blur$/

export type EasingJson =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | { bezier: [number, number, number, number] }
  | { spring: { stiffness: number; damping: number; mass: number } }

export const KEYFRAME_EASING_PRESET_IDS = [
  'none',
  'smooth',
  'natural',
  'slow-down',
  'accelerate',
  'elastic',
  'bounce',
  'overshoot',
  'impulse',
  'swing',
  'custom',
] as const

export type KeyframeEasingPresetIdJson =
  (typeof KEYFRAME_EASING_PRESET_IDS)[number]

const KEYFRAME_EASING_PRESET_ID_SET: ReadonlySet<KeyframeEasingPresetIdJson> =
  new Set(KEYFRAME_EASING_PRESET_IDS)

export interface KeyframeEasingPresetJson {
  presetId: KeyframeEasingPresetIdJson
  strength: number
}

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
  easingPreset?: KeyframeEasingPresetJson
  presetOrigin?: 'in' | 'out'
}

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

export type KeyframeValueJson = JsonValue

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
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

export interface CameraCutJson {
  id: string
  cameraId: string
  /** Scene-local time in seconds at which this camera becomes active. */
  time: number
}

export interface CompositionSceneJson {
  id: string
  name: string
  rootNodeId: string
  duration: number
  /**
   * Optional composition-local source window. Master occurrences are
   * intersected with it; omission means the complete composition.
   */
  workArea?: {
    start: number
    end: number
  }
  /** Parentless pasteboard assets whose lifecycle follows this composition. */
  workspaceNodeIds?: string[]
  cameraIds: string[]
  defaultCameraId: string | null
  /** Camera cuts are composition-local even though camera nodes are global. */
  cameraCuts: Record<string, CameraCutJson>
}

export type SequenceTransitionKindJson = 'cut' | 'crossfade'

export interface SequenceTransitionJson {
  kind: SequenceTransitionKindJson
  duration: number
}

export interface SequenceItemJson {
  id: string
  sceneId: string
  /**
   * Mute the project-level Master soundtrack for this occurrence.
   * Omitted is equivalent to false.
   */
  masterAudioMuted?: boolean
  trimStart?: number
  duration?: number
  /** Optional trailing freeze-frame span on the Master timeline. */
  holdDuration?: number
  transitionOut?: SequenceTransitionJson
}

export const SEQUENCE_SCHEMA_VERSION = 2

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

export type PatchOperationType = (typeof PATCH_OPERATION_TYPES)[number]

export type PatchOperation =
  | { op: 'setMeta'; patch: JsonObject }
  | { op: 'setRoot'; nodeId: string }
  | { op: 'setActiveCameraId'; cameraId: string | null }
  | { op: 'createNode'; node: NodeJson }
  | { op: 'deleteNode'; nodeId: string }
  | { op: 'setNode'; nodeId: string; patch: JsonObject }
  | { op: 'setNodeProperty'; nodeId: string; key: string; value: JsonValue }
  | { op: 'appendChild'; parentId: string; nodeId: string }
  | { op: 'moveChild'; parentId: string; nodeId: string; toIndex: number }
  | { op: 'setTrack'; track: TrackJson }
  | { op: 'deleteTrack'; trackId: string }
  | { op: 'setSection'; section: SectionJson }
  | { op: 'deleteSection'; sectionId: string }

type LayoutMode = NonNullable<LayoutJson['mode']>
type FlexDirection = NonNullable<LayoutJson['direction']>
type FlexJustify = NonNullable<LayoutJson['justify']>
type FlexAlign = NonNullable<LayoutJson['align']>

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
  activeCompositionId: string | null
  sequenceSchemaVersion: number | null
  layerCount: number
  trackCount: number
  sectionCount: number
  keyframeCount: number
  compositionSceneCount: number
  sequenceItemCount: number
}

interface SceneAppearance {
  opacity: number
  fill: unknown | null
  stroke: unknown | null
  cornerRadius: number
  blendMode: BlendModeJson
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
  blendMode: 'normal',
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
const DEFAULT_ELLIPSE_ARC = {
  startAngle: -90,
  sweep: 1,
  innerRadius: 0,
} as const

function normalizeEllipseArcJson(value: NodeJson['arc']) {
  const finite = (candidate: unknown, fallback: number) =>
    typeof candidate === 'number' && Number.isFinite(candidate)
      ? candidate
      : fallback
  const rawAngle = finite(value?.startAngle, DEFAULT_ELLIPSE_ARC.startAngle)
  const wrappedAngle = ((rawAngle + 180) % 360 + 360) % 360 - 180
  const startAngle = wrappedAngle === -180 && rawAngle > 0 ? 180 : wrappedAngle
  return {
    startAngle: Object.is(startAngle, -0) ? 0 : startAngle,
    sweep: Math.max(
      0,
      Math.min(1, finite(value?.sweep, DEFAULT_ELLIPSE_ARC.sweep)),
    ),
    innerRadius: Math.max(
      0,
      Math.min(
        1,
        finite(value?.innerRadius, DEFAULT_ELLIPSE_ARC.innerRadius),
      ),
    ),
  }
}
const DEFAULT_SHADER_SIZE: SceneSize = { width: 640, height: 360 }
const PAPER_SHADER_HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const PAPER_SHADER_TYPE_SET: ReadonlySet<string> = new Set(PAPER_SHADER_TYPES)

interface PaperShaderDefinitionJson {
  label: string
  requiresImage: boolean
  acceptsImage: boolean
  maxColors: number
  colors: readonly string[]
  speed: number
  scale: number
}

const PAPER_SHADER_DEFINITIONS: Record<
  PaperShaderTypeJson,
  PaperShaderDefinitionJson
> = {
  'mesh-gradient': {
    label: 'Mesh Gradient',
    requiresImage: false,
    acceptsImage: false,
    maxColors: 10,
    colors: ['#e0eaff', '#241d9a', '#f75092', '#9f50d3'],
    speed: 0.6,
    scale: 1,
  },
  'smoke-ring': {
    label: 'Smoke Ring',
    requiresImage: false,
    acceptsImage: false,
    maxColors: 10,
    colors: ['#ffffff'],
    speed: 0.5,
    scale: 0.8,
  },
  'neuro-noise': shaderDefaults('Neuro Noise', 1),
  'dot-orbit': {
    label: 'Dot Orbit',
    requiresImage: false,
    acceptsImage: false,
    maxColors: 10,
    colors: ['#ffc96b', '#ff6200', '#ff2f00', '#421100', '#1a0000'],
    speed: 1.5,
    scale: 1,
  },
  'dot-grid': shaderDefaults('Dot Grid', 0),
  'simplex-noise': {
    label: 'Simplex Noise',
    requiresImage: false,
    acceptsImage: false,
    maxColors: 10,
    colors: ['#4449cf', '#ffd1e0', '#f94446', '#ffd36b', '#ffffff'],
    speed: 0.5,
    scale: 0.6,
  },
  metaballs: {
    label: 'Metaballs',
    requiresImage: false,
    acceptsImage: false,
    maxColors: 8,
    colors: ['#6e33cc', '#ff5500', '#ffc105', '#ffc800', '#f585ff'],
    speed: 1,
    scale: 1,
  },
  waves: shaderDefaults('Waves', 0, 0.6),
  'perlin-noise': shaderDefaults('Perlin Noise', 0.5),
  voronoi: {
    label: 'Voronoi',
    requiresImage: false,
    acceptsImage: false,
    maxColors: 5,
    colors: ['#ff8247', '#ffe53d'],
    speed: 0.5,
    scale: 0.5,
  },
  warp: {
    label: 'Warp',
    requiresImage: false,
    acceptsImage: false,
    maxColors: 10,
    colors: ['#121212', '#9470ff', '#121212', '#8838ff'],
    speed: 1,
    scale: 1,
  },
  'god-rays': {
    label: 'God Rays',
    requiresImage: false,
    acceptsImage: false,
    maxColors: 5,
    colors: ['#a600ff6e', '#6200fff0', '#ffffff', '#33fff5'],
    speed: 0.75,
    scale: 1,
  },
  spiral: shaderDefaults('Spiral', 1),
  swirl: {
    label: 'Swirl',
    requiresImage: false,
    acceptsImage: false,
    maxColors: 10,
    colors: ['#ffd1d1', '#ff8a8a', '#660000'],
    speed: 0.32,
    scale: 1,
  },
  dithering: shaderDefaults('Dithering', 1, 0.6),
  'grain-gradient': {
    label: 'Grain Gradient',
    requiresImage: false,
    acceptsImage: false,
    maxColors: 7,
    colors: ['#7300ff', '#eba8ff', '#00bfff', '#2a00ff'],
    speed: 1,
    scale: 1,
  },
  'pulsing-border': {
    label: 'Pulsing Border',
    requiresImage: false,
    acceptsImage: false,
    maxColors: 5,
    colors: ['#0dc1fd', '#d915ef', '#ff3f2ecc'],
    speed: 1,
    scale: 0.6,
  },
  'color-panels': {
    label: 'Color Panels',
    requiresImage: false,
    acceptsImage: false,
    maxColors: 7,
    colors: [
      '#ff9d00',
      '#fd4f30',
      '#809bff',
      '#6d2eff',
      '#333aff',
      '#f15cff',
      '#ffd557',
    ],
    speed: 0.5,
    scale: 0.8,
  },
  'static-mesh-gradient': {
    label: 'Static Mesh Gradient',
    requiresImage: false,
    acceptsImage: false,
    maxColors: 10,
    colors: ['#ffad0a', '#6200ff', '#e2a3ff', '#ff99fd'],
    speed: 0,
    scale: 1,
  },
  'static-radial-gradient': {
    label: 'Static Radial Gradient',
    requiresImage: false,
    acceptsImage: false,
    maxColors: 10,
    colors: ['#00bbff', '#00ffe1', '#ffffff'],
    speed: 0,
    scale: 1,
  },
  'paper-texture': shaderDefaults('Paper Texture', 0, 0.6, true),
  'fluted-glass': shaderDefaults('Fluted Glass', 0, 1, true, true),
  water: shaderDefaults('Water', 1, 0.8, true),
  'image-dithering': shaderDefaults(
    'Image Dithering',
    0,
    1,
    true,
    true,
  ),
  'halftone-dots': shaderDefaults('Halftone Dots', 0, 1, true, true),
  'halftone-cmyk': shaderDefaults('Halftone CMYK', 0, 1, true, true),
  heatmap: {
    label: 'Heatmap',
    requiresImage: true,
    acceptsImage: true,
    maxColors: 10,
    colors: [
      '#11206a',
      '#1f3ba2',
      '#2f63e7',
      '#6bd7ff',
      '#ffe679',
      '#ff991e',
      '#ff4c00',
    ],
    speed: 1,
    scale: 0.75,
  },
  'liquid-metal': shaderDefaults('Liquid Metal', 1, 0.6, true),
  'gem-smoke': {
    label: 'Gem Smoke',
    requiresImage: false,
    acceptsImage: true,
    maxColors: 6,
    colors: ['#333333', '#e7e6df'],
    speed: 1,
    scale: 0.6,
  },
}

function shaderDefaults(
  label: string,
  speed: number,
  scale = 1,
  acceptsImage = false,
  requiresImage = false,
): PaperShaderDefinitionJson {
  return {
    label,
    requiresImage,
    acceptsImage,
    maxColors: 10,
    colors: [],
    speed,
    scale,
  }
}

function isPaperShaderType(value: unknown): value is PaperShaderTypeJson {
  return typeof value === 'string' && PAPER_SHADER_TYPE_SET.has(value)
}

function paperShaderDefinition(
  value: unknown,
): PaperShaderDefinitionJson {
  return PAPER_SHADER_DEFINITIONS[
    isPaperShaderType(value) ? value : 'mesh-gradient'
  ]
}

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
  const activeComposition = resolveAuthoredActiveComposition(json)
  const hasSequenceData =
    json.compositionScenes !== undefined ||
    json.sequenceItems !== undefined ||
    json.sequenceOrder !== undefined ||
    json.activeCompositionId !== undefined ||
    json.sequenceSchemaVersion !== undefined

  // --- meta ---
  const meta = new Y.Map<unknown>()
  scene.set('meta', meta)
  const metaInput =
    json.meta?.duration === undefined && activeComposition
      ? { ...json.meta, duration: activeComposition.duration }
      : json.meta
  const metaIn = mergeWithDefaults(DEFAULT_META, metaInput)
  for (const [k, v] of Object.entries(metaIn)) meta.set(k, v)

  // --- nodes ---
  const nodes = new Y.Map<Y.Map<unknown>>()
  scene.set('nodes', nodes)

  for (const node of Object.values(json.nodes ?? {})) {
    assertNodeKindCanBeAuthored(node.id, node.kind)
    const y = new Y.Map<unknown>()
    y.set('id', node.id)
    y.set('kind', node.kind)
    y.set(
      'name',
      node.name ?? defaultName(node.kind, node.shaderType),
    )
    y.set('parent', node.parent ?? null)
    // Children: store as Y.Array so reorder ops work in the editor.
    const childArr = new Y.Array<string>()
    for (const c of node.children ?? []) childArr.push([c])
    y.set('children', childArr)
    y.set(
      'transform',
      mergeWithDefaults(
        DEFAULT_TRANSFORM,
        node.transform,
      ),
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
    y.set('zIndex', normalizeLayerZIndex(node.zIndex))
    y.set('isMask', node.isMask ?? false)
    y.set('componentSourceId', node.componentSourceId ?? null)
    y.set('workspaceOnly', node.workspaceOnly ?? false)
    // Keep older scene snapshots byte-compatible when no layer rail was
    // supplied. The desktop reader already treats a missing value as null.
    if (node.motionPath !== undefined) {
      y.set('motionPath', node.motionPath)
    }

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
    if (node.kind === 'ellipse') {
      y.set('arc', normalizeEllipseArcJson(node.arc))
    }
    if (node.kind === 'image') {
      y.set('src', node.src ?? '')
      y.set('fit', node.fit ?? 'cover')
      if (node.importWarning !== undefined) y.set('importWarning', node.importWarning)
    }
    if (node.kind === 'shader') {
      const shaderType = node.shaderType ?? 'mesh-gradient'
      const definition = paperShaderDefinition(shaderType)
      y.set('size', mergeWithDefaults(DEFAULT_SHADER_SIZE, node.size))
      y.set('shaderType', shaderType)
      y.set('colors', node.colors ?? [...definition.colors])
      y.set('params', node.params ?? {})
      if (node.sourceNodeId !== undefined) {
        y.set('sourceNodeId', node.sourceNodeId)
      }
      if (node.sourceImage !== undefined) y.set('sourceImage', node.sourceImage)
      y.set('speed', node.speed ?? definition.speed)
      y.set('scale', node.scale ?? definition.scale)
      y.set(
        'distortion',
        node.distortion ?? (shaderType === 'mesh-gradient' ? 0.8 : 0),
      )
      y.set('swirl', node.swirl ?? (shaderType === 'mesh-gradient' ? 0.1 : 0))
      y.set('grain', node.grain ?? (shaderType === 'mesh-gradient' ? 0.08 : 0))
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
      y.set('playbackRate', node.playbackRate ?? 1)
      y.set('startTime', node.startTime ?? 0)
      y.set('trimStart', node.trimStart ?? 0)
      y.set('trimEnd', node.trimEnd ?? node.duration ?? 0)
      y.set('loop', node.loop ?? false)
      y.set('muted', node.muted ?? node.kind === 'video')
      if (node.kind === 'audio') {
        if (node.beatAnalysis !== undefined) y.set('beatAnalysis', node.beatAnalysis)
        if (node.beatGrid !== undefined) y.set('beatGrid', node.beatGrid)
      }
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
      y.set(
        'scrollSensitivity',
        normalizeCameraScrollSensitivity(node.scrollSensitivity),
      )
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
      y.set('fStop', node.fStop ?? 2.8)
      y.set('bladeCount', node.bladeCount ?? 7)
      y.set('bladeRotation', node.bladeRotation ?? 0)
      y.set('bokehRatio', node.bokehRatio ?? 1)
      y.set('dofPreviewQuality', node.dofPreviewQuality ?? 'balanced')
      y.set('iso', node.iso ?? 100)
      y.set('blurLevel', node.blurLevel ?? 1)
      y.set('blurQuality', node.blurQuality ?? 24)
      y.set('chromaticAberrationEnabled', node.chromaticAberrationEnabled ?? false)
      y.set('chromaticAberrationAmount', node.chromaticAberrationAmount ?? 4)
      y.set('chromaticAberrationAngle', node.chromaticAberrationAngle ?? 0)
      y.set('bloomEnabled', node.bloomEnabled ?? false)
      y.set('bloomStrength', node.bloomStrength ?? 0.8)
      y.set('bloomRadius', node.bloomRadius ?? 0.35)
      y.set('bloomThreshold', node.bloomThreshold ?? 0.75)
      y.set('vhsEnabled', node.vhsEnabled ?? false)
      y.set('vhsIntensity', node.vhsIntensity ?? 0.65)
      y.set('vhsNoise', node.vhsNoise ?? 0.35)
      y.set('vhsScanlines', node.vhsScanlines ?? 0.5)
      y.set('vhsColorBleed', node.vhsColorBleed ?? 3)
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

  // --- camera ownership + timed cuts ---
  // These fields are optional so existing .hype files keep their exact
  // legacy meaning. Consumers infer all camera nodes as owned, and use
  // activeCameraId (then the first owned camera) as the default when the
  // explicit fields are absent.
  if (json.cameraIds !== undefined) {
    const cameraIds = new Y.Array<string>()
    if (json.cameraIds.length > 0) cameraIds.push(json.cameraIds)
    scene.set('cameraIds', cameraIds)
  }
  if (json.defaultCameraId !== undefined) {
    scene.set('defaultCameraId', json.defaultCameraId)
  }
  if (json.cameraCuts !== undefined) {
    const cameraCuts = new Y.Map<unknown>()
    for (const cut of Object.values(json.cameraCuts)) {
      cameraCuts.set(cut.id, cut)
    }
    scene.set('cameraCuts', cameraCuts)
  }

  // --- compositions + master sequence ---
  // Nodes and tracks stay project-global. Composition records only own a
  // root, cameras, local cuts and duration; sequence items reference those
  // records and can reuse the same composition more than once.
  if (json.compositionScenes !== undefined) {
    const compositionScenes = new Y.Map<unknown>()
    for (const composition of Object.values(json.compositionScenes)) {
      compositionScenes.set(composition.id, composition)
    }
    scene.set('compositionScenes', compositionScenes)
  }
  if (json.sequenceItems !== undefined) {
    const sequenceItems = new Y.Map<unknown>()
    for (const item of Object.values(json.sequenceItems)) {
      sequenceItems.set(item.id, item)
    }
    scene.set('sequenceItems', sequenceItems)
  }
  if (json.sequenceOrder !== undefined) {
    const sequenceOrder = new Y.Array<string>()
    if (json.sequenceOrder.length > 0) {
      sequenceOrder.push(json.sequenceOrder)
    }
    scene.set('sequenceOrder', sequenceOrder)
  }
  if (hasSequenceData) {
    scene.set(
      'sequenceSchemaVersion',
      json.sequenceSchemaVersion ?? SEQUENCE_SCHEMA_VERSION,
    )
    const activeCompositionId =
      json.activeCompositionId ?? activeComposition?.id
    if (activeCompositionId) {
      scene.set('activeCompositionId', activeCompositionId)
    }
  }

  // --- scalars ---
  // root + activeCameraId. The desktop app auto-promotes the first
  // parentless non-camera node to root on load, so we don't strictly
  // need to set this — but doing so matches what `Save` produces and
  // makes round-trips byte-stable.
  if (json.root) scene.set('root', json.root)
  else if (activeComposition) {
    scene.set('root', activeComposition.rootNodeId)
  }
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
  } else if (activeComposition) {
    scene.set('activeCameraId', activeComposition.defaultCameraId)
  } else {
    // Prefer the explicit default, then the first explicitly-owned
    // camera, then the first camera node for legacy input.
    const inferredCameraId =
      (typeof json.defaultCameraId === 'string'
        ? json.defaultCameraId
        : json.cameraIds?.[0]) ??
      Object.values(json.nodes ?? {}).find((node) => node.kind === 'camera')?.id
    if (inferredCameraId) {
      scene.set('activeCameraId', inferredCameraId)
    }
  }

  // Seed an empty uiState map so the desktop app's ensureMap reads
  // back stable shape (groups, collapse flags, etc. are empty for a
  // freshly-built scene).
  scene.set('uiState', new Y.Map<unknown>())

  return Y.encodeStateAsUpdate(doc)
}

function resolveAuthoredActiveComposition(
  json: SceneJson,
): CompositionSceneJson | undefined {
  const compositions = Object.values(json.compositionScenes ?? {})
  const compositionById = new Map(
    compositions.map((composition) => [composition.id, composition]),
  )
  if (json.activeCompositionId !== undefined) {
    return compositionById.get(json.activeCompositionId)
  }

  const items = Object.values(json.sequenceItems ?? {})
  const itemById = new Map(items.map((item) => [item.id, item]))
  for (const itemId of json.sequenceOrder ?? []) {
    const item = itemById.get(itemId)
    const composition = item
      ? compositionById.get(item.sceneId)
      : undefined
    if (composition) return composition
  }
  for (const item of items) {
    const composition = compositionById.get(item.sceneId)
    if (composition) return composition
  }
  return compositions[0]
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
  const cameraNodeIds = Object.entries(nodes)
    .filter(([, raw]) => asRecord(raw).kind === 'camera')
    .map(([id]) => id)
  const declaredCameraIds = Array.isArray(data.cameraIds)
    ? data.cameraIds.filter((id): id is string => typeof id === 'string')
    : null
  const effectiveCameraIds = declaredCameraIds ?? cameraNodeIds
  const effectiveCameraIdSet = new Set(effectiveCameraIds)

  if (data.meta !== undefined && !isPlainObject(data.meta)) {
    errors.push('scene.meta must be an object')
  }
  if (data.nodes !== undefined && !isPlainObject(data.nodes)) {
    errors.push('scene.nodes must be an object')
  }
  if (data.tracks !== undefined && !isPlainObject(data.tracks)) {
    errors.push('scene.tracks must be an object')
  }
  if (data.sections !== undefined && !isPlainObject(data.sections)) {
    errors.push('scene.sections must be an object')
  }
  if (data.cameraIds !== undefined && !Array.isArray(data.cameraIds)) {
    errors.push('scene.cameraIds must be an array')
  }
  if (data.cameraCuts !== undefined && !isPlainObject(data.cameraCuts)) {
    errors.push('scene.cameraCuts must be an object')
  }

  if (Array.isArray(data.cameraIds)) {
    const seenCameraIds = new Set<string>()
    data.cameraIds.forEach((cameraId, index) => {
      if (typeof cameraId !== 'string' || cameraId.length === 0) {
        errors.push(`scene.cameraIds[${index}] must be a non-empty string`)
        return
      }
      if (seenCameraIds.has(cameraId)) {
        errors.push(`scene.cameraIds contains duplicate camera id: ${cameraId}`)
        return
      }
      seenCameraIds.add(cameraId)
      if (!nodes[cameraId]) {
        errors.push(`scene.cameraIds points to missing node: ${cameraId}`)
      } else if (asRecord(nodes[cameraId]).kind !== 'camera') {
        errors.push(`scene.cameraIds includes non-camera node: ${cameraId}`)
      }
    })
    for (const cameraNodeId of cameraNodeIds) {
      if (!effectiveCameraIdSet.has(cameraNodeId)) {
        errors.push(
          `camera node ${cameraNodeId} is not owned by scene.cameraIds`,
        )
      }
    }
  }

  if (data.root !== undefined && typeof data.root !== 'string') {
    errors.push('scene.root must be a string')
  } else if (!root) errors.push('scene.root is missing')
  else if (!nodes[root]) errors.push(`scene.root points to missing node: ${root}`)
  else if (asRecord(nodes[root]).kind !== 'frame') {
    errors.push(`scene.root is not a frame node: ${root}`)
  } else if (typeof asRecord(nodes[root]).parent === 'string') {
    errors.push(`scene.root must be scene-level with parent: null: ${root}`)
  }

  if (data.activeCameraId !== undefined && data.activeCameraId !== null && typeof data.activeCameraId !== 'string') {
    errors.push('scene.activeCameraId must be a string')
  } else if (!activeCameraId && effectiveCameraIds.length > 0) warnings.push('scene.activeCameraId is missing')
  else if (activeCameraId && !nodes[activeCameraId]) errors.push(`scene.activeCameraId points to missing node: ${activeCameraId}`)
  else if (activeCameraId && asRecord(nodes[activeCameraId]).kind !== 'camera') {
    errors.push(`scene.activeCameraId is not a camera node: ${activeCameraId}`)
  } else if (
    activeCameraId &&
    declaredCameraIds !== null &&
    !effectiveCameraIdSet.has(activeCameraId)
  ) {
    errors.push(`scene.activeCameraId is not owned by this scene: ${activeCameraId}`)
  }

  const defaultCameraId =
    typeof data.defaultCameraId === 'string' ? data.defaultCameraId : ''
  if (
    data.defaultCameraId !== undefined &&
    data.defaultCameraId !== null &&
    (typeof data.defaultCameraId !== 'string' || data.defaultCameraId.length === 0)
  ) {
    errors.push('scene.defaultCameraId must be a non-empty string or null')
  } else if (defaultCameraId && !nodes[defaultCameraId]) {
    errors.push(`scene.defaultCameraId points to missing node: ${defaultCameraId}`)
  } else if (
    defaultCameraId &&
    asRecord(nodes[defaultCameraId]).kind !== 'camera'
  ) {
    errors.push(`scene.defaultCameraId is not a camera node: ${defaultCameraId}`)
  } else if (
    defaultCameraId &&
    asRecord(nodes[defaultCameraId]).enabled === false
  ) {
    errors.push(`scene.defaultCameraId points to a disabled camera: ${defaultCameraId}`)
  } else if (
    defaultCameraId &&
    declaredCameraIds !== null &&
    !effectiveCameraIdSet.has(defaultCameraId)
  ) {
    errors.push(`scene.defaultCameraId is not owned by this scene: ${defaultCameraId}`)
  }

  for (const [id, raw] of Object.entries(nodes)) {
    const node = asRecord(raw)
    if (!isPlainObject(raw)) errors.push(`node ${id} must be an object`)
    if (node.id !== id) errors.push(`node map key ${id} does not match node id: ${String(node.id)}`)
    if (typeof node.kind !== 'string' || !isNodeKind(node.kind)) {
      errors.push(`node ${id} has unsupported kind: ${String(node.kind)}`)
    }
    if (node.position !== undefined && (typeof node.position !== 'string' || !isNodePosition(node.position))) {
      errors.push(`node ${id} has unsupported position: ${String(node.position)}`)
    }
    if (
      node.zIndex !== undefined &&
      (typeof node.zIndex !== 'number' ||
        !Number.isInteger(node.zIndex) ||
        node.zIndex < MIN_LAYER_Z_INDEX ||
        node.zIndex > MAX_LAYER_Z_INDEX)
    ) {
      errors.push(
        `node ${id} zIndex must be an integer between ${MIN_LAYER_Z_INDEX} and ${MAX_LAYER_Z_INDEX}`,
      )
    }
    validateLayerMotionPath(id, node, root, errors)
    const parent = typeof node.parent === 'string' ? node.parent : null
    if (node.parent !== undefined && node.parent !== null && typeof node.parent !== 'string') {
      errors.push(`node ${id} parent must be a string or null`)
    }
    if (node.kind === 'camera' && parent) {
      errors.push(`camera node ${id} must be scene-level with parent: null`)
    }
    if (node.kind === 'shader') {
      const shaderType = node.shaderType
      const supportedShaderType = isPaperShaderType(shaderType)
      if (!supportedShaderType) {
        errors.push(
          `shader node ${id} has unsupported shaderType: ${String(node.shaderType)}`,
        )
      }
      const definition = paperShaderDefinition(shaderType)
      const minimumColors = definition.colors.length > 0 ? 1 : 0
      if (
        !Array.isArray(node.colors) ||
        node.colors.length < minimumColors ||
        node.colors.length > definition.maxColors ||
        node.colors.some(
          (color) =>
            typeof color !== 'string' ||
            !PAPER_SHADER_HEX_COLOR.test(color),
        )
      ) {
        const range =
          minimumColors === 0
            ? `0-${definition.maxColors}`
            : `1-${definition.maxColors}`
        errors.push(
          `shader node ${id} colors must contain ${range} hex colors (#RGB, #RRGGBB, or #RRGGBBAA)`,
        )
      }
      if (
        node.params !== undefined &&
        (!isPlainObject(node.params) || !isValidShaderParams(node.params))
      ) {
        errors.push(
          `shader node ${id} params must be a bounded JSON object with finite numbers`,
        )
      }
      const sourceNodeId =
        typeof node.sourceNodeId === 'string' ? node.sourceNodeId.trim() : ''
      const sourceImage =
        typeof node.sourceImage === 'string' ? node.sourceImage.trim() : ''
      if (
        node.sourceNodeId !== undefined &&
        (typeof node.sourceNodeId !== 'string' ||
          sourceNodeId.length === 0 ||
          sourceNodeId.length > 512)
      ) {
        errors.push(
          `shader node ${id} sourceNodeId must be a non-empty string up to 512 characters`,
        )
      } else if (sourceNodeId === id) {
        errors.push(`shader node ${id} cannot use itself as sourceNodeId`)
      } else if (sourceNodeId && !nodes[sourceNodeId]) {
        errors.push(
          `shader node ${id} sourceNodeId points to missing node: ${sourceNodeId}`,
        )
      }
      if (
        node.sourceImage !== undefined &&
        (typeof node.sourceImage !== 'string' || sourceImage.length === 0)
      ) {
        errors.push(
          `shader node ${id} sourceImage must be a non-empty string`,
        )
      }
      if (
        supportedShaderType &&
        !definition.acceptsImage &&
        (sourceNodeId || sourceImage)
      ) {
        errors.push(
          `shader node ${id} ${shaderType} does not accept an image source`,
        )
      }
      if (
        supportedShaderType &&
        definition.requiresImage &&
        !sourceNodeId &&
        !sourceImage
      ) {
        errors.push(
          `shader node ${id} ${shaderType} requires sourceNodeId or sourceImage`,
        )
      }
      for (const [field, min, max] of [
        ['speed', 0, 2],
        ['scale', 0.1, 4],
        ['distortion', 0, 1],
        ['swirl', 0, 1],
        ['grain', 0, 1],
      ] as const) {
        const value = node[field]
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push(`shader node ${id} ${field} must be a finite number`)
        } else if (value < min || value > max) {
          errors.push(
            `shader node ${id} ${field} must be between ${min} and ${max}`,
          )
        }
      }
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
      if (typeof child !== 'string') errors.push(`node ${id} child must be a string: ${String(child)}`)
      else if (!nodes[child]) errors.push(`node ${id} has missing child: ${child}`)
      else if (seenChildren.has(child)) errors.push(`node ${id} lists duplicate child: ${child}`)
      else if (asRecord(nodes[child]).parent !== id) {
        errors.push(`node ${id} lists child ${child}, but child's parent is ${String(asRecord(nodes[child]).parent)}`)
      }
      if (typeof child === 'string') seenChildren.add(child)
    }
  }

  for (const id of Object.keys(nodes)) {
    const seenParents = new Set<string>([id])
    let current = asRecord(nodes[id]).parent
    while (typeof current === 'string') {
      if (seenParents.has(current)) {
        errors.push(`node ${id} has a parent cycle through ${current}`)
        break
      }
      seenParents.add(current)
      if (!nodes[current]) break
      current = asRecord(nodes[current]).parent
    }
  }

  const cameraCuts = asRecord(data.cameraCuts)
  const sceneDuration = asRecord(data.meta).duration
  for (const [id, raw] of Object.entries(cameraCuts)) {
    const cut = asRecord(raw)
    if (!isPlainObject(raw)) errors.push(`camera cut ${id} must be an object`)
    if (cut.id !== id) {
      errors.push(
        `camera cut map key ${id} does not match camera cut id: ${String(cut.id)}`,
      )
    }
    const cutCameraId =
      typeof cut.cameraId === 'string' ? cut.cameraId : ''
    if (!cutCameraId) {
      errors.push(`camera cut ${id} cameraId must be a non-empty string`)
    } else if (!nodes[cutCameraId]) {
      errors.push(
        `camera cut ${id} points to missing camera node: ${cutCameraId}`,
      )
    } else if (asRecord(nodes[cutCameraId]).kind !== 'camera') {
      errors.push(`camera cut ${id} points to non-camera node: ${cutCameraId}`)
    } else if (asRecord(nodes[cutCameraId]).enabled === false) {
      errors.push(`camera cut ${id} points to disabled camera: ${cutCameraId}`)
    } else if (
      declaredCameraIds !== null &&
      !effectiveCameraIdSet.has(cutCameraId)
    ) {
      errors.push(
        `camera cut ${id} camera is not owned by this scene: ${cutCameraId}`,
      )
    }
    if (typeof cut.time !== 'number' || !Number.isFinite(cut.time)) {
      errors.push(`camera cut ${id} time must be a finite number`)
    } else {
      if (cut.time < 0) {
        errors.push(`camera cut ${id} time must be greater than or equal to 0`)
      }
      if (
        typeof sceneDuration === 'number' &&
        Number.isFinite(sceneDuration) &&
        cut.time >= sceneDuration
      ) {
        errors.push(
          `camera cut ${id} time must be less than scene duration ${sceneDuration}`,
        )
      }
    }
  }

  if (
    data.compositionScenes !== undefined ||
    data.sequenceItems !== undefined ||
    data.sequenceOrder !== undefined ||
    data.activeCompositionId !== undefined ||
    data.sequenceSchemaVersion !== undefined
  ) {
    validateSequenceModel(data, nodes, errors, warnings)
  }

  for (const [id, raw] of Object.entries(tracks)) {
    const track = asRecord(raw)
    if (!isPlainObject(raw)) errors.push(`track ${id} must be an object`)
    if (track.id !== id) errors.push(`track map key ${id} does not match track id: ${String(track.id)}`)
    const nodeId = track.nodeId
    if (typeof nodeId !== 'string' || !nodes[nodeId]) {
      errors.push(`track ${id} points to missing node: ${String(nodeId)}`)
    }
    if (!Array.isArray(track.keyframes)) {
      errors.push(`track ${id} keyframes must be an array`)
    } else {
      const seenKeyframes = new Set<string>()
      track.keyframes.forEach((rawKeyframe, index) => {
        const keyframe = asRecord(rawKeyframe)
        const label = typeof keyframe.id === 'string' ? keyframe.id : `#${index}`
        const keyframeIsObject = isPlainObject(rawKeyframe)
        if (!keyframeIsObject) errors.push(`track ${id} keyframe ${index} must be an object`)
        if (typeof keyframe.id !== 'string') errors.push(`track ${id} keyframe ${index} id must be a string`)
        else if (seenKeyframes.has(keyframe.id)) errors.push(`track ${id} has duplicate keyframe id: ${keyframe.id}`)
        else seenKeyframes.add(keyframe.id)
        if (typeof keyframe.time !== 'number' || !Number.isFinite(keyframe.time)) {
          errors.push(`track ${id} keyframe ${label} time must be a finite number`)
        }
        if (keyframeIsObject && (!('value' in keyframe) || !isJsonValue(keyframe.value))) {
          errors.push(`track ${id} keyframe ${label} value must be JSON-compatible`)
        }
        if (keyframe.easingPreset !== undefined) {
          const easingPreset = asRecord(keyframe.easingPreset)
          if (
            !isPlainObject(keyframe.easingPreset) ||
            typeof easingPreset.presetId !== 'string' ||
            !KEYFRAME_EASING_PRESET_ID_SET.has(
              easingPreset.presetId as KeyframeEasingPresetIdJson,
            )
          ) {
            errors.push(
              `track ${id} keyframe ${label} easingPreset.presetId is invalid`,
            )
          }
          if (
            typeof easingPreset.strength !== 'number' ||
            !Number.isFinite(easingPreset.strength) ||
            easingPreset.strength < 0 ||
            easingPreset.strength > 200
          ) {
            errors.push(
              `track ${id} keyframe ${label} easingPreset.strength must be between 0 and 200`,
            )
          }
        }
      })
    }
    if (typeof track.propertyId !== 'string' || !isPropertyId(track.propertyId)) {
      errors.push(`track ${id} has unsupported propertyId: ${String(track.propertyId)}`)
    }
  }

  const sections = asRecord(data.sections)
  for (const [id, raw] of Object.entries(sections)) {
    const section = asRecord(raw)
    if (!isPlainObject(raw)) errors.push(`section ${id} must be an object`)
    if (section.id !== id) errors.push(`section map key ${id} does not match section id: ${String(section.id)}`)
    if (typeof section.name !== 'string') errors.push(`section ${id} name must be a string`)
    if (typeof section.color !== 'string') errors.push(`section ${id} color must be a string`)
    if (typeof section.start !== 'number' || !Number.isFinite(section.start)) {
      errors.push(`section ${id} start must be a finite number`)
    }
    if (typeof section.end !== 'number' || !Number.isFinite(section.end)) {
      errors.push(`section ${id} end must be a finite number`)
    } else if (typeof section.start === 'number' && Number.isFinite(section.start) && section.end < section.start) {
      errors.push(`section ${id} end must be greater than or equal to start`)
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

function validateSequenceModel(
  data: Record<string, unknown>,
  nodes: Record<string, unknown>,
  errors: string[],
  warnings: string[],
): void {
  if (
    data.sequenceSchemaVersion !== undefined &&
    data.sequenceSchemaVersion !== SEQUENCE_SCHEMA_VERSION
  ) {
    errors.push(
      `scene.sequenceSchemaVersion must be ${SEQUENCE_SCHEMA_VERSION}`,
    )
  } else if (data.sequenceSchemaVersion === undefined) {
    warnings.push('scene.sequenceSchemaVersion is missing')
  }

  if (!isPlainObject(data.compositionScenes)) {
    errors.push('scene.compositionScenes must be an object')
  }
  if (!isPlainObject(data.sequenceItems)) {
    errors.push('scene.sequenceItems must be an object')
  }
  if (data.sequenceOrder !== undefined && !Array.isArray(data.sequenceOrder)) {
    errors.push('scene.sequenceOrder must be an array')
  }

  const compositions = asRecord(data.compositionScenes)
  const sequenceItems = asRecord(data.sequenceItems)
  if (Object.keys(compositions).length === 0) {
    errors.push('scene.compositionScenes must contain at least one composition')
  }
  if (Object.keys(sequenceItems).length === 0) {
    errors.push('scene.sequenceItems must contain at least one sequence item')
  }

  const rootOwner = new Map<string, string>()
  const cameraOwner = new Map<string, string>()
  for (const [id, raw] of Object.entries(compositions)) {
    const composition = asRecord(raw)
    if (!isPlainObject(raw)) {
      errors.push(`composition scene ${id} must be an object`)
    }
    if (composition.id !== id) {
      errors.push(
        `composition scene map key ${id} does not match composition id: ${String(composition.id)}`,
      )
    }
    if (
      typeof composition.name !== 'string' ||
      composition.name.trim().length === 0
    ) {
      errors.push(`composition scene ${id} name must be a non-empty string`)
    }

    const rootNodeId =
      typeof composition.rootNodeId === 'string'
        ? composition.rootNodeId
        : ''
    if (!rootNodeId) {
      errors.push(`composition scene ${id} rootNodeId must be a non-empty string`)
    } else if (!nodes[rootNodeId]) {
      errors.push(
        `composition scene ${id} rootNodeId points to missing node: ${rootNodeId}`,
      )
    } else if (asRecord(nodes[rootNodeId]).kind !== 'frame') {
      errors.push(
        `composition scene ${id} rootNodeId is not a frame node: ${rootNodeId}`,
      )
    } else if (typeof asRecord(nodes[rootNodeId]).parent === 'string') {
      errors.push(
        `composition scene ${id} rootNodeId must be project-level with parent: null: ${rootNodeId}`,
      )
    }
    if (rootNodeId) {
      const existingOwner = rootOwner.get(rootNodeId)
      if (existingOwner && existingOwner !== id) {
        errors.push(
          `composition scenes ${existingOwner} and ${id} share rootNodeId: ${rootNodeId}`,
        )
      } else {
        rootOwner.set(rootNodeId, id)
      }
    }

    if (
      composition.workspaceNodeIds !== undefined &&
      !Array.isArray(composition.workspaceNodeIds)
    ) {
      errors.push(
        `composition scene ${id} workspaceNodeIds must be an array when provided`,
      )
    }
    const localWorkspaceNodeIds = new Set<string>()
    const workspaceNodeIds = Array.isArray(composition.workspaceNodeIds)
      ? composition.workspaceNodeIds
      : []
    workspaceNodeIds.forEach((nodeId, index) => {
      if (typeof nodeId !== 'string' || nodeId.length === 0) {
        errors.push(
          `composition scene ${id} workspaceNodeIds[${index}] must be a non-empty string`,
        )
        return
      }
      if (localWorkspaceNodeIds.has(nodeId)) {
        errors.push(
          `composition scene ${id} contains duplicate workspace node id: ${nodeId}`,
        )
        return
      }
      localWorkspaceNodeIds.add(nodeId)
      const workspaceNode = asRecord(nodes[nodeId])
      if (!nodes[nodeId]) {
        errors.push(
          `composition scene ${id} workspaceNodeIds points to missing node: ${nodeId}`,
        )
      } else if (typeof workspaceNode.parent === 'string') {
        errors.push(
          `composition scene ${id} workspace node ${nodeId} must be project-level with parent: null`,
        )
      } else if (workspaceNode.workspaceOnly !== true) {
        errors.push(
          `composition scene ${id} workspace node ${nodeId} must set workspaceOnly: true`,
        )
      }
    })

    const duration = composition.duration
    if (
      typeof duration !== 'number' ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      errors.push(`composition scene ${id} duration must be greater than 0`)
    }
    if (composition.workArea !== undefined) {
      const workArea = asRecord(composition.workArea)
      if (!isPlainObject(composition.workArea)) {
        errors.push(
          `composition scene ${id} workArea must be an object when provided`,
        )
      }
      if (
        typeof workArea.start !== 'number' ||
        !Number.isFinite(workArea.start) ||
        workArea.start < 0
      ) {
        errors.push(
          `composition scene ${id} workArea.start must be a finite number greater than or equal to 0`,
        )
      }
      if (
        typeof workArea.end !== 'number' ||
        !Number.isFinite(workArea.end)
      ) {
        errors.push(
          `composition scene ${id} workArea.end must be a finite number`,
        )
      } else {
        if (
          typeof workArea.start === 'number' &&
          Number.isFinite(workArea.start) &&
          workArea.end <= workArea.start
        ) {
          errors.push(
            `composition scene ${id} workArea.end must be greater than workArea.start`,
          )
        }
        if (
          typeof duration === 'number' &&
          Number.isFinite(duration) &&
          workArea.end > duration
        ) {
          errors.push(
            `composition scene ${id} workArea.end must not exceed composition duration ${duration}`,
          )
        }
      }
    }

    const ownedCameraIds = Array.isArray(composition.cameraIds)
      ? composition.cameraIds
      : []
    if (!Array.isArray(composition.cameraIds)) {
      errors.push(`composition scene ${id} cameraIds must be an array`)
    }
    const localCameraIds = new Set<string>()
    ownedCameraIds.forEach((cameraId, index) => {
      if (typeof cameraId !== 'string' || cameraId.length === 0) {
        errors.push(
          `composition scene ${id} cameraIds[${index}] must be a non-empty string`,
        )
        return
      }
      if (localCameraIds.has(cameraId)) {
        errors.push(
          `composition scene ${id} contains duplicate camera id: ${cameraId}`,
        )
        return
      }
      localCameraIds.add(cameraId)
      const existingOwner = cameraOwner.get(cameraId)
      if (existingOwner && existingOwner !== id) {
        errors.push(
          `camera node ${cameraId} is owned by composition scenes ${existingOwner} and ${id}`,
        )
      } else {
        cameraOwner.set(cameraId, id)
      }
      if (!nodes[cameraId]) {
        errors.push(
          `composition scene ${id} cameraIds points to missing node: ${cameraId}`,
        )
      } else if (asRecord(nodes[cameraId]).kind !== 'camera') {
        errors.push(
          `composition scene ${id} cameraIds includes non-camera node: ${cameraId}`,
        )
      } else if (typeof asRecord(nodes[cameraId]).parent === 'string') {
        errors.push(
          `composition scene ${id} camera ${cameraId} must be project-level with parent: null`,
        )
      }
    })

    const defaultCameraId =
      typeof composition.defaultCameraId === 'string'
        ? composition.defaultCameraId
        : ''
    if (
      composition.defaultCameraId !== null &&
      (typeof composition.defaultCameraId !== 'string' ||
        composition.defaultCameraId.length === 0)
    ) {
      errors.push(
        `composition scene ${id} defaultCameraId must be a non-empty string or null`,
      )
    } else if (defaultCameraId && !localCameraIds.has(defaultCameraId)) {
      errors.push(
        `composition scene ${id} defaultCameraId is not owned by the composition: ${defaultCameraId}`,
      )
    } else if (
      defaultCameraId &&
      asRecord(nodes[defaultCameraId]).enabled === false
    ) {
      errors.push(
        `composition scene ${id} defaultCameraId points to a disabled camera: ${defaultCameraId}`,
      )
    }

    if (!isPlainObject(composition.cameraCuts)) {
      errors.push(`composition scene ${id} cameraCuts must be an object`)
    }
    for (const [cutId, rawCut] of Object.entries(asRecord(composition.cameraCuts))) {
      const cut = asRecord(rawCut)
      if (!isPlainObject(rawCut)) {
        errors.push(`composition scene ${id} camera cut ${cutId} must be an object`)
      }
      if (cut.id !== cutId) {
        errors.push(
          `composition scene ${id} camera cut map key ${cutId} does not match cut id: ${String(cut.id)}`,
        )
      }
      const cutCameraId =
        typeof cut.cameraId === 'string' ? cut.cameraId : ''
      if (!cutCameraId) {
        errors.push(
          `composition scene ${id} camera cut ${cutId} cameraId must be a non-empty string`,
        )
      } else if (!localCameraIds.has(cutCameraId)) {
        errors.push(
          `composition scene ${id} camera cut ${cutId} targets an unowned camera: ${cutCameraId}`,
        )
      } else if (asRecord(nodes[cutCameraId]).enabled === false) {
        errors.push(
          `composition scene ${id} camera cut ${cutId} targets a disabled camera: ${cutCameraId}`,
        )
      }
      if (typeof cut.time !== 'number' || !Number.isFinite(cut.time)) {
        errors.push(
          `composition scene ${id} camera cut ${cutId} time must be a finite number`,
        )
      } else if (cut.time < 0) {
        errors.push(
          `composition scene ${id} camera cut ${cutId} time must be greater than or equal to 0`,
        )
      } else if (
        typeof duration === 'number' &&
        Number.isFinite(duration) &&
        cut.time >= duration
      ) {
        errors.push(
          `composition scene ${id} camera cut ${cutId} time must be less than composition duration ${duration}`,
        )
      }
    }
  }

  const globalCameraIds = Object.entries(nodes)
    .filter(([, raw]) => asRecord(raw).kind === 'camera')
    .map(([id]) => id)
  for (const cameraId of globalCameraIds) {
    if (!cameraOwner.has(cameraId)) {
      errors.push(
        `camera node ${cameraId} is not owned by a composition scene`,
      )
    }
  }

  for (const [id, raw] of Object.entries(sequenceItems)) {
    const item = asRecord(raw)
    if (!isPlainObject(raw)) {
      errors.push(`sequence item ${id} must be an object`)
    }
    if (item.id !== id) {
      errors.push(
        `sequence item map key ${id} does not match sequence item id: ${String(item.id)}`,
      )
    }
    const sceneId = typeof item.sceneId === 'string' ? item.sceneId : ''
    if (!sceneId) {
      errors.push(`sequence item ${id} sceneId must be a non-empty string`)
    } else if (!compositions[sceneId]) {
      errors.push(`sequence item ${id} points to missing composition: ${sceneId}`)
    }

    const compositionDuration = asRecord(compositions[sceneId]).duration
    if (
      item.masterAudioMuted !== undefined &&
      typeof item.masterAudioMuted !== 'boolean'
    ) {
      errors.push(
        `sequence item ${id} masterAudioMuted must be a boolean when provided`,
      )
    }
    const trimStart = item.trimStart ?? 0
    if (
      typeof trimStart !== 'number' ||
      !Number.isFinite(trimStart) ||
      trimStart < 0
    ) {
      errors.push(
        `sequence item ${id} trimStart must be a finite number greater than or equal to 0`,
      )
    } else if (
      typeof compositionDuration === 'number' &&
      Number.isFinite(compositionDuration) &&
      trimStart >= compositionDuration
    ) {
      errors.push(
        `sequence item ${id} trimStart must be less than composition duration ${compositionDuration}`,
      )
    }
    if (item.duration !== undefined) {
      if (
        typeof item.duration !== 'number' ||
        !Number.isFinite(item.duration) ||
        item.duration <= 0
      ) {
        errors.push(`sequence item ${id} duration must be greater than 0`)
      } else if (
        typeof trimStart === 'number' &&
        Number.isFinite(trimStart) &&
        typeof compositionDuration === 'number' &&
        Number.isFinite(compositionDuration) &&
        trimStart + item.duration > compositionDuration
      ) {
        errors.push(
          `sequence item ${id} trimStart + duration exceeds composition duration ${compositionDuration}`,
        )
      }
    }
    if (
      item.holdDuration !== undefined &&
      (typeof item.holdDuration !== 'number' ||
        !Number.isFinite(item.holdDuration) ||
        item.holdDuration < 0)
    ) {
      errors.push(
        `sequence item ${id} holdDuration must be a finite number greater than or equal to 0`,
      )
    }

    if (item.transitionOut !== undefined) {
      const transition = asRecord(item.transitionOut)
      if (!isPlainObject(item.transitionOut)) {
        errors.push(`sequence item ${id} transitionOut must be an object`)
      }
      if (transition.kind !== 'cut' && transition.kind !== 'crossfade') {
        errors.push(
          `sequence item ${id} transitionOut.kind must be cut or crossfade`,
        )
      }
      if (
        typeof transition.duration !== 'number' ||
        !Number.isFinite(transition.duration) ||
        transition.duration < 0
      ) {
        errors.push(
          `sequence item ${id} transitionOut.duration must be a finite number greater than or equal to 0`,
        )
      } else if (transition.kind === 'cut' && transition.duration !== 0) {
        errors.push(
          `sequence item ${id} cut transition duration must be 0`,
        )
      }
    }
  }

  const orderedItemIds: string[] = []
  const seenItemIds = new Set<string>()
  if (Array.isArray(data.sequenceOrder)) {
    data.sequenceOrder.forEach((rawItemId, index) => {
      if (typeof rawItemId !== 'string' || rawItemId.length === 0) {
        errors.push(
          `scene.sequenceOrder[${index}] must be a non-empty string`,
        )
        return
      }
      if (seenItemIds.has(rawItemId)) {
        errors.push(`scene.sequenceOrder contains duplicate item id: ${rawItemId}`)
        return
      }
      seenItemIds.add(rawItemId)
      if (!sequenceItems[rawItemId]) {
        errors.push(
          `scene.sequenceOrder points to missing sequence item: ${rawItemId}`,
        )
        return
      }
      orderedItemIds.push(rawItemId)
    })
    for (const itemId of Object.keys(sequenceItems)) {
      if (!seenItemIds.has(itemId)) {
        errors.push(`sequence item ${itemId} is missing from scene.sequenceOrder`)
        orderedItemIds.push(itemId)
      }
    }
  } else {
    warnings.push(
      'scene.sequenceOrder is missing; sequence item map insertion order will be used',
    )
    orderedItemIds.push(...Object.keys(sequenceItems))
  }

  const finalItemId = orderedItemIds.at(-1)
  if (finalItemId) {
    const finalTransition = asRecord(
      asRecord(sequenceItems[finalItemId]).transitionOut,
    )
    if (
      finalTransition.kind === 'crossfade' &&
      typeof finalTransition.duration === 'number' &&
      finalTransition.duration > 0
    ) {
      errors.push(
        `final sequence item ${finalItemId} cannot have a non-zero crossfade transition`,
      )
    }
  }

  const activeCompositionId =
    typeof data.activeCompositionId === 'string'
      ? data.activeCompositionId
      : ''
  if (!activeCompositionId) {
    warnings.push('scene.activeCompositionId is missing')
    return
  }
  const activeComposition = asRecord(compositions[activeCompositionId])
  if (!compositions[activeCompositionId]) {
    errors.push(
      `scene.activeCompositionId points to missing composition: ${activeCompositionId}`,
    )
    return
  }

  if (data.root !== activeComposition.rootNodeId) {
    errors.push(
      `scene.root must mirror active composition ${activeCompositionId} rootNodeId`,
    )
  }
  const activeDefaultCameraId =
    typeof activeComposition.defaultCameraId === 'string'
      ? activeComposition.defaultCameraId
      : null
  const projectedCameraId =
    typeof data.activeCameraId === 'string' ? data.activeCameraId : null
  if (projectedCameraId !== activeDefaultCameraId) {
    errors.push(
      `scene.activeCameraId must mirror active composition ${activeCompositionId} defaultCameraId`,
    )
  }
  if (asRecord(data.meta).duration !== activeComposition.duration) {
    errors.push(
      `scene.meta.duration must mirror active composition ${activeCompositionId} duration`,
    )
  }
}

function isNodeKind(value: unknown): value is NodeKindJson | 'vector' {
  return (
    typeof value === 'string' &&
    (value === 'vector' || NODE_KIND_SET.has(value as NodeKindJson))
  )
}

function assertNodeKindCanBeAuthored(nodeId: unknown, kind: unknown): void {
  // Vector nodes are valid in app-authored files (including the built-in
  // Cursor component), but the JSON authoring surface cannot yet reconstruct
  // their preserved SVG/vector payload without losing fidelity.
  if (kind === 'primitive3d' || kind === 'vector') {
    throw new Error(
      `node ${String(nodeId)} has unsupported kind: ${String(kind)}`,
    )
  }
}

function isNodePosition(value: string): value is NodePositionJson {
  return NODE_POSITION_SET.has(value as NodePositionJson)
}

function isPropertyId(value: string): value is PropertyIdJson {
  return PROPERTY_ID_SET.has(value) || EFFECT_BLUR_PROPERTY_ID.test(value)
}

function validateLayerMotionPath(
  nodeId: string,
  node: Record<string, unknown>,
  rootId: string,
  errors: string[],
): void {
  const raw = node.motionPath
  if (raw === undefined || raw === null) return
  const label = `node ${nodeId} motionPath`
  if (nodeId === rootId || node.kind === 'camera' || node.kind === 'audio') {
    errors.push(`${label} is only supported on non-root visual layers`)
    return
  }
  if (!isPlainObject(raw)) {
    errors.push(`${label} must be an object or null`)
    return
  }
  if (raw.version !== 1) {
    errors.push(`${label}.version must be 1`)
  }
  if (
    !Array.isArray(raw.points) ||
    raw.points.length < 2 ||
    raw.points.length > MAX_LAYER_MOTION_PATH_POINTS
  ) {
    errors.push(
      `${label}.points must contain 2-${MAX_LAYER_MOTION_PATH_POINTS} points`,
    )
    return
  }

  const ids = new Set<string>()
  let previousT = -Infinity
  for (let index = 0; index < raw.points.length; index++) {
    const point = raw.points[index]
    const pointLabel = `${label}.points[${index}]`
    if (!isPlainObject(point)) {
      errors.push(`${pointLabel} must be an object`)
      continue
    }
    if (typeof point.id !== 'string' || point.id.trim().length === 0) {
      errors.push(`${pointLabel}.id must be a non-empty string`)
    } else if (ids.has(point.id)) {
      errors.push(`${label} has duplicate point id: ${point.id}`)
    } else {
      ids.add(point.id)
    }
    if (
      typeof point.t !== 'number' ||
      !Number.isFinite(point.t) ||
      point.t < 0 ||
      point.t > 1
    ) {
      errors.push(`${pointLabel}.t must be between 0 and 1`)
    } else if (point.t <= previousT) {
      errors.push(`${label} point t values must be strictly increasing`)
    } else {
      previousT = point.t
    }
    for (const field of [
      'x',
      'y',
      'z',
      'inX',
      'inY',
      'inZ',
      'outX',
      'outY',
      'outZ',
    ] as const) {
      const value = point[field]
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        Math.abs(value) > MAX_LAYER_MOTION_PATH_COORDINATE
      ) {
        errors.push(
          `${pointLabel}.${field} must be a finite number between -${MAX_LAYER_MOTION_PATH_COORDINATE} and ${MAX_LAYER_MOTION_PATH_COORDINATE}`,
        )
      }
    }
  }

  const first = raw.points[0]
  const last = raw.points.at(-1)
  if (isPlainObject(first) && first.t !== 0) {
    errors.push(`${label} first point must use t: 0`)
  }
  if (isPlainObject(last) && last.t !== 1) {
    errors.push(`${label} last point must use t: 1`)
  }
  if (
    raw.progress !== undefined &&
    (typeof raw.progress !== 'number' ||
      !Number.isFinite(raw.progress) ||
      raw.progress < 0 ||
      raw.progress > 1)
  ) {
    errors.push(`${label}.progress must be between 0 and 1`)
  }
  if (raw.autoOrient !== undefined && typeof raw.autoOrient !== 'boolean') {
    errors.push(`${label}.autoOrient must be a boolean`)
  }
  if (
    raw.rotationOffset !== undefined &&
    (typeof raw.rotationOffset !== 'number' ||
      !Number.isFinite(raw.rotationOffset))
  ) {
    errors.push(`${label}.rotationOffset must be a finite number`)
  }
  if (
    raw.parameterization !== undefined &&
    raw.parameterization !== 'parametric' &&
    raw.parameterization !== 'arc-length'
  ) {
    errors.push(
      `${label}.parameterization must be parametric or arc-length`,
    )
  }
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (!isPlainObject(value)) return false
  return Object.values(value).every(isJsonValue)
}

function isValidShaderParams(value: unknown, depth = 0): boolean {
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'number') {
    return Number.isFinite(value) && Math.abs(value) <= 1_000_000
  }
  if (typeof value === 'string') return value.length <= 32_768
  if (depth >= 6) return false
  if (Array.isArray(value)) {
    return (
      value.length <= 128 &&
      value.every((item) => isValidShaderParams(item, depth + 1))
    )
  }
  if (!isPlainObject(value)) return false
  const entries = Object.entries(value)
  if (entries.length > 128) return false
  return entries.every(
    ([key, item]) =>
      key !== '__proto__' &&
      key !== 'constructor' &&
      key !== 'prototype' &&
      isValidShaderParams(item, depth + 1),
  )
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
      const y = nodeToYMap(op.node, readSceneMeta(scene))
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
        if (k === 'kind') assertNodeKindCanBeAuthored(op.nodeId, v)
        if (k === 'zIndex') node.set(k, normalizeLayerZIndex(v))
        else if (k === 'children' && Array.isArray(v)) node.set(k, arrayToY(v))
        else node.set(k, v)
      }
      return
    }
    case 'setNodeProperty': {
      const node = getNodeMap(scene, op.nodeId)
      if (op.key === 'kind') {
        assertNodeKindCanBeAuthored(op.nodeId, op.value)
      }
      if (op.key === 'zIndex') {
        node.set(op.key, normalizeLayerZIndex(op.value))
      } else if (op.key === 'children' && Array.isArray(op.value)) {
        node.set(op.key, arrayToY(op.value))
      } else {
        node.set(op.key, op.value)
      }
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

function nodeToYMap(node: NodeJson, meta: SceneMeta = DEFAULT_META): Y.Map<unknown> {
  assertNodeKindCanBeAuthored(node.id, node.kind)
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
    'zIndex',
    'isMask',
    'componentSourceId',
    'workspaceOnly',
  ])
  y.set('id', node.id)
  y.set('kind', node.kind)
  y.set(
    'name',
    node.name ?? defaultName(node.kind, node.shaderType),
  )
  y.set('parent', node.parent ?? null)
  y.set('children', arrayToY(node.children ?? []))
  y.set(
    'transform',
    mergeWithDefaults(
      DEFAULT_TRANSFORM,
      node.transform as Partial<typeof DEFAULT_TRANSFORM>,
    ),
  )
  y.set('appearance', mergeWithDefaults(defaultAppearance(node.kind), node.appearance))
  y.set('visible', node.visible ?? true)
  y.set('locked', node.locked ?? false)
  y.set('position', node.position ?? 'flow')
  y.set('zIndex', normalizeLayerZIndex(node.zIndex))
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
  if (node.kind === 'ellipse') {
    handledKeys.add('arc')
    y.set('arc', normalizeEllipseArcJson(node.arc))
  }
  if (node.kind === 'image') {
    handledKeys.add('src')
    handledKeys.add('fit')
    handledKeys.add('importWarning')
    y.set('src', node.src ?? '')
    y.set('fit', node.fit ?? 'cover')
    if (node.importWarning !== undefined) y.set('importWarning', node.importWarning)
  }
  if (node.kind === 'shader') {
    for (const key of [
      'size',
      'shaderType',
      'colors',
      'params',
      'sourceNodeId',
      'sourceImage',
      'speed',
      'scale',
      'distortion',
      'swirl',
      'grain',
    ]) {
      handledKeys.add(key)
    }
    const shaderType = node.shaderType ?? 'mesh-gradient'
    const definition = paperShaderDefinition(shaderType)
    y.set('size', mergeWithDefaults(DEFAULT_SHADER_SIZE, node.size))
    y.set('shaderType', shaderType)
    y.set('colors', node.colors ?? [...definition.colors])
    y.set('params', node.params ?? {})
    if (node.sourceNodeId !== undefined) y.set('sourceNodeId', node.sourceNodeId)
    if (node.sourceImage !== undefined) y.set('sourceImage', node.sourceImage)
    y.set('speed', node.speed ?? definition.speed)
    y.set('scale', node.scale ?? definition.scale)
    y.set(
      'distortion',
      node.distortion ?? (shaderType === 'mesh-gradient' ? 0.8 : 0),
    )
    y.set('swirl', node.swirl ?? (shaderType === 'mesh-gradient' ? 0.1 : 0))
    y.set('grain', node.grain ?? (shaderType === 'mesh-gradient' ? 0.08 : 0))
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
  if (node.kind === 'camera') {
    for (const key of [
      'projection',
      'enabled',
      'background',
      'focalLength',
      'scrollSensitivity',
      'fieldOfView',
      'pointOfInterestX',
      'pointOfInterestY',
      'pointOfInterestZ',
      'nearClip',
      'farClip',
      'depthOfField',
      'focusMode',
      'focusX',
      'focusY',
      'focusWorldX',
      'focusWorldY',
      'focusWorldZ',
      'focusTargetNodeId',
      'focusDistance',
      'focusRadius',
      'focusFalloff',
      'aperture',
      'fStop',
      'bladeCount',
      'bladeRotation',
      'bokehRatio',
      'dofPreviewQuality',
      'iso',
      'blurLevel',
      'blurQuality',
      'chromaticAberrationEnabled',
      'chromaticAberrationAmount',
      'chromaticAberrationAngle',
      'bloomEnabled',
      'bloomStrength',
      'bloomRadius',
      'bloomThreshold',
      'vhsEnabled',
      'vhsIntensity',
      'vhsNoise',
      'vhsScanlines',
      'vhsColorBleed',
      'showFocusPlane',
    ]) {
      handledKeys.add(key)
    }
    const centerX = meta.canvas.width / 2
    const centerY = meta.canvas.height / 2
    y.set('projection', node.projection ?? '2d')
    y.set('enabled', node.enabled ?? true)
    y.set('background', node.background ?? null)
    y.set('focalLength', node.focalLength ?? 1000)
    y.set(
      'scrollSensitivity',
      normalizeCameraScrollSensitivity(node.scrollSensitivity),
    )
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
    y.set('fStop', node.fStop ?? 2.8)
    y.set('bladeCount', node.bladeCount ?? 7)
    y.set('bladeRotation', node.bladeRotation ?? 0)
    y.set('bokehRatio', node.bokehRatio ?? 1)
    y.set('dofPreviewQuality', node.dofPreviewQuality ?? 'balanced')
    y.set('iso', node.iso ?? 100)
    y.set('blurLevel', node.blurLevel ?? 1)
    y.set('blurQuality', node.blurQuality ?? 24)
    y.set('chromaticAberrationEnabled', node.chromaticAberrationEnabled ?? false)
    y.set('chromaticAberrationAmount', node.chromaticAberrationAmount ?? 4)
    y.set('chromaticAberrationAngle', node.chromaticAberrationAngle ?? 0)
    y.set('bloomEnabled', node.bloomEnabled ?? false)
    y.set('bloomStrength', node.bloomStrength ?? 0.8)
    y.set('bloomRadius', node.bloomRadius ?? 0.35)
    y.set('bloomThreshold', node.bloomThreshold ?? 0.75)
    y.set('vhsEnabled', node.vhsEnabled ?? false)
    y.set('vhsIntensity', node.vhsIntensity ?? 0.65)
    y.set('vhsNoise', node.vhsNoise ?? 0.35)
    y.set('vhsScanlines', node.vhsScanlines ?? 0.5)
    y.set('vhsColorBleed', node.vhsColorBleed ?? 3)
    y.set('showFocusPlane', node.showFocusPlane ?? false)
  }
  for (const [k, v] of Object.entries(node)) {
    if (handledKeys.has(k)) continue
    y.set(k, v)
  }
  return y
}

function normalizeCameraScrollSensitivity(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 1
  return Math.max(0.1, Math.min(2, numeric))
}

function readSceneMeta(scene: Y.Map<unknown>): SceneMeta {
  const meta = scene.get('meta')
  if (!(meta instanceof Y.Map)) return DEFAULT_META
  const canvas = meta.get('canvas')
  const canvasPatch = canvas instanceof Y.Map
    ? Object.fromEntries(canvas.entries())
    : isPlainObject(canvas)
      ? canvas
      : undefined
  return mergeWithDefaults(DEFAULT_META, {
    id: meta.get('id'),
    name: meta.get('name'),
    duration: meta.get('duration'),
    frameRate: meta.get('frameRate'),
    canvas: canvasPatch,
  })
}

function deleteNode(scene: Y.Map<unknown>, nodeId: string): void {
  const nodes = getNodesMap(scene)
  const node = nodes.get(nodeId)
  if (!node) return
  const deletedNodeIds = new Set<string>()
  collectNodeSubtree(nodes, nodeId, deletedNodeIds)
  const parent = node.get('parent') as string | null
  detachFromParent(nodes, nodeId, parent)
  const childIds = stringIdsFromYArray(node.get('children'))
  for (const childId of childIds) deleteNode(scene, childId)
  nodes.delete(nodeId)
  deleteTracksForNodes(scene, deletedNodeIds)
  if (scene.get('root') === nodeId) scene.set('root', '')
  if (scene.get('activeCameraId') === nodeId) scene.set('activeCameraId', '')
}

function collectNodeSubtree(
  nodes: Y.Map<Y.Map<unknown>>,
  nodeId: string,
  out: Set<string>,
): void {
  const node = nodes.get(nodeId)
  if (!node || out.has(nodeId)) return
  out.add(nodeId)
  const childIds = stringIdsFromYArray(node.get('children'))
  for (const childId of childIds) collectNodeSubtree(nodes, childId, out)
}

function deleteTracksForNodes(scene: Y.Map<unknown>, nodeIds: Set<string>): void {
  if (nodeIds.size === 0) return
  const tracks = ensureMap(scene, 'tracks')
  const trackIdsToDelete: string[] = []
  for (const [trackId, raw] of tracks.entries()) {
    if (raw instanceof Y.Map && nodeIds.has(String(raw.get('nodeId')))) {
      trackIdsToDelete.push(trackId)
    }
  }
  for (const trackId of trackIdsToDelete) tracks.delete(trackId)
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

function stringIdsFromYArray(value: unknown): string[] {
  if (!(value instanceof Y.Array)) return []
  return value.toArray().filter((entry): entry is string => typeof entry === 'string')
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

function arrayToY(items: readonly unknown[]): Y.Array<unknown> {
  const arr = new Y.Array<unknown>()
  if (items.length > 0) arr.push(Array.from(items))
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
  return isPlainObject(value) ? value : {}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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
  const compositionScenes = scene.get('compositionScenes')
  const sequenceItems = scene.get('sequenceItems')
  const sequenceSchemaVersion = scene.get('sequenceSchemaVersion')

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
    activeCompositionId: nonEmptySceneId(scene.get('activeCompositionId')),
    sequenceSchemaVersion:
      typeof sequenceSchemaVersion === 'number' &&
      Number.isFinite(sequenceSchemaVersion)
        ? sequenceSchemaVersion
        : null,
    layerCount: nodes?.size ?? 0,
    trackCount: tracks?.size ?? 0,
    sectionCount: sections?.size ?? 0,
    keyframeCount,
    compositionSceneCount:
      compositionScenes instanceof Y.Map ? compositionScenes.size : 0,
    sequenceItemCount:
      sequenceItems instanceof Y.Map ? sequenceItems.size : 0,
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

function defaultName(
  kind: NodeKindJson,
  shaderType?: PaperShaderTypeJson,
): string {
  switch (kind) {
    case 'frame': return 'Frame'
    case 'rect': return 'Rectangle'
    case 'ellipse': return 'Ellipse'
    case 'text': return 'Text'
    case 'image': return 'Image'
    case 'shader': return paperShaderDefinition(shaderType).label
    case 'video': return 'Video'
    case 'audio': return 'Audio'
    case 'component': return 'Component'
    case 'instance': return 'Instance'
    case 'camera': return 'Camera'
  }
}

function defaultAppearance(kind: NodeKindJson): Record<string, unknown> {
  if (
    kind === 'text' ||
    kind === 'video' ||
    kind === 'audio' ||
    kind === 'shader'
  ) {
    return { ...DEFAULT_APPEARANCE, fill: null, stroke: null }
  }
  return { ...DEFAULT_APPEARANCE }
}

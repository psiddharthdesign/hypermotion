// SPDX-License-Identifier: Apache-2.0

/**
 * Wire format between the Figma plugin and Hyper Motion.
 *
 * The plugin walks Figma's scene-graph and emits a JSON payload that
 * matches this schema. Hyper Motion's paste handler parses it and
 * runs the walker in `walk.ts` to recreate the design as scene nodes.
 *
 * Versioned via `format` + `version` so older plugin builds can keep
 * working as we evolve the importer. Add fields by bumping the minor
 * version; remove or rename fields by bumping the major.
 *
 * Why a separate schema (instead of reusing our scene types directly):
 *   - The plugin runs in Figma's sandbox where scene/types.ts isn't
 *     reachable.
 *   - Figma's data shape doesn't 1:1 map to ours (we have `'flex' |
 *     'grid' | 'none'`; Figma has `layoutMode: NONE/HORIZONTAL/...`).
 *     Keeping the wire format close to Figma's shape lets the plugin
 *     stay dumb (just serialize what Figma gives) and centralizes the
 *     translation in the importer where we have access to the full
 *     scene API + colorConvert helpers.
 */

export const FIGMA_PAYLOAD_FORMAT = 'hyper-motion/figma' as const
export const FIGMA_PAYLOAD_VERSION = 3 as const
/** Native-vector payload used by plugin builds before editable ellipse arcs. */
export const FIGMA_PAYLOAD_VECTOR_VERSION = 2 as const
export const FIGMA_PAYLOAD_LEGACY_VERSION = 1 as const

export type FigmaPayloadVersion =
  | typeof FIGMA_PAYLOAD_LEGACY_VERSION
  | typeof FIGMA_PAYLOAD_VECTOR_VERSION
  | typeof FIGMA_PAYLOAD_VERSION

export interface FigmaPayload {
  format: typeof FIGMA_PAYLOAD_FORMAT
  /** Versions 1/2 are accepted for compatibility; new plugins emit 3. */
  version: FigmaPayloadVersion
  /** Root nodes from the user's selection. May be one or many. */
  nodes: FigmaCapturedNode[]
  /**
   * Image-fill assets, keyed by image hash. Newer plugin payloads store
   * complete data URLs so JPEG/WebP/GIF bytes keep their real MIME type.
   * Older payloads stored raw base64 and are still treated as PNG.
   */
  assets: Record<string, string>
}

// ---------------------------------------------------------------------------
// Captured node tree — a narrowed subset of Figma's SceneNode types.
// ---------------------------------------------------------------------------

export type FigmaCapturedNode =
  | FigmaCapturedFrame
  | FigmaCapturedRect
  | FigmaCapturedEllipse
  | FigmaCapturedText
  | FigmaCapturedVector

interface FigmaCapturedNodeBase {
  id: string
  name: string
  visible: boolean
  locked: boolean
  /** 0..1 */
  opacity: number
  /** Position relative to the node's parent. */
  x: number
  y: number
  width: number
  height: number
  /** Degrees, CSS convention (0 = up, increasing clockwise). */
  rotation: number
  /** Complete child-to-parent affine matrix, preserved by payload v2. */
  relativeTransform?: FigmaTransform
  /**
   * Figma's per-child "Absolute position" flag inside auto-layout /
   * flow parents. Missing on older plugin payloads.
   */
  layoutPositioning?: 'AUTO' | 'ABSOLUTE'
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL'
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL'
  minWidth?: number | null
  maxWidth?: number | null
  minHeight?: number | null
  maxHeight?: number | null
  /** Per-corner radii [tl, tr, br, bl]. */
  cornerRadius: [number, number, number, number]
  /** Figma's continuous-corner smoothing in the normalized 0..1 range. */
  cornerSmoothing?: number
  fills: FigmaCapturedFill[]
  strokes: FigmaCapturedFill[]
  strokeWeight: number
  /**
   * Per-side widths from Figma's strokeTop/Right/Bottom/LeftWeight
   * properties. Undefined when all four sides match `strokeWeight`
   * (uniform border) — the common case stays compact in the payload.
   */
  strokeWidths?: { top: number; right: number; bottom: number; left: number }
  strokeAlign: 'INSIDE' | 'OUTSIDE' | 'CENTER'
  /** Empty array means solid; presence means dashed. */
  strokeDashes: number[]
  strokeDashOffset?: number
  strokeCap?: FigmaStrokeCap | 'MIXED'
  strokeJoin?: FigmaStrokeJoin | 'MIXED'
  strokeMiterLimit?: number
  /** Figma layer blend mode. Missing on older plugin payloads. */
  blendMode?: FigmaBlendMode
  effects?: FigmaCapturedEffect[]
}

export type FigmaTransform = [
  [number, number, number],
  [number, number, number],
]

export type FigmaStrokeCap =
  | 'NONE'
  | 'ROUND'
  | 'SQUARE'
  | 'ARROW_LINES'
  | 'ARROW_EQUILATERAL'
  | 'DIAMOND_FILLED'
  | 'CIRCLE_FILLED'
  | 'TRIANGLE_FILLED'

export type FigmaStrokeJoin = 'MITER' | 'BEVEL' | 'ROUND'

export type FigmaBlendMode =
  | 'PASS_THROUGH'
  | 'NORMAL'
  | 'DARKEN'
  | 'MULTIPLY'
  | 'LINEAR_BURN'
  | 'COLOR_BURN'
  | 'LIGHTEN'
  | 'SCREEN'
  | 'LINEAR_DODGE'
  | 'COLOR_DODGE'
  | 'OVERLAY'
  | 'SOFT_LIGHT'
  | 'HARD_LIGHT'
  | 'DIFFERENCE'
  | 'EXCLUSION'
  | 'HUE'
  | 'SATURATION'
  | 'COLOR'
  | 'LUMINOSITY'

export interface FigmaCapturedFrame extends FigmaCapturedNodeBase {
  type: 'FRAME' | 'GROUP' | 'COMPONENT' | 'INSTANCE'
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID'
  primaryAxisSizingMode: 'FIXED' | 'AUTO'
  counterAxisSizingMode: 'FIXED' | 'AUTO'
  /** Newer sizing fields (Figma 2024+). Undefined on older captures. */
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL'
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL'
  primaryAxisAlignItems: 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN'
  counterAxisAlignItems: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE'
  itemSpacing: number
  /** Exact GRID dimensions/gutters. Missing on older plugin captures. */
  gridColumnCount?: number
  gridRowCount?: number
  gridColumnGap?: number
  gridRowGap?: number
  paddingLeft: number
  paddingRight: number
  paddingTop: number
  paddingBottom: number
  layoutWrap: 'NO_WRAP' | 'WRAP'
  /** Whether Figma includes the frame's stroke in its layout bounds. */
  strokesIncludedInLayout?: boolean
  clipsContent: boolean
  children: FigmaCapturedNode[]
}

export interface FigmaCapturedRect extends FigmaCapturedNodeBase {
  type: 'RECTANGLE'
}

export interface FigmaCapturedEllipse extends FigmaCapturedNodeBase {
  type: 'ELLIPSE'
  arcData?: {
    startingAngle: number
    endingAngle: number
    innerRadius: number
  }
}

export interface FigmaCapturedText extends FigmaCapturedNodeBase {
  type: 'TEXT'
  characters: string
  fontFamily: string
  fontWeight: number
  fontStyle: 'normal' | 'italic'
  fontSize: number
  /** In pixels, after Figma's auto/percent resolution. */
  lineHeightPx: number
  /** In pixels, after Figma's auto/percent resolution. */
  letterSpacingPx: number
  textAlignHorizontal: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
  textAlignVertical: 'TOP' | 'CENTER' | 'BOTTOM'
  /** Text transforms are presentation metadata; `characters` stays unchanged. */
  textCase?:
    | 'ORIGINAL'
    | 'UPPER'
    | 'LOWER'
    | 'TITLE'
    | 'SMALL_CAPS'
    | 'SMALL_CAPS_FORCED'
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH'
  textAutoResize: 'NONE' | 'HEIGHT' | 'WIDTH_AND_HEIGHT'
  /**
   * Modern auto-layout sizing — populated by recent plugin captures
   * when the text sits inside an auto-layout parent. 'FILL' means
   * "stretch to my parent's width"; 'HUG' means "size to my content";
   * 'FIXED' means "use the captured pixel width". Preferred over
   * `textAutoResize`, which doesn't expose FILL and so caused FILL
   * text to import as HUG and overflow the parent.
   */
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL'
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL'
}

export interface FigmaCapturedVector extends FigmaCapturedNodeBase {
  type: 'VECTOR'
  /** The Figma layer kind before it was normalized to a vector payload. */
  sourceKind?:
    | 'VECTOR'
    | 'STAR'
    | 'POLYGON'
    | 'BOOLEAN_OPERATION'
    | 'LINE'
    | 'ELLIPSE'
  /** Sanitized SVG retained as a visual-fidelity and forward-compat fallback. */
  svg: string
  /** Intrinsic coordinate system parsed from the Figma SVG export. */
  viewBox?: FigmaVectorViewBox
  /** Simple path representation, sufficient for most editable Figma vectors. */
  vectorPaths?: FigmaCapturedVectorPath[]
  /** Figma's complete graph representation, including branching paths/regions. */
  vectorNetwork?: FigmaCapturedVectorNetwork
  /** Resolved fill outline used by shapes that do not expose vectorNetwork. */
  fillGeometry?: FigmaCapturedVectorPath[]
  /** Resolved centre-line stroke outline, kept separately from fill geometry. */
  strokeGeometry?: FigmaCapturedVectorPath[]
  /** Friendly generator data retained for inspector controls. */
  primitive?: FigmaVectorPrimitive
  /** Whether Hyper Motion can make the payload fully editable without fallback. */
  fidelity?: 'editable' | 'partial' | 'preserved'
  unsupported?: string[]
  /** Exact Figma metadata retained for future variable-width rendering. */
  variableWidthStroke?: unknown
  /** Exact brush/dynamic stroke metadata retained with the SVG fallback. */
  complexStroke?: unknown
  /**
   * Base64 PNG fallback exported by the Figma plugin. Used when SVG
   * export is blank, collapsed, or a vector-only group is safer to
   * preserve as an exact raster image.
   */
  rasterPng?: string
  /** User-facing explanation shown when the fallback image is selected. */
  rasterReason?: string
}

export interface FigmaVectorViewBox {
  x: number
  y: number
  width: number
  height: number
}

export interface FigmaCapturedVectorPath {
  windingRule: 'NONZERO' | 'EVENODD' | 'NONE'
  data: string
}

export interface FigmaCapturedVectorVertex {
  x: number
  y: number
  strokeCap?: FigmaStrokeCap
  strokeJoin?: FigmaStrokeJoin
  cornerRadius?: number
  handleMirroring?: 'NONE' | 'ANGLE' | 'ANGLE_AND_LENGTH'
}

export interface FigmaCapturedVectorSegment {
  start: number
  end: number
  tangentStart?: { x: number; y: number }
  tangentEnd?: { x: number; y: number }
}

export interface FigmaCapturedVectorRegion {
  windingRule: 'NONZERO' | 'EVENODD'
  loops: number[][]
  fills?: FigmaCapturedFill[]
  fillStyleId?: string
}

export interface FigmaCapturedVectorNetwork {
  vertices: FigmaCapturedVectorVertex[]
  segments: FigmaCapturedVectorSegment[]
  regions: FigmaCapturedVectorRegion[]
}

export type FigmaVectorPrimitive =
  | { kind: 'star'; pointCount: number; innerRadius: number; cornerRadius: number }
  | { kind: 'polygon'; pointCount: number; cornerRadius: number }
  | { kind: 'ellipse'; startAngle: number; endAngle: number; innerRadius: number }
  | { kind: 'line' }
  | { kind: 'boolean'; operation: 'UNION' | 'INTERSECT' | 'SUBTRACT' | 'EXCLUDE' }

export type FigmaCapturedEffect =
  | {
      type: 'DROP_SHADOW' | 'INNER_SHADOW'
      visible: boolean
      color: { r: number; g: number; b: number; a: number }
      offset: { x: number; y: number }
      radius: number
      spread: number
    }
  | {
      type: 'LAYER_BLUR'
      visible: boolean
      radius: number
    }

// ---------------------------------------------------------------------------
// Fills — narrowed Figma `Paint` shape.
// ---------------------------------------------------------------------------

export type FigmaCapturedFill =
  | FigmaSolidFill
  | FigmaGradientFill
  | FigmaImageFill

export interface FigmaSolidFill {
  type: 'SOLID'
  /** sRGB 0..1. */
  color: { r: number; g: number; b: number }
  /** 0..1; multiplied with the node's own opacity at render time. */
  opacity: number
  visible: boolean
  blendMode?: FigmaBlendMode
}

export interface FigmaGradientFill {
  type:
    | 'GRADIENT_LINEAR'
    | 'GRADIENT_RADIAL'
    | 'GRADIENT_ANGULAR'
    | 'GRADIENT_DIAMOND'
  /**
   * Three handle positions defining gradient orientation. Coordinates
   * are 0..1 relative to the node's bounding box.
   */
  gradientHandlePositions: Array<{ x: number; y: number }>
  /** Raw layer-UV to gradient-space matrix; handles are retained for v1 clients. */
  gradientTransform?: FigmaTransform
  gradientStops: Array<{ position: number; color: { r: number; g: number; b: number; a: number } }>
  opacity: number
  visible: boolean
  blendMode?: FigmaBlendMode
}

export interface FigmaImageFill {
  type: 'IMAGE'
  /** Lookup key into payload.assets. */
  imageHash: string
  scaleMode: 'FILL' | 'FIT' | 'TILE' | 'CROP' | 'STRETCH'
  opacity: number
  visible: boolean
  blendMode?: FigmaBlendMode
  imageTransform?: FigmaTransform
  scalingFactor?: number
  rotation?: number
  filters?: {
    exposure?: number
    contrast?: number
    saturation?: number
    temperature?: number
    tint?: number
    highlights?: number
    shadows?: number
  }
}

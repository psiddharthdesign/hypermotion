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
export const FIGMA_PAYLOAD_VERSION = 1 as const

export interface FigmaPayload {
  format: typeof FIGMA_PAYLOAD_FORMAT
  version: typeof FIGMA_PAYLOAD_VERSION
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
  /**
   * Figma's per-child "Absolute position" flag inside auto-layout /
   * flow parents. Missing on older plugin payloads.
   */
  layoutPositioning?: 'AUTO' | 'ABSOLUTE'
  /** Per-corner radii [tl, tr, br, bl]. */
  cornerRadius: [number, number, number, number]
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
  /** Figma layer blend mode. Missing on older plugin payloads. */
  blendMode?: FigmaBlendMode
  effects?: FigmaCapturedEffect[]
}

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

/**
 * Vector / boolean / star / polygon nodes get rasterized to SVG by the
 * plugin (via node.exportAsync({ format: 'SVG_STRING' })) and round-trip
 * as a single image fill. Cleaner than translating path commands; gets
 * users a faithful render until we add a real SVG node type.
 */
export interface FigmaCapturedVector extends FigmaCapturedNodeBase {
  type: 'VECTOR'
  /** Inline SVG markup, ready to embed via data URL. */
  svg: string
  /**
   * Base64 PNG fallback exported by the Figma plugin. Used when SVG
   * export is blank, collapsed, or a vector-only group is safer to
   * preserve as an exact raster image.
   */
  rasterPng?: string
  /** User-facing explanation shown when the fallback image is selected. */
  rasterReason?: string
}

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
  gradientStops: Array<{ position: number; color: { r: number; g: number; b: number; a: number } }>
  opacity: number
  visible: boolean
}

export interface FigmaImageFill {
  type: 'IMAGE'
  /** Lookup key into payload.assets. */
  imageHash: string
  scaleMode: 'FILL' | 'FIT' | 'TILE' | 'CROP' | 'STRETCH'
  opacity: number
  visible: boolean
}

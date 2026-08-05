// SPDX-License-Identifier: Apache-2.0

import type {
  Layout,
  Size,
  SizeAxis,
  Transform,
  VectorMatrix,
} from '@/scene'
import type { FigmaCapturedFrame, FigmaCapturedNode } from './types'

/**
 * Map a Figma frame's auto-layout fields to our `Layout` shape.
 *
 * Figma's `layoutMode` is the master switch. `'NONE'` means free
 * canvas (children pinned by transform), the others map to flex/grid.
 *
 * Padding, gap, alignment all carry across cleanly because Figma's
 * vocabulary was designed alongside Yoga's flexbox — same names with
 * minor renames.
 */
export function figmaToLayout(node: FigmaCapturedFrame): Layout {
  const mode: Layout['mode'] =
    node.layoutMode === 'HORIZONTAL'
      ? 'flex'
      : node.layoutMode === 'VERTICAL'
        ? 'flex'
        : node.layoutMode === 'GRID'
          ? 'grid'
          : 'none'
  const direction: Layout['direction'] =
    node.layoutMode === 'VERTICAL' ? 'column' : 'row'
  const justify: Layout['justify'] =
    node.primaryAxisAlignItems === 'MIN'
      ? 'start'
      : node.primaryAxisAlignItems === 'MAX'
        ? 'end'
        : node.primaryAxisAlignItems === 'CENTER'
          ? 'center'
          : 'space-between'
  const align: Layout['align'] =
    node.counterAxisAlignItems === 'MIN'
      ? 'start'
      : node.counterAxisAlignItems === 'MAX'
        ? 'end'
        : node.counterAxisAlignItems === 'CENTER'
          ? 'center'
          : 'baseline'
  return {
    mode,
    direction,
    justify,
    align,
    gap: node.itemSpacing ?? 0,
    padding: {
      top: node.paddingTop ?? 0,
      right: node.paddingRight ?? 0,
      bottom: node.paddingBottom ?? 0,
      left: node.paddingLeft ?? 0,
    },
    wrap: node.layoutWrap === 'WRAP',
    // Modern plugin captures carry Figma's real GRID dimensions and
    // independent gutters. Older payloads did not; one column is the
    // only lossless fallback because it never invents horizontal slots.
    columns: Math.max(1, Math.floor(node.gridColumnCount ?? 1)),
    rowGap: node.gridRowGap ?? node.itemSpacing ?? 0,
    columnGap: node.gridColumnGap ?? node.itemSpacing ?? 0,
  }
}

/**
 * Map Figma's sizing fields to our `Size` shape.
 *
 * Modern Figma exposes `layoutSizingHorizontal/Vertical` with explicit
 * `'FIXED' | 'HUG' | 'FILL'` values — preferred. Older captures only
 * have `primaryAxisSizingMode` / `counterAxisSizingMode` (`'FIXED' |
 * 'AUTO'`); fall back to those, treating AUTO as hug.
 *
 * `forceFixed` overrides everything and returns pixel sizing on both
 * axes. We use it for IMPORT-ROOT frames: the user copies a single
 * frame from Figma whose original parent applied FILL/HUG, but on the
 * Hyper Motion side the import lands inside the scene root (mode='none'
 * — free canvas). FILL on a free-canvas parent collapses to 0; HUG with
 * no children flows shrinks to 0. Either way the imported frame becomes
 * invisible. Forcing pixel sizing at the root preserves the design's
 * actual dimensions, while children inside keep their original FILL/HUG
 * because their parent (the imported frame) has Figma-style auto-layout.
 *
 * Text nodes additionally have the legacy `textAutoResize` field. Modern
 * layoutSizing values win when present; older captures map auto-width to
 * HUG/HUG and auto-height to FIXED/HUG instead of freezing a content-sized
 * text box at stale captured pixels.
 */
export function figmaToSize(
  node: FigmaCapturedNode,
  forceFixed: boolean = false,
): Size {
  if (node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
    const frame = node as FigmaCapturedFrame
    const horizontalIsPrimary = frame.layoutMode === 'HORIZONTAL'
    const horiz = sizeAxisFromFrame(
      frame.layoutSizingHorizontal,
      horizontalIsPrimary
        ? frame.primaryAxisSizingMode
        : frame.counterAxisSizingMode,
      frame.width,
      forceFixed,
    )
    const vert = sizeAxisFromFrame(
      frame.layoutSizingVertical,
      horizontalIsPrimary
        ? frame.counterAxisSizingMode
        : frame.primaryAxisSizingMode,
      frame.height,
      forceFixed,
    )
    return { width: horiz, height: vert }
  }
  if (node.type === 'TEXT') {
    return {
      width: sizeAxisFromText(
        node.layoutSizingHorizontal,
        node.textAutoResize,
        'horizontal',
        node.width,
        forceFixed,
      ),
      height: sizeAxisFromText(
        node.layoutSizingVertical,
        node.textAutoResize,
        'vertical',
        node.height,
        forceFixed,
      ),
    }
  }
  // Payload v2 captures explicit sizing for every auto-layout child, not only
  // frames. This is particularly important for imported SVG icons: a FILL
  // vector must remain responsive and a HUG vector uses its intrinsic viewBox.
  return {
    width: sizeAxisFromCapturedNode(
      node.layoutSizingHorizontal,
      node.width,
      forceFixed,
    ),
    height: sizeAxisFromCapturedNode(
      node.layoutSizingVertical,
      node.height,
      forceFixed,
    ),
  }
}

function sizeAxisFromText(
  modern: 'FIXED' | 'HUG' | 'FILL' | undefined,
  legacy: 'NONE' | 'HEIGHT' | 'WIDTH_AND_HEIGHT',
  axis: 'horizontal' | 'vertical',
  px: number,
  forceFixed: boolean,
): SizeAxis {
  if (forceFixed) return px
  if (modern) return sizeAxisFromCapturedNode(modern, px, false)
  if (legacy === 'WIDTH_AND_HEIGHT') return 'hug'
  if (legacy === 'HEIGHT' && axis === 'vertical') return 'hug'
  return px
}

function sizeAxisFromCapturedNode(
  sizing: 'FIXED' | 'HUG' | 'FILL' | undefined,
  px: number,
  forceFixed: boolean,
): SizeAxis {
  if (forceFixed || !sizing || sizing === 'FIXED') return px
  return sizing === 'HUG' ? 'hug' : 'fill'
}

function sizeAxisFromFrame(
  modern: 'FIXED' | 'HUG' | 'FILL' | undefined,
  fallback: 'FIXED' | 'AUTO' | undefined,
  px: number,
  forceFixed: boolean,
): SizeAxis {
  if (forceFixed) return px
  if (modern) {
    if (modern === 'HUG') return 'hug'
    if (modern === 'FILL') return 'fill'
    return px
  }
  // Fallback path. The caller has already selected primary/counter for
  // this physical axis. AUTO means hug; FIXED means px.
  if (fallback === 'AUTO') return 'hug'
  return px
}

/**
 * Build a Transform for a captured node.
 *
 * CRITICAL: under an auto-layout parent (parent.layoutMode !== 'NONE')
 * the transform must be IDENTITY for normal flow children. Yoga will
 * recompute the position from the layout properties; storing both
 * Yoga's solved position and a captured x/y produces a ghost-position
 * bug — the node renders doubled-up because it gets the layout slot AND
 * the transform offset.
 *
 * Exception: Figma also has a per-child "Absolute position" flag
 * (`layoutPositioning === 'ABSOLUTE'`). Those children opt out of the
 * parent's layout and their captured x/y is the source of truth.
 *
 * Under a free-canvas parent (layoutMode === 'NONE'), the captured
 * x/y/rotation become the transform.
 */
export function figmaToTransform(
  node: FigmaCapturedNode,
  parentLayoutMode:
    | 'NONE'
    | 'HORIZONTAL'
    | 'VERTICAL'
    | 'GRID'
    | null
    | undefined,
): Transform {
  const inAutoLayout =
    parentLayoutMode === 'HORIZONTAL' ||
    parentLayoutMode === 'VERTICAL' ||
    parentLayoutMode === 'GRID'
  const absoluteInParent = node.layoutPositioning === 'ABSOLUTE'
  const capturedX = node.relativeTransform?.[0][2] ?? node.x
  const capturedY = node.relativeTransform?.[1][2] ?? node.y
  if (inAutoLayout && !absoluteInParent) {
    return {
      x: 0,
      y: 0,
      z: 0,
      // Yoga owns flow x/y, but rotation remains a visual transform and
      // must not be erased. Rotated badges and labels otherwise flatten.
      rotation: node.rotation,
      rotationX: 0,
      rotationY: 0,
      scaleX: 1,
      scaleY: 1,
    }
  }
  return {
    x: capturedX,
    y: capturedY,
    z: 0,
    rotation: node.rotation,
    rotationX: 0,
    rotationY: 0,
    scaleX: 1,
    scaleY: 1,
  }
}

/**
 * Split a Figma vector transform into layer translation and item-local affine.
 *
 * The generic scene transform can express rotation/scale but not skew. Native
 * vector items can express the complete matrix, so payload-v2 vectors keep the
 * linear 2×2 part there and the layer owns translation only. This also avoids
 * applying Figma rotation twice (once as a layer rotation and once in SVG).
 */
export function figmaVectorAffine(
  node: FigmaCapturedNode,
  layerTransform: Transform,
): { layerTransform: Transform; itemTransform: VectorMatrix } {
  const matrix = node.relativeTransform
  if (!matrix) {
    return {
      layerTransform,
      itemTransform: [1, 0, 0, 1, 0, 0],
    }
  }
  return {
    layerTransform: {
      ...layerTransform,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
    itemTransform: figmaVectorItemTransform(node),
  }
}

export function figmaVectorItemTransform(
  node: FigmaCapturedNode,
): VectorMatrix {
  const matrix = node.relativeTransform
  if (!matrix) return [1, 0, 0, 1, 0, 0]
  return [
    normalizedZero(matrix[0][0]),
    normalizedZero(matrix[1][0]),
    normalizedZero(matrix[0][1]),
    normalizedZero(matrix[1][1]),
    0,
    0,
  ]
}

function normalizedZero(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value
}

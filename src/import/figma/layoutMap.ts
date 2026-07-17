// SPDX-License-Identifier: Apache-2.0

import type { Layout, Size, SizeAxis, Transform } from '@/scene'
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
 * For non-frame nodes (rect/ellipse/text/vector), we don't have these
 * fields at all, so the size is always fixed = the captured width/height.
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
  return { width: node.width, height: node.height }
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
  parentLayoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID' | null,
): Transform {
  const inAutoLayout = parentLayoutMode !== null && parentLayoutMode !== 'NONE'
  const absoluteInParent = node.layoutPositioning === 'ABSOLUTE'
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
    x: node.x,
    y: node.y,
    z: 0,
    rotation: node.rotation,
    rotationX: 0,
    rotationY: 0,
    scaleX: 1,
    scaleY: 1,
  }
}

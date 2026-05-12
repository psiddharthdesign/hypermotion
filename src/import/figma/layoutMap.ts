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
    // Grid columns aren't carried in older Figma data — Figma's GRID
    // layoutMode shipped recently. For MVP we default to a 3-column
    // grid; users can adjust in the Inspector after import.
    columns: 3,
    rowGap: node.itemSpacing ?? 0,
    columnGap: node.itemSpacing ?? 0,
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
    const horiz = sizeAxisFromFrame(
      frame.layoutSizingHorizontal,
      frame.primaryAxisSizingMode,
      frame.layoutMode === 'HORIZONTAL',
      frame.width,
      forceFixed,
    )
    const vert = sizeAxisFromFrame(
      frame.layoutSizingVertical,
      frame.counterAxisSizingMode,
      frame.layoutMode === 'HORIZONTAL',
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
  // True when this axis is the primary axis. In Figma, primaryAxisSizingMode
  // applies to the layout's main axis (HORIZONTAL → x, VERTICAL → y).
  // We honor that mapping when falling back to the older fields.
  isPrimary: boolean,
  px: number,
  forceFixed: boolean,
): SizeAxis {
  if (forceFixed) return px
  if (modern) {
    if (modern === 'HUG') return 'hug'
    if (modern === 'FILL') return 'fill'
    return px
  }
  // Fallback path. We only get one of the two old fields per axis; the
  // caller picks which one is "the" mode for this axis based on
  // layoutMode. AUTO means hug; FIXED means px.
  void isPrimary
  if (fallback === 'AUTO') return 'hug'
  return px
}

/**
 * Build a Transform for a captured node.
 *
 * CRITICAL: under an auto-layout parent (parent.layoutMode !== 'NONE')
 * the transform must be IDENTITY. Yoga will recompute the position from
 * the layout properties; storing both Yoga's solved position and a
 * captured x/y produces a ghost-position bug — the node renders
 * doubled-up because it gets the layout slot AND the transform offset.
 *
 * Under a free-canvas parent (layoutMode === 'NONE'), the captured
 * x/y/rotation become the transform.
 */
export function figmaToTransform(
  node: FigmaCapturedNode,
  parentLayoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID' | null,
): Transform {
  const inAutoLayout = parentLayoutMode !== null && parentLayoutMode !== 'NONE'
  if (inAutoLayout) {
    return {
      x: 0,
      y: 0,
      z: 0,
      rotation: 0,
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
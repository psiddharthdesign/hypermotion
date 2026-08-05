// SPDX-License-Identifier: Apache-2.0

import { getSvgPath } from 'figma-squircle'

export interface CornerRadiiLike {
  tl: number
  tr: number
  br: number
  bl: number
}

export interface CornerShapePathOptions {
  width: number
  height: number
  cornerRadius: number
  cornerRadii?: CornerRadiiLike
  cornerSmoothing?: unknown
  /**
   * Move the path inward while keeping the curve approximately concentric.
   * Canvas strokes use this to keep their outer edge on the authored bounds.
   */
  inset?: number
}

/** Clamp persisted/imported smoothing values to Figma's supported 0..1 range. */
export function normalizeCornerSmoothing(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

/**
 * Return whether a rounded rectangle needs the continuous-corner path.
 *
 * A per-corner rectangle also uses the shared path because Canvas2D's current
 * quadratic fast path only supports one uniform radius.
 */
export function needsCornerShapePath(
  cornerSmoothing: unknown,
  cornerRadii?: CornerRadiiLike,
): boolean {
  return normalizeCornerSmoothing(cornerSmoothing) > 0 || cornerRadii !== undefined
}

function finiteDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function finiteRadius(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value)
}

function fitCornerRadii(
  radii: CornerRadiiLike,
  width: number,
  height: number,
): CornerRadiiLike {
  const ratios = [
    radii.tl + radii.tr > 0 ? width / (radii.tl + radii.tr) : 1,
    radii.bl + radii.br > 0 ? width / (radii.bl + radii.br) : 1,
    radii.tl + radii.bl > 0 ? height / (radii.tl + radii.bl) : 1,
    radii.tr + radii.br > 0 ? height / (radii.tr + radii.br) : 1,
  ]
  const scale = Math.max(0, Math.min(1, ...ratios))
  return {
    tl: radii.tl * scale,
    tr: radii.tr * scale,
    br: radii.br * scale,
    bl: radii.bl * scale,
  }
}

/**
 * Build the canonical SVG path used by both clipping and strokes.
 *
 * Callers deliberately keep their old quadratic path when smoothing is zero
 * and radii are uniform. That preserves the hot-path behavior for existing
 * documents while this function handles continuous and per-corner curves.
 */
export function cornerShapePath({
  width,
  height,
  cornerRadius,
  cornerRadii,
  cornerSmoothing,
  inset = 0,
}: CornerShapePathOptions): string {
  const safeInset = Number.isFinite(inset) ? inset : 0
  const innerWidth = finiteDimension(width - safeInset * 2)
  const innerHeight = finiteDimension(height - safeInset * 2)
  const smoothing = normalizeCornerSmoothing(cornerSmoothing)
  const insetRadius = (value: number) => finiteRadius(value - safeInset)

  const radii = (() => {
    if (!cornerRadii) {
      return {
        cornerRadius: Math.min(
          insetRadius(cornerRadius),
          innerWidth / 2,
          innerHeight / 2,
        ),
      }
    }
    const fitted = fitCornerRadii(
      {
        tl: insetRadius(cornerRadii.tl),
        tr: insetRadius(cornerRadii.tr),
        br: insetRadius(cornerRadii.br),
        bl: insetRadius(cornerRadii.bl),
      },
      innerWidth,
      innerHeight,
    )
    return {
      topLeftCornerRadius: fitted.tl,
      topRightCornerRadius: fitted.tr,
      bottomRightCornerRadius: fitted.br,
      bottomLeftCornerRadius: fitted.bl,
    }
  })()

  return getSvgPath({
    width: innerWidth,
    height: innerHeight,
    cornerSmoothing: smoothing,
    preserveSmoothing: false,
    ...radii,
  })
}

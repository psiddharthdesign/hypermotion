// SPDX-License-Identifier: Apache-2.0

/**
 * A text segment's authored motion, expressed in local line-height units.
 * Positive X moves right, positive Y moves down, and positive Z moves toward
 * the viewer. Keeping this renderer-agnostic lets the DOM and Three paths
 * share the same motion distance while choosing their own projection strategy.
 */
export interface TextMotionVector {
  x: number
  y: number
  z: number
}

/**
 * Resolve an optional normalized motion vector into local render units.
 * `amount` is the segment-local animation amount (normally 1 -> 0 for an
 * entrance and 0 -> 1 for an exit). A missing vector deliberately stays null
 * so callers can preserve the legacy direction/travel behavior exactly.
 */
export function resolveTextMotionVector(
  vector: TextMotionVector | null | undefined,
  lineHeight: number,
  amount: number,
): TextMotionVector | null {
  if (vector == null) return null
  const scale = lineHeight * amount
  if (scale === 0) return { x: 0, y: 0, z: 0 }
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  }
}

/**
 * Choose a stable DOM perspective for line-height-normalized Z motion.
 * The inspector currently permits up to +10 line heights. Keeping that
 * maximum at no more than half the perspective distance prevents the CSS
 * projection singularity while retaining the established 1000px perspective
 * for ordinary text sizes.
 */
export function textMotionPerspectiveDistance(
  lineHeight: number,
  maxPositiveZ = 10,
): number {
  const safeLineHeight = Number.isFinite(lineHeight)
    ? Math.max(0, lineHeight)
    : 0
  const safeMaxPositiveZ = Number.isFinite(maxPositiveZ)
    ? Math.max(0, maxPositiveZ)
    : 0
  return Math.max(1000, safeLineHeight * safeMaxPositiveZ * 2)
}

// SPDX-License-Identifier: Apache-2.0

import type { MeasureFunction, Yoga } from 'yoga-layout/load'
import type { VectorNode } from '@/scene/types'

/**
 * Give Yoga an intrinsic size for native vectors. The viewBox is the stable
 * source of truth: imported SVGs therefore behave like images in Hug mode,
 * while fixed/fill axes continue to be owned by the parent layout.
 */
export function makeVectorMeasure(yoga: Yoga, node: VectorNode): MeasureFunction {
  return (width, widthMode, height, heightMode) => {
    const naturalWidth = positive(node.viewBox.width, 1)
    const naturalHeight = positive(node.viewBox.height, 1)
    const ratio = naturalWidth / naturalHeight

    const widthIsExact = widthMode === yoga.MEASURE_MODE_EXACTLY
    const heightIsExact = heightMode === yoga.MEASURE_MODE_EXACTLY
    let measuredWidth = widthIsExact ? positive(width, naturalWidth) : naturalWidth
    let measuredHeight = heightIsExact ? positive(height, naturalHeight) : naturalHeight

    // When just one axis is fixed, preserve the SVG's intrinsic aspect ratio
    // for the Hug axis. Users can still opt into stretching by fixing both.
    if (widthIsExact && !heightIsExact) measuredHeight = measuredWidth / ratio
    else if (heightIsExact && !widthIsExact) measuredWidth = measuredHeight * ratio

    if (widthMode === yoga.MEASURE_MODE_AT_MOST && measuredWidth > width) {
      const scale = positive(width, measuredWidth) / measuredWidth
      measuredWidth *= scale
      if (!heightIsExact) measuredHeight *= scale
    }
    if (heightMode === yoga.MEASURE_MODE_AT_MOST && measuredHeight > height) {
      const scale = positive(height, measuredHeight) / measuredHeight
      measuredHeight *= scale
      if (!widthIsExact) measuredWidth *= scale
    }

    return {
      width: Math.max(1, measuredWidth),
      height: Math.max(1, measuredHeight),
    }
  }
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

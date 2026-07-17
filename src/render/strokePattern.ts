// SPDX-License-Identifier: Apache-2.0

import type { Stroke } from '@/scene'

export interface StrokePattern {
  dash: number[]
  lineCap: CanvasLineCap
}

/** Normalize the scene stroke model into the pattern Canvas2D expects. */
export function strokePattern(stroke: Stroke): StrokePattern {
  if (stroke.style === 'dotted') {
    return {
      dash: [0, Math.max(1, stroke.width * 2)],
      lineCap: 'round',
    }
  }
  if (stroke.style === 'dashed') {
    return {
      dash: [
        Math.max(0, stroke.dashLength ?? 6),
        Math.max(0, stroke.dashGap ?? 4),
      ],
      lineCap: 'butt',
    }
  }
  return { dash: [], lineCap: 'butt' }
}

export function applyCanvasStrokePattern(
  context: CanvasRenderingContext2D,
  stroke: Stroke,
): void {
  const pattern = strokePattern(stroke)
  context.setLineDash(pattern.dash)
  context.lineCap = pattern.lineCap
}

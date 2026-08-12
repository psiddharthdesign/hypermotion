// SPDX-License-Identifier: Apache-2.0

export interface MasterTimelineRevealInput {
  time: number
  pixelsPerSecond: number
  scrollLeft: number
  clientWidth: number
  scrollWidth: number
  padding?: number
}

/**
 * Return the horizontal viewport position that keeps an exact Master time
 * visible without moving a viewport that already contains it.
 */
export function masterTimelineRevealScrollLeft({
  time,
  pixelsPerSecond,
  scrollLeft,
  clientWidth,
  scrollWidth,
  padding = 32,
}: MasterTimelineRevealInput): number {
  const safePixelsPerSecond = Math.max(1, finiteOr(pixelsPerSecond, 1))
  const safeClientWidth = Math.max(0, finiteOr(clientWidth, 0))
  const safeScrollWidth = Math.max(safeClientWidth, finiteOr(scrollWidth, 0))
  const maxScrollLeft = Math.max(0, safeScrollWidth - safeClientWidth)
  const current = clamp(finiteOr(scrollLeft, 0), 0, maxScrollLeft)
  if (safeClientWidth <= 0) return current

  const safePadding = clamp(
    finiteOr(padding, 0),
    0,
    Math.max(0, safeClientWidth / 2),
  )
  const x = Math.max(0, finiteOr(time, 0)) * safePixelsPerSecond
  const visibleStart = current + safePadding
  const visibleEnd = current + safeClientWidth - safePadding

  if (x < visibleStart) return clamp(x - safePadding, 0, maxScrollLeft)
  if (x > visibleEnd) {
    return clamp(x - safeClientWidth + safePadding, 0, maxScrollLeft)
  }
  return current
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// SPDX-License-Identifier: Apache-2.0

import type { TextAnimationMode } from './textAnimations'

/**
 * Alpha fallback for Color Fade when glyph paint is supplied by a clipped
 * background. In that case CSS `color` is intentionally transparent, so the
 * effect needs an opacity channel to remain visible and match WebGL/export.
 */
export function textColorFadePaint(
  mode: TextAnimationMode,
  progress: number,
): { opacity: number; color: string } {
  const resolved = Math.max(
    0,
    Math.min(1, Number.isFinite(progress) ? progress : 0),
  )
  const visible = mode === 'out' ? 1 - resolved : resolved
  return {
    opacity: visible,
    color: `color-mix(in oklab, currentColor ${Math.round(visible * 100)}%, transparent)`,
  }
}

// SPDX-License-Identifier: Apache-2.0

import type { PreviewScope, WorkAreaRange } from '@/state/ui'

const MIN_PREVIEW_DURATION = 0.1

/**
 * Preview has two clocks. Scene follows the active composition, while Master
 * must stay on the complete sequence even as playback activates each scene.
 */
export function previewDurationForScope(
  scope: PreviewScope,
  sceneDuration: number,
  sequenceDuration: number,
): number {
  return Math.max(
    MIN_PREVIEW_DURATION,
    scope === 'sequence' ? sequenceDuration : sceneDuration,
  )
}

/** Scene work areas are local authoring data and must never clip Master. */
export function previewWorkAreaForScope(
  scope: PreviewScope,
  sceneWorkArea: WorkAreaRange | null,
  duration: number,
): WorkAreaRange {
  if (scope === 'scene' && sceneWorkArea) return sceneWorkArea
  return { start: 0, end: duration }
}

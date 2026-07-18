// SPDX-License-Identifier: Apache-2.0

import type { CameraNode } from '@/scene'

/**
 * The canvas export fallback can reproduce screen/point focus with a radial
 * sharp mask. Plane and target focus require scene depth, which this fallback
 * does not have, and must never be approximated as a point-shaped mask.
 */
export function shouldUseRadialExportFocusMask(
  mode: CameraNode['focusMode'],
): boolean {
  return mode === 'screen'
}

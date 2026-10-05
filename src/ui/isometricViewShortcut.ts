// SPDX-License-Identifier: Apache-2.0

import { ISOMETRIC_CAMERA_VIEWS, type IsometricCameraViewId } from '@/scene/cameraProjection'

/** Physical digit keys also work on macOS, where Option changes event.key. */
export function isometricViewForShortcut(event: Pick<KeyboardEvent, 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'repeat'>): IsometricCameraViewId | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return null
  const match = /^Digit([1-4])$/.exec(event.code)
  return match ? ISOMETRIC_CAMERA_VIEWS[Number(match[1]) - 1].id : null
}

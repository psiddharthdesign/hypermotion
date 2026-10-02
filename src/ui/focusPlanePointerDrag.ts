// SPDX-License-Identifier: Apache-2.0

import type { Vec3 } from '@/render3d/math'
import type { ResolvedCamera3D, ViewportSize } from '@/render3d/scene3d'
import { moveFocusPlaneDepth, moveFocusPlaneInView } from './focusPlaneGeometry'

export type FocusPlaneMoveMode = 'view' | 'depth'

export interface FocusPlanePointerDrag {
  x: number
  y: number
  deltaX: number
  deltaY: number
  mode: FocusPlaneMoveMode
  camera: ResolvedCamera3D
  viewport: ViewportSize
  zoom: number
  start: Vec3
}

/** Weight only new pointer travel so changing Shift never rescales the previous movement. */
export function advanceFocusPlanePointerDrag(
  drag: FocusPlanePointerDrag,
  clientX: number,
  clientY: number,
  shiftKey: boolean,
): Vec3 {
  const sensitivity = (shiftKey ? 10 : 1) / drag.zoom
  drag.deltaX += (clientX - drag.x) * sensitivity
  drag.deltaY += (clientY - drag.y) * sensitivity
  drag.x = clientX
  drag.y = clientY
  // Keep the initial pose as the reference: depth sensitivity must not compound
  // with each packet, or the same gesture would depend on pointer event rate.
  return drag.mode === 'depth'
    ? moveFocusPlaneDepth(drag.camera, drag.viewport, drag.start, drag.deltaY)
    : moveFocusPlaneInView(drag.camera, drag.viewport, drag.start, { x: drag.deltaX, y: drag.deltaY })
}

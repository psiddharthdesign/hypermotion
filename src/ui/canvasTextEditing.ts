// SPDX-License-Identifier: Apache-2.0

export interface CanvasPress {
  time: number
  clientX: number
  clientY: number
}

export function isRepeatedCanvasPress(
  previous: CanvasPress | null,
  current: CanvasPress,
  maxDelayMs = 400,
  maxDistancePx = 6,
): boolean {
  if (!previous) return false
  return (
    current.time - previous.time >= 0 &&
    current.time - previous.time <= maxDelayMs &&
    Math.hypot(
      current.clientX - previous.clientX,
      current.clientY - previous.clientY,
    ) <= maxDistancePx
  )
}

export function canvasTextEditPresentation(
  webglAvailable: boolean,
  editingTextId: string | null,
  geometryPreviewActive = false,
): {
  showDomScene: boolean
  hideWebglScene: boolean
  suspendWebglScene: boolean
  applyDomCameraPostEffects: boolean
} {
  const editing = editingTextId !== null
  const domPreviewActive = editing || geometryPreviewActive
  return {
    showDomScene: !webglAvailable || domPreviewActive,
    hideWebglScene: domPreviewActive,
    // Keep the GPU renderer and its resources mounted for an instant resume,
    // but avoid drawing a scene that the editable DOM layer fully covers.
    suspendWebglScene: domPreviewActive,
    // SVG filters force Chromium to rerasterize the complete DOM scene. Keep
    // them for the true WebGL-failure fallback, but suspend them while the
    // contenteditable scene is live; the post effect returns on edit exit.
    applyDomCameraPostEffects: !webglAvailable && !domPreviewActive,
  }
}

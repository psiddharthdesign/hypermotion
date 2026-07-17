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
): { showDomScene: boolean; hideWebglScene: boolean } {
  const editing = editingTextId !== null
  return {
    showDomScene: !webglAvailable || editing,
    hideWebglScene: editing,
  }
}

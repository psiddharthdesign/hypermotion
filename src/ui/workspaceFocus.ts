// SPDX-License-Identifier: Apache-2.0

import type { WorkspaceView } from '@/state/ui'

export interface WorkspaceBounds {
  x: number
  y: number
  width: number
  height: number
}
interface FitWorkspaceBoundsOptions {
  bounds: WorkspaceBounds[]
  artboardWidth: number
  artboardHeight: number
  viewportWidth: number
  viewportHeight: number
  margin?: number
  maxZoom?: number
}

/**
 * Fit artboard-coordinate bounds into the visible workspace.
 *
 * Canvas.tsx anchors artboard coordinate (0, 0) at
 * (-artboardWidth / 2, -artboardHeight / 2) from the workspace center.
 * The returned pan moves the fitted bounds' center back onto that origin.
 */
export function fitWorkspaceBounds({
  bounds,
  artboardWidth,
  artboardHeight,
  viewportWidth,
  viewportHeight,
  margin = 40,
  maxZoom = 2,
}: FitWorkspaceBoundsOptions): WorkspaceView | null {
  if (bounds.length === 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return null
  }

  const minX = Math.min(...bounds.map((item) => item.x))
  const minY = Math.min(...bounds.map((item) => item.y))
  const maxX = Math.max(...bounds.map((item) => item.x + item.width))
  const maxY = Math.max(...bounds.map((item) => item.y + item.height))
  const contentWidth = Math.max(1, maxX - minX)
  const contentHeight = Math.max(1, maxY - minY)
  const availableWidth = Math.max(1, viewportWidth - margin * 2)
  const availableHeight = Math.max(1, viewportHeight - margin * 2)
  const zoom = Math.max(
    0.05,
    Math.min(maxZoom, availableWidth / contentWidth, availableHeight / contentHeight),
  )
  const centerX = minX + contentWidth / 2
  const centerY = minY + contentHeight / 2

  return {
    zoom,
    panX: (artboardWidth / 2 - centerX) * zoom,
    panY: (artboardHeight / 2 - centerY) * zoom,
  }
}

// SPDX-License-Identifier: Apache-2.0

import { memo, useMemo } from 'react'
import type { CameraCompositionGuide } from '@/scene/cameraCompositionGuide'
import { cameraCompositionGeometry } from './cameraCompositionGeometry'

export const CameraCompositionOverlay = memo(function CameraCompositionOverlay({ guide, width, height, zoom, guideStrength = 0.14, gridSpacingScale = 1 }: {
  guide: CameraCompositionGuide
  width: number
  height: number
  zoom: number
  guideStrength?: number
  gridSpacingScale?: number
}) {
  const path = useMemo(() => cameraCompositionGeometry(guide, width, height, gridSpacingScale)
    .map(line => `M ${line.x1} ${line.y1} L ${line.x2} ${line.y2}`).join(' '), [guide, width, height, gridSpacingScale])
  if (!path) return null
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1

  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
    data-camera-composition-guide={guide} data-export-hide="1" aria-hidden="true" focusable="false"
    style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
    <path d={path} fill="none" stroke="#536579" strokeOpacity={Math.min(0.5, Math.max(0, guideStrength))} strokeWidth={1 / safeZoom} />
  </svg>
})

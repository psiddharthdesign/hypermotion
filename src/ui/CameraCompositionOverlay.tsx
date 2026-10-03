// SPDX-License-Identifier: Apache-2.0

import { memo, useMemo } from 'react'
import type { CameraCompositionGuide } from '@/scene/cameraCompositionGuide'
import { cameraCompositionGeometry } from './cameraCompositionGeometry'

export const CameraCompositionOverlay = memo(function CameraCompositionOverlay({ guide, width, height, zoom }: {
  guide: CameraCompositionGuide
  width: number
  height: number
  zoom: number
}) {
  const path = useMemo(() => cameraCompositionGeometry(guide, width, height)
    .map(line => `M ${line.x1} ${line.y1} L ${line.x2} ${line.y2}`).join(' '), [guide, width, height])
  if (!path) return null
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1

  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
    data-camera-composition-guide={guide} data-export-hide="1" aria-hidden="true" focusable="false"
    style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
    {/* The darker outline keeps the guide visible on both light and dark content. */}
    <path d={path} fill="none" stroke="#000" strokeOpacity={0.38} strokeWidth={2.5 / safeZoom} />
    <path d={path} fill="none" stroke="#fff" strokeOpacity={0.8} strokeWidth={1 / safeZoom} />
  </svg>
})

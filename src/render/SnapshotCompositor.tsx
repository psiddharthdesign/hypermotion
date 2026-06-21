// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'

export interface SnapshotFocusEffect {
  enabled: boolean
  focusX: number
  focusY: number
  radius: number
  feather: number
  blurPx: number
  iso?: number
}

interface SnapshotCompositorProps {
  width: number
  height: number
  focus?: SnapshotFocusEffect | null
  children: ReactNode
}

/**
 * Snapshot/effects compositor boundary.
 *
 * Today this uses DOM/CSS passes as a live-editor preview. The important
 * architectural point is the boundary: callers render scene content once
 * as `children`, and this component owns the effect passes. The WebGL
 * version can replace each pass with a rasterized texture + shader
 * without changing scene layout, camera controls, or group3d behavior.
 */
export function SnapshotCompositor({
  width,
  height,
  focus,
  children,
}: SnapshotCompositorProps) {
  if (!focus?.enabled || focus.blurPx <= 0.05) return <>{children}</>

  const radius = Math.max(1, focus.radius)
  const feather = Math.max(1, focus.feather)
  const blur = Number(focus.blurPx.toFixed(2))
  const mask =
    `radial-gradient(circle at ${focus.focusX}px ${focus.focusY}px, ` +
    `black 0px, ` +
    `black ${Number(radius.toFixed(2))}px, ` +
    `rgba(0,0,0,0.88) ${Number((radius + feather * 0.18).toFixed(2))}px, ` +
    `rgba(0,0,0,0.4) ${Number((radius + feather * 0.55).toFixed(2))}px, ` +
    `transparent ${Number((radius + feather).toFixed(2))}px)`
  const baseScale = 1 + Math.min(0.035, blur / Math.max(width, height))
  const grainSize = Math.max(2, 900 / Math.max(100, focus.iso ?? 100))
  const isRenderWindow =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('render-window') === '1'
  if (isRenderWindow) return <>{children}</>

  return (
    <div
      className="absolute inset-0"
      data-snapshot-compositor="1"
      data-snapshot-backend="css-preview"
      style={{ width, height }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        data-snapshot-pass="blurred-base"
        style={{
          filter: `blur(${blur}px)`,
          transform: `scale(${Number(baseScale.toFixed(4))}) translateZ(0)`,
          transformOrigin: 'center center',
          willChange: 'filter, transform',
        }}
      >
        {children}
      </div>
      <div
        className="absolute inset-0"
        data-snapshot-pass="sharp-focus-mask"
        style={{
          WebkitMaskImage: mask,
          maskImage: mask,
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          willChange: 'mask-image, -webkit-mask-image',
        }}
      >
        {children}
      </div>
      {(focus.iso ?? 100) > 100 ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.035] mix-blend-multiply"
          data-snapshot-pass="grain"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 30%, #000 0 0.7px, transparent 0.8px), radial-gradient(circle at 70% 60%, #000 0 0.6px, transparent 0.7px)',
            backgroundSize: `${grainSize}px ${grainSize}px`,
          }}
        />
      ) : null}
    </div>
  )
}

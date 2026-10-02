// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { Move, MoveVertical } from 'lucide-react'
import type { CameraNode } from '@/scene'
import type { AnimatedValue } from '@/anim'
import { cameraSpaceDepth, resolveCamera3D } from '@/render3d/scene3d'
import type { Vec3 } from '@/render3d/math'
import { cameraPreviewStore } from './cameraPreviewStore'
import { focusPlaneGuideGeometry, moveFocusPlaneDepth, moveFocusPlaneInView } from './focusPlaneGeometry'
import { advanceFocusPlanePointerDrag, type FocusPlaneMoveMode, type FocusPlanePointerDrag } from './focusPlanePointerDrag'

export type FocusPlanePositionPatch = { focusPlaneX: number; focusPlaneY: number; focusPlaneZ: number }
interface FocusPlaneDrag extends FocusPlanePointerDrag {
  id: number
  cameraId: string
  element: HTMLButtonElement
  latest: Vec3
}

const distanceFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

function patchFor(point: Vec3): FocusPlanePositionPatch {
  return { focusPlaneX: point.x, focusPlaneY: point.y, focusPlaneZ: point.z }
}

function releaseCapture(current: FocusPlaneDrag) {
  if (current.element.hasPointerCapture(current.id)) current.element.releasePointerCapture(current.id)
}

export function FocusPlaneOverlay({ camera, cameraAnim, width, height, zoom, playing = false, onCommit }: {
  camera: CameraNode
  cameraAnim?: AnimatedValue
  width: number
  height: number
  zoom: number
  playing?: boolean
  onCommit: (patch: FocusPlanePositionPatch) => void
}) {
  const drag = useRef<FocusPlaneDrag | null>(null)
  const disabled = camera.locked || playing
  const cancelDrag = useCallback(() => {
    const current = drag.current
    if (!current) return
    drag.current = null
    cameraPreviewStore.clear(current.cameraId)
    releaseCapture(current)
  }, [])
  useEffect(() => cancelDrag, [camera.id, cancelDrag])
  useEffect(() => {
    if (disabled) cancelDrag()
  }, [disabled, cancelDrag])
  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return
      event.preventDefault()
      event.stopPropagation()
      cancelDrag()
    }
    window.addEventListener('keydown', onEscape, true)
    window.addEventListener('blur', cancelDrag)
    return () => {
      window.removeEventListener('keydown', onEscape, true)
      window.removeEventListener('blur', cancelDrag)
    }
  }, [cancelDrag])

  const viewport = { width, height }
  const resolved = resolveCamera3D(camera, cameraAnim, viewport)
  const guide = focusPlaneGuideGeometry(resolved, viewport)
  const safeZoom = Math.max(0.001, zoom)
  const commit = (point: Vec3) => {
    const patch = patchFor(point)
    cameraPreviewStore.set(camera.id, patch)
    try {
      onCommit(patch)
      cameraPreviewStore.finish(camera.id)
    } catch (error) {
      cameraPreviewStore.clear(camera.id)
      throw error
    }
  }
  const start = (event: PointerEvent<HTMLButtonElement>, mode: FocusPlaneMoveMode) => {
    if (event.button !== 0 || disabled || drag.current) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      id: event.pointerId, cameraId: camera.id, element: event.currentTarget,
      x: event.clientX, y: event.clientY, deltaX: 0, deltaY: 0, mode, camera: resolved, viewport, zoom: safeZoom,
      start: { ...resolved.focusWorld }, latest: { ...resolved.focusWorld },
    }
  }
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (disabled) { cancelDrag(); return }
    current.latest = advanceFocusPlanePointerDrag(current, event.clientX, event.clientY, event.shiftKey)
    cameraPreviewStore.set(current.cameraId, patchFor(current.latest))
  }
  const finish = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (cancel || disabled || current.cameraId !== camera.id) { cancelDrag(); return }
    // The release packet can be newer than the last pointermove packet.
    current.latest = advanceFocusPlanePointerDrag(current, event.clientX, event.clientY, event.shiftKey)
    drag.current = null
    try {
      const moved = Math.hypot(current.latest.x - current.start.x, current.latest.y - current.start.y, current.latest.z - current.start.z) > 0.000001
      if (moved) commit(current.latest)
      else cameraPreviewStore.clear(current.cameraId)
    } finally {
      releaseCapture(current)
    }
  }
  const nudge = (event: KeyboardEvent<HTMLButtonElement>, mode: FocusPlaneMoveMode) => {
    const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
    if (!arrows.includes(event.key) || disabled || drag.current) return
    event.preventDefault()
    event.stopPropagation()
    if (mode === 'depth' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return
    const step = (event.shiftKey ? 10 : 1) / safeZoom
    const delta = {
      x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
      y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
    }
    commit(mode === 'depth'
      ? moveFocusPlaneDepth(resolved, viewport, resolved.focusWorld, delta.y)
      : moveFocusPlaneInView(resolved, viewport, resolved.focusWorld, delta))
  }
  if (!guide) return null
  const size = 28 / safeZoom
  const distance = distanceFormatter.format(cameraSpaceDepth(resolved.focusWorld, resolved))
  return <div data-export-hide="1" data-focus-plane-guide="1" className="pointer-events-none absolute overflow-hidden"
    style={{ left: -width / 2, top: -height / 2, width, height }}>
    <svg width={width} height={height} className="absolute inset-0" aria-hidden="true">
      <polygon points={guide.corners.map(p => `${p.x},${p.y}`).join(' ')}
        fill="color-mix(in oklab, var(--color-accent) 5%, transparent)" stroke="var(--color-accent)"
        strokeWidth={1.25 / safeZoom} strokeDasharray={`${6 / safeZoom} ${4 / safeZoom}`} />
    </svg>
    <div className="absolute flex items-center" style={{ left: guide.center.x, top: guide.center.y, transform: 'translate(-50%, -50%)', gap: 4 / safeZoom }}>
      {(['view', 'depth'] as const).map(mode => <button key={mode} type="button"
        title={mode === 'view'
          ? 'Move focus plane across the view. Drag or use arrow keys; hold Shift to move 10× faster. Escape cancels a drag.'
          : 'Move focus plane depth. Drag or press Up to move away, Down to move nearer; hold Shift to move 10× faster. Escape cancels a drag.'}
        aria-label={mode === 'view' ? 'Move focus plane' : 'Move focus plane depth'}
        aria-keyshortcuts={mode === 'view' ? 'ArrowUp ArrowDown ArrowLeft ArrowRight' : 'ArrowUp ArrowDown'}
        disabled={disabled}
        className="pointer-events-auto flex items-center justify-center border border-accent bg-panel text-accent shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        style={{ width: size, height: size, borderRadius: 6 / safeZoom, borderWidth: 1 / safeZoom, cursor: disabled ? 'default' : mode === 'view' ? 'move' : 'ns-resize', touchAction: 'none' }}
        onPointerDown={e => start(e, mode)} onPointerMove={move} onPointerUp={e => finish(e)}
        onPointerCancel={e => finish(e, true)} onLostPointerCapture={e => finish(e, true)}
        onKeyDown={e => nudge(e, mode)}>
        {mode === 'view' ? <Move size={16 / safeZoom} aria-hidden="true" /> : <MoveVertical size={16 / safeZoom} aria-hidden="true" />}
      </button>)}
      <span className="pointer-events-auto whitespace-nowrap rounded bg-panel/90 text-accent"
        title="Distance from camera to plane center along the viewing direction. A tilted plane spans different distances."
        style={{ fontSize: 11 / safeZoom, padding: `${3 / safeZoom}px ${6 / safeZoom}px` }}>Focus plane · {distance} px</span>
    </div>
  </div>
}

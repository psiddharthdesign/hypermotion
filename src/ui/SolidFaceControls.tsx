// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { AnimatedValue } from '@/anim'
import type { Node, SceneAPI } from '@/scene'
import { hitTestPlanes, viewportPointToRay, projectWorldPoint, type Plane3D, type ResolvedCamera3D } from '@/render3d/scene3d'
import { intersectExtrusion } from '@/render3d/extrusionPicking'
import { extrusionShapeForPlane, extrusionWorldMatrix } from '@/render3d/extrusionScene'
import { useUI } from '@/state/ui'
import { currentAnimationAuthorTime } from './animationPlayhead'
import { nodeGeometryPreviewStore } from './nodeGeometryPreviewStore'
import { nodeTransformPreviewStore } from './nodeTransformPreviewStore'
import { commitSolidFaceEdit, solidEditableFaces, solidEditableOutline, solidFaceHighlightKey, solidFaceDragDelta, solidFaceEdit, snapSolidFaceDelta, solidFaceEffectiveDelta, solidFacePreviewPlane, type SolidEditableFace, type SolidFaceEdit } from './solidFaceEditing'

import { constrainSolidResize, createSolidPlacementSession } from './solidPlacement'

export interface SolidFaceControlsProps {
  api: SceneAPI
  planes: readonly Plane3D[]
  occlusionPlanes?: readonly Plane3D[]
  /** All independent solids, including obstacles outside the selection. */
  placementPlanes?: readonly Plane3D[]
  /** Parts of the edited asset that may overlap their own housing/details. */
  placementIgnoreIds?: ReadonlySet<string>
  camera: ResolvedCamera3D
  width: number
  height: number
  zoom: number
  animated?: Readonly<Record<string, AnimatedValue>>
  enabled: boolean
  clientToViewport: (x: number, y: number) => { x: number; y: number } | null
}

/** The Extend tool owns face gestures; ordinary selection keeps its existing move behavior. */
export function SolidFaceControls({ api, planes, occlusionPlanes, placementPlanes, placementIgnoreIds, camera, width, height, zoom, animated, enabled, clientToViewport }: SolidFaceControlsProps) {
  const viewport = useMemo(() => ({ width, height }), [width, height])
  const faces = useMemo(() => planes.filter(plane => !plane.node.locked).flatMap(plane => solidEditableFaces(plane, camera, viewport).map(face => ({ ...face, plane, key: `${plane.nodeId}/${face.id}` }))).sort((a, b) => b.cameraDepth - a.cameraDepth), [planes, camera, viewport])
  const outlines = useMemo(() => planes.filter(plane => !plane.node.locked).flatMap(plane => solidEditableOutline(plane, camera, viewport)), [planes, camera, viewport])
  const highlightGroups = useMemo(() => {
    const groups = new Map<string, { key: string; paths: string[] }>()
    for (const face of faces) {
      const key = `${face.plane.nodeId}/${solidFaceHighlightKey(face)}`
      const group = groups.get(key) ?? { key, paths: [] }
      group.paths.push(`M${face.points.map(point => `${point.x},${point.y}`).join('L')}Z`)
      groups.set(key, group)
    }
    return [...groups.values()]
  }, [faces])
  const [hovered, setHovered] = useState<string | null>(null)
  const [dragLabel, setDragLabel] = useState<string | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  const planeIds = planes.map(plane => plane.nodeId).sort().join(',')
  useEffect(() => () => cancelRef.current?.(), [enabled, planeIds])
  const unit = 1 / Math.max(zoom, 0.001)
  const faceLabel = (face: SolidEditableFace, plane: Plane3D, edit?: SolidFaceEdit) => {
    const value = face.axis === 'depth' ? edit?.depth ?? plane.extrusion?.depth ?? 0
      : face.axis === 'height' ? edit?.size?.height ?? plane.rect.height : edit?.size?.width ?? plane.rect.width
    return `${face.axis === 'depth' ? 'Depth' : face.axis === 'diameter' ? 'Diameter' : face.axis === 'width' ? 'Width' : 'Height'} ${Math.round(value * 10) / 10} px`
  }
  const faceAt = (clientX: number, clientY: number) => {
    const point = clientToViewport(clientX, clientY)
    if (!point) return undefined
    const ray = viewportPointToRay(camera, point.x, point.y, viewport)
    // Locked geometry still occludes editable surfaces behind it.
    const blockers = (occlusionPlanes ?? planes).filter(candidate => candidate.opacity > 0).map(candidate => candidate.node.locked ? { ...candidate, node: { ...candidate.node, locked: false } } : candidate)
    const hit = hitTestPlanes(blockers, ray, camera, viewport)
    if (!hit) return undefined
    const plane = planes.find(candidate => candidate.nodeId === hit.nodeId)
    if (!plane || plane.node.locked) return undefined
    const shape = extrusionShapeForPlane(plane)
    const solidHit = shape && shape.depth > 0 ? intersectExtrusion(ray, shape, extrusionWorldMatrix(plane)) : null
    const candidates = faces.filter(face => face.plane.nodeId === plane.nodeId)
    if (!solidHit) return candidates.find(face => face.axis === 'depth')
    if (solidHit.surface !== 'side') return candidates.find(face => face.id === solidHit.surface)
    return candidates.filter(face => face.axis !== 'depth').sort((a, b) => {
      const distance = (face: SolidEditableFace) => Math.hypot(face.localCenter.x - solidHit.localPoint.x, face.localCenter.y - solidHit.localPoint.y)
      return distance(a) - distance(b)
    })[0]
  }
  const start = (event: ReactPointerEvent<SVGPolygonElement>) => {
    const face = faceAt(event.clientX, event.clientY)
    if (event.button !== 0 || !enabled || !face) return
    const plane = face.plane
    const animation = animated?.[plane.nodeId]
    const startPoint = clientToViewport(event.clientX, event.clientY)
    if (!startPoint) return
    event.preventDefault()
    event.stopPropagation()
    cancelRef.current?.()
    const element = event.currentTarget
    const pointerId = event.pointerId
    element.setPointerCapture(pointerId)
    const time = currentAnimationAuthorTime()
    const { recording, solidGridSnapEnabled, solidGridSize } = useUI.getState()
    const placementNodes = new Map<string, Node>()
    for (const id of api.getAllNodeIds()) {
      const node = api.getNode(id)
      if (node) placementNodes.set(id, node)
    }
    const placement = createSolidPlacementSession(placementPlanes ?? occlusionPlanes ?? planes, new Set([...(placementIgnoreIds ?? []), plane.nodeId]), placementNodes)
    useUI.getState().setPlaying(false)
    let previous = startPoint
    let total = 0
    let moved = false
    let latest: SolidFaceEdit | null = null
    const startDisplay = {
      x: animation?.x ?? plane.node.transform.x,
      y: animation?.y ?? plane.node.transform.y,
      z: animation?.z ?? plane.node.transform.z,
    }
    setHovered(face.key)
    setDragLabel(faceLabel(face, plane))
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId) return
      const point = clientToViewport(move.clientX, move.clientY)
      if (!point) return
      // Apply Shift to each movement packet. Pressing/releasing it midway
      // changes sensitivity without jumping the face under the held pointer.
      total += solidFaceDragDelta(previous, point, face, camera, viewport, move.shiftKey)
      previous = point
      if (!moved && Math.hypot(move.clientX - event.clientX, move.clientY - event.clientY) < 2) return
      const requested = solidGridSnapEnabled && !move.altKey ? snapSolidFaceDelta(plane, face, total, solidGridSize) : total
      latest = solidFaceEdit(plane, face, requested, animation)
      if (!latest) return
      const candidate = solidFacePreviewPlane(plane, latest, animation)
      const placementResult = constrainSolidResize(placement, [candidate], { bypass: move.altKey })
      if (placementResult.fraction < 1) {
        latest = solidFaceEdit(plane, face, solidFaceEffectiveDelta(plane, face, latest) * placementResult.fraction, animation)
        if (!latest) return
      }
      moved = true
      if (latest.size) nodeGeometryPreviewStore.preview({ [plane.nodeId]: { size: latest.size } })
      nodeTransformPreviewStore.preview({ [plane.nodeId]: {
        x: startDisplay.x + latest.translationDelta.x,
        y: startDisplay.y + latest.translationDelta.y,
        z: startDisplay.z + latest.translationDelta.z,
        ...(latest.depth === undefined ? {} : { extrusionDepth: latest.depth }),
      } })
      setDragLabel(`${faceLabel(face, plane, latest)}${placementResult.blocked ? ' · Touching asset' : ''}`)
    }
    const finish = (cancelled: boolean) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
      cancelRef.current = null
      try { element.releasePointerCapture(pointerId) } catch { /* Already released by the browser. */ }
      if (!cancelled && moved && latest) {
        commitSolidFaceEdit(api, plane.nodeId, latest, time, recording, animation)
        nodeGeometryPreviewStore.finish()
        nodeTransformPreviewStore.finish()
      } else {
        nodeGeometryPreviewStore.clear()
        nodeTransformPreviewStore.clear()
      }
      setDragLabel(null)
    }
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== pointerId) return
      // The modifier state on release is authoritative even if Alt changed
      // while the pointer was stationary after its final movement packet.
      onMove(up)
      finish(false)
    }
    const onCancel = (cancel: PointerEvent) => { if (cancel.pointerId === pointerId) finish(true) }
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== 'Escape') return
      key.preventDefault()
      key.stopPropagation()
      finish(true)
    }
    cancelRef.current = () => finish(true)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
  }
  if (!enabled || faces.length === 0) return null
  const active = faces.find(face => face.key === hovered)
  const activeHighlight = active ? `${active.plane.nodeId}/${solidFaceHighlightKey(active)}` : null
  const label = dragLabel ?? (active ? faceLabel(active, active.plane) : 'Drag a face to extend · Shift for 10×')
  const points = faces.flatMap(face => face.points)
  const labelPoint = { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: Math.min(...points.map(p => p.y)) - 16 * unit }
  return <div className="pointer-events-none absolute inset-0 z-[25]" data-export-hide="1" data-solid-face-controls={planeIds}>
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="pointer-events-none absolute inset-0 overflow-visible" aria-label="Extend selected solid">
      {highlightGroups.map(group => <path key={group.key} data-solid-highlight={group.key}
        d={group.paths.join(' ')} fill={activeHighlight === group.key ? 'rgba(0,153,255,0.22)' : 'rgba(0,153,255,0.035)'} stroke="none" />)}
      {faces.map(face => <polygon key={face.key} data-solid-node={face.plane.nodeId} data-solid-face={face.id} data-solid-axis={face.axis}
        points={face.points.map(point => `${point.x},${point.y}`).join(' ')}
        fill="transparent" stroke="none"
        style={{ pointerEvents: 'all', cursor: dragLabel ? 'grabbing' : 'grab' }}
        onPointerMove={event => { if (!dragLabel) setHovered(faceAt(event.clientX, event.clientY)?.key ?? null) }} onPointerLeave={() => { if (!dragLabel) setHovered(null) }}
        onPointerDown={start}><title>{faceLabel(face, face.plane)} — drag to extend</title></polygon>)}
      <path data-solid-outline="true" d={outlines.map(edge => `M${edge.from.x},${edge.from.y}L${edge.to.x},${edge.to.y}`).join(' ')}
        fill="none" stroke="rgba(0,153,255,0.72)" strokeWidth={unit} strokeLinejoin="round" strokeLinecap="round" />
      {active && (() => {
        const from = projectWorldPoint(active.worldCenter, camera, viewport)
        const to = projectWorldPoint({ x: active.worldCenter.x + active.worldAxis.x * 30 * unit, y: active.worldCenter.y + active.worldAxis.y * 30 * unit, z: active.worldCenter.z + active.worldAxis.z * 30 * unit }, camera, viewport)
        return <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#0099ff" strokeWidth={2 * unit} />
      })()}
      <text x={labelPoint.x} y={labelPoint.y} fontSize={11 * unit} textAnchor="middle" fill="#0088ee" stroke="white" strokeWidth={3 * unit} paintOrder="stroke" fontFamily="system-ui, sans-serif">{label}</text>
    </svg>
  </div>
}

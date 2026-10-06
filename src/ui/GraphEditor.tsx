// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Track } from '@/scene'
import { propertyDescriptor, useSceneAPI, useSceneVersion } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { evaluator, getAnimEngine } from '@/anim'
import { useUI } from '@/state/ui'
import { extendKeyframeSelection } from './keyframeSelection'
import { graphValueBounds } from './graphEditorMath'
import {
  commitGraphEasing,
  commitGraphKeyframeDrag,
  graphEditableBezierCoords,
  graphEasingHandle,
  graphKeyframeDragTarget,
  isGraphEditableTrack,
  previewGraphEasing,
  previewGraphKeyframeDrag,
  selectedGraphSegments,
} from './graphKeyframeEditing'

type Point = { x: number; y: number }
export type GraphTimeline = { width: number; pxPerSecond: number; duration: number; frameRate: number; playhead: number }
type Props = { timeline?: GraphTimeline; selectedKeys?: string[]; onSelectionChange?: (keys: string[]) => void }
const GRAPH_HEIGHT = 196
const PADDING = 22
const keyId = (track: Track, id: string) => `${track.id}:${id}`
const format = (value: number) => Number(value.toFixed(2)).toString()

/** A compact value graph, aligned with the timeline when mounted there. */
export function GraphEditor({ timeline, selectedKeys: suppliedKeys, onSelectionChange }: Props = {}) {
  useSceneVersion()
  const api = useSceneAPI()
  const storedKeys = useUI(s => s.selectedKeyframes)
  const selectedKeys = suppliedKeys ?? storedKeys
  const [pinnedTrackId, setPinnedTrackId] = useState<string | null>(null)
  const selectedTracks = [...new Set(selectedKeys.map(key => key.slice(0, key.indexOf(':'))))]
    .map(id => api.getTrack(id)).filter((track): track is Track => !!track && isGraphEditableTrack(track))
  const pinned = pinnedTrackId ? api.getTrack(pinnedTrackId) : undefined
  const track = selectedTracks.find(item => item.id === pinnedTrackId) ?? selectedTracks[0] ??
    (pinned && isGraphEditableTrack(pinned) ? pinned : undefined)
  const select = (keys: string[]) => {
    if (track) setPinnedTrackId(track.id)
    if (onSelectionChange) onSelectionChange(keys)
    else useUI.getState().setSelectedKeyframes(keys)
  }
  const segments = track ? selectedGraphSegments(track, selectedKeys) : []
  const preset = (bezier: [number, number, number, number]) => {
    if (!track) return
    api.doc.transact(() => {
      for (const segment of segments) commitGraphEasing(api, track.id, segment.start.id, segment.end.id, bezier)
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const label = (item: Track) => `${api.getNode(item.nodeId)?.name ?? 'Layer'} · ${propertyDescriptor(item.propertyId)?.label ?? item.propertyId}`
  const content = <div data-graph-editor="1" data-timeline-selection-surface="1" className="flex h-[248px] flex-col bg-panel" onPointerDown={event => event.stopPropagation()}>
    <div className="flex h-8 shrink-0 items-center gap-2 px-3 text-[11px]">
      {selectedTracks.length > 1 ? <select aria-label="Graph property" value={track?.id} onChange={event => setPinnedTrackId(event.target.value)} className="h-6 max-w-64 rounded border border-border bg-panel px-2 text-text">
        {selectedTracks.map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}
      </select> : <span className="max-w-64 truncate font-medium text-text">{track ? label(track) : 'Value graph'}</span>}
      <button type="button" disabled={!segments.length} onClick={() => preset([1 / 3, 0, 2 / 3, 1])} title="Ease the curves adjoining the selected keys" className="h-6 rounded border border-border px-2 text-text-muted hover:bg-panel-raised disabled:opacity-40">Ease</button>
      <button type="button" disabled={!segments.length} onClick={() => preset([1 / 3, 1 / 3, 2 / 3, 2 / 3])} title="Make the selected curves linear" className="h-6 rounded border border-border px-2 text-text-muted hover:bg-panel-raised disabled:opacity-40">Linear</button>
    </div>
    {track ? <GraphSurface key={track.id} track={track} api={api} timeline={timeline} selectedKeys={selectedKeys} onSelectionChange={select} /> :
      <div className="flex h-[196px] items-center px-6 text-[12px] text-text-dim">Select numeric keyframes on the timeline to edit their curves.</div>}
    <div className="h-5 shrink-0 px-3 text-[10px] text-text-dim">Drag keys: time / value · Drag handles: easing · Shift-click: select more · Esc: cancel</div>
  </div>
  if (timeline) return content
  return <details data-timeline-selection-surface="1" className="rounded-md border border-border bg-panel">
    <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold text-text">Graph editor</summary>
    {content}
  </details>
}

function GraphSurface({ track, api, timeline, selectedKeys, onSelectionChange }: {
  track: Track; api: SceneAPI; timeline?: GraphTimeline; selectedKeys: string[]; onSelectionChange: (keys: string[]) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const [preview, setPreview] = useState<Track | null>(null)
  const [lockedBounds, setLockedBounds] = useState<ReturnType<typeof graphValueBounds> | null>(null)
  const [readout, setReadout] = useState('')
  const visibleTrack = preview ?? track
  const keys = visibleTrack.keyframes
  const selected = new Set(selectedKeys)
  const segments = selectedGraphSegments(visibleTrack, selectedKeys)
  const width = timeline?.width ?? 600
  const timeMin = timeline ? 0 : Math.max(0, keys[0]!.time - 0.1)
  const timeMax = timeline?.duration ?? keys[keys.length - 1]!.time + 0.1
  const left = timeline ? 0 : 42
  const pixelsPerSecond = timeline?.pxPerSecond ?? (width - left - 20) / Math.max(0.2, timeMax - timeMin)
  const bounds = lockedBounds ?? graphValueBounds(visibleTrack)
  const span = bounds.max - bounds.min
  const height = GRAPH_HEIGHT - 2 * PADDING
  const dragOptions = { frameRate: timeline?.frameRate ?? api.getMeta().frameRate, duration: timeline?.duration ?? api.getMeta().duration }
  const project = (time: number, value: number): Point => ({ x: left + (time - timeMin) * pixelsPerSecond, y: PADDING + (bounds.max - value) / span * height })
  const unproject = (point: Point) => ({ time: timeMin + (point.x - left) / pixelsPerSecond, value: bounds.max - (point.y - PADDING) / height * span })

  useEffect(() => () => cleanupRef.current?.(), [])
  // An external delete or a track switch must release transient engine state.
  useEffect(() => {
    if (!api.getTrack(track.id)) cleanupRef.current?.()
  }, [api, track])

  const beginDrag = (
    event: ReactPointerEvent,
    update: (dx: number, dy: number, event: PointerEvent) => { tracks: ReadonlyMap<string, Track>; description: string; commit: () => void } | null,
  ) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    cleanupRef.current?.()
    useUI.getState().setPlaying(false)
    getAnimEngine().pause()
    setLockedBounds(bounds)
    const rect = svgRef.current!.getBoundingClientRect()
    const start = { x: event.clientX, y: event.clientY }
    const pointerId = event.pointerId
    let latest: ReturnType<typeof update> = null
    let pending: PointerEvent | null = null
    let frame = 0
    let moved = false
    const apply = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) * width / rect.width
      const dy = (ev.clientY - start.y) * GRAPH_HEIGHT / rect.height
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 2) return
      moved = true
      latest = update(dx, dy, ev)
      if (!latest) return
      setPreview(latest.tracks.get(track.id) ?? null)
      setReadout(latest.description)
      getAnimEngine().setTrackPreview(latest.tracks)
    }
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      ev.preventDefault()
      pending = ev
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; if (pending) apply(pending) })
    }
    const cleanup = () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', cancel)
      getAnimEngine().setTrackPreview(null)
      setPreview(null)
      setLockedBounds(null)
      setReadout('')
      cleanupRef.current = null
    }
    const cancel = () => cleanup()
    const onCancel = (ev: PointerEvent) => { if (ev.pointerId === pointerId) cancel() }
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      apply(ev)
      latest?.commit()
      cleanup()
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); cancel() }
    }
    cleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', cancel)
  }

  const selectKey = (id: string, additive: boolean, shift = false) => {
    const key = keyId(track, id)
    if (!additive) { onSelectionChange([key]); return }
    onSelectionChange([...extendKeyframeSelection(selectedKeys, [key], shift)])
  }
  const onKeyDown = (event: ReactPointerEvent, id: string) => {
    if (event.button !== 0) return
    if (event.shiftKey || event.metaKey || event.ctrlKey) { event.preventDefault(); event.stopPropagation(); selectKey(id, true, event.shiftKey); return }
    if (!selectedKeys.includes(keyId(track, id))) selectKey(id, false)
    const start = track.keyframes.find(key => key.id === id)!
    beginDrag(event, (dx, dy) => {
      const target = graphKeyframeDragTarget(api, track.id, id, {
        time: start.time + dx / pixelsPerSecond,
        value: (start.value as number) - dy / height * span,
        frameRate: timeline?.frameRate ?? api.getMeta().frameRate,
        duration: timeline?.duration ?? api.getMeta().duration,
      })
      if (!target) return null
      return { tracks: previewGraphKeyframeDrag(api, track.id, id, target, dragOptions), description: `${format(target.time)}s · ${format(target.value)}`, commit: () => { commitGraphKeyframeDrag(api, track.id, id, target, dragOptions) } }
    })
  }
  const onHandleDown = (event: ReactPointerEvent, startId: string, endId: string, which: 1 | 2) => {
    const a = track.keyframes.find(key => key.id === startId)!
    const b = track.keyframes.find(key => key.id === endId)!
    const bezier = graphEditableBezierCoords(a.easingOut ?? track.defaultEasing)
    const offset = which === 1 ? 0 : 2
    const point = project(a.time + bezier[offset]! * (b.time - a.time), (a.value as number) + bezier[offset + 1]! * ((b.value as number) - (a.value as number)))
    beginDrag(event, (dx, dy) => {
      const position = unproject({ x: point.x + dx, y: point.y + dy })
      const next = graphEasingHandle(track, startId, endId, which, position.time, position.value)
      if (!next) return null
      return { tracks: previewGraphEasing(api, track.id, startId, endId, next), description: `${which === 1 ? 'Outgoing' : 'Incoming'} handle`, commit: () => { commitGraphEasing(api, track.id, startId, endId, next) } }
    })
  }
  const nudgeKey = (event: React.KeyboardEvent, id: string) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectKey(id, event.shiftKey || event.metaKey || event.ctrlKey, event.shiftKey); return }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const start = track.keyframes.find(key => key.id === id)!
    const step = event.shiftKey ? 10 : 1
    const target = graphKeyframeDragTarget(api, track.id, id, {
      time: start.time + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) / (timeline?.frameRate ?? api.getMeta().frameRate),
      value: (start.value as number) + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0) * span / 100,
      frameRate: timeline?.frameRate ?? api.getMeta().frameRate, duration: timeline?.duration ?? api.getMeta().duration,
    })
    if (target) commitGraphKeyframeDrag(api, track.id, id, target, dragOptions)
  }

  return <svg ref={svgRef} viewBox={`0 0 ${width} ${GRAPH_HEIGHT}`} preserveAspectRatio="none" style={{ width: timeline ? width : '100%', height: GRAPH_HEIGHT, touchAction: 'none', overflow: 'hidden' }} className="block shrink-0 select-none" aria-label="Keyframe value graph" onPointerDown={event => { if (event.target === event.currentTarget) onSelectionChange([]) }}>
    {[0, 0.5, 1].map((fraction) => {
      const y = PADDING + fraction * height
      return <g key={fraction} pointerEvents="none"><line x1={0} x2={width} y1={y} y2={y} stroke="var(--color-border)" strokeDasharray="3 4" /><text x={8} y={y - 5} fill="var(--color-text-dim)" fontSize={10}>{format(bounds.max - fraction * span)}</text></g>
    })}
    {segments.map(({ start: a, end: b, startSelected, endSelected }) => {
      const bezier = graphEditableBezierCoords(a.easingOut ?? visibleTrack.defaultEasing)
      const valueA = a.value as number, delta = (b.value as number) - valueA, dt = b.time - a.time
      const p0 = project(a.time, valueA), p3 = project(b.time, b.value as number)
      const p1 = project(a.time + bezier[0] * dt, valueA + bezier[1] * delta)
      const p2 = project(a.time + bezier[2] * dt, valueA + bezier[3] * delta)
      const easing = a.easingOut ?? visibleTrack.defaultEasing
      const spring = typeof easing === 'object' && 'spring' in easing
      const path = spring ? Array.from({ length: 65 }, (_, i) => { const p = project(a.time + dt * i / 64, valueA + delta * evaluator(easing)(i / 64)); return `${i ? 'L' : 'M'}${p.x},${p.y}` }).join(' ') : `M${p0.x},${p0.y} C${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`
      return <g key={`${a.id}:${b.id}`} data-graph-segment={`${a.id}:${b.id}`}>
        <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={2} pointerEvents="none" />
        {([[1, p0, p1, startSelected], [2, p3, p2, endSelected]] as const).map(([which, anchor, control, show]) => {
          if (!show) return null
          // Zero-length tangents get a visible grip outside the keyframe hit area.
          const distance = Math.hypot(control.x - anchor.x, control.y - anchor.y)
          const grip = distance < 18 ? { x: anchor.x + (which === 1 ? 18 : -18), y: anchor.y } : control
          const owner = which === 1 ? a : b
          const name = `${which === 1 ? 'Outgoing' : 'Incoming'} easing handle at ${format(owner.time)} seconds`
          return <g key={which}>
            <line x1={anchor.x} y1={anchor.y} x2={grip.x} y2={grip.y} stroke="var(--color-accent)" strokeOpacity={0.65} pointerEvents="none" />
            <circle cx={grip.x} cy={grip.y} r={11} fill="transparent" stroke="none" style={{ cursor: 'grab' }} role="button" tabIndex={0} aria-label={name} data-graph-handle={which} onPointerDown={event => onHandleDown(event, a.id, b.id, which)} onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
              event.preventDefault(); event.stopPropagation()
              const amount = event.shiftKey ? 0.1 : 0.01
              const next: [number, number, number, number] = [...bezier]
              const offset = which === 1 ? 0 : 2
              next[offset] = Math.max(0, Math.min(1, next[offset]! + (event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0)))
              if (delta) next[offset + 1] = next[offset + 1]! + (event.key === 'ArrowUp' ? amount : event.key === 'ArrowDown' ? -amount : 0) * Math.sign(delta)
              commitGraphEasing(api, track.id, a.id, b.id, next)
            }}><title>{name}{spring ? ' · Drag to use a custom curve' : delta === 0 ? ' · Equal key values keep this segment flat' : ''}</title></circle>
            <circle cx={grip.x} cy={grip.y} r={5} fill="var(--color-panel)" stroke="var(--color-accent)" strokeWidth={2} pointerEvents="none" />
          </g>
        })}
      </g>
    })}
    {keys.map(key => {
      const point = project(key.time, key.value as number), active = selected.has(keyId(track, key.id))
      return <g key={key.id} role="button" tabIndex={0} aria-label={`Keyframe at ${format(key.time)} seconds, value ${format(key.value as number)}`} aria-pressed={active} data-graph-key={key.id} style={{ cursor: 'move' }} onPointerDown={event => onKeyDown(event, key.id)} onKeyDown={event => nudgeKey(event, key.id)}>
        <circle cx={point.x} cy={point.y} r={9} fill="transparent" />
        <rect x={point.x - 4} y={point.y - 4} width={8} height={8} transform={`rotate(45 ${point.x} ${point.y})`} fill={active ? 'var(--color-accent)' : 'var(--color-panel-raised)'} stroke={active ? 'var(--color-text)' : 'var(--color-text-dim)'} strokeWidth={active ? 1.5 : 1} pointerEvents="none" />
        <title>{format(key.time)}s · {format(key.value as number)} · Drag to move</title>
      </g>
    })}
    {!!readout && <text x={Math.max(60, Math.min(width - 120, project(timeline?.playhead ?? timeMin, 0).x + 12))} y={13} fill="var(--color-text)" fontSize={11} pointerEvents="none">{readout}</text>}
    {!timeline && <g fill="var(--color-text-dim)" fontSize={10} pointerEvents="none"><text x={left} y={GRAPH_HEIGHT - 4}>{format(timeMin)}s</text><text x={width - 20} y={GRAPH_HEIGHT - 4} textAnchor="end">{format(timeMax)}s</text></g>}
  </svg>
}

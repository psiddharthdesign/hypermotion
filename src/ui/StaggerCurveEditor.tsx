// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react'
import {
  MAX_TEXT_STAGGER_CURVE_POINTS,
  normalizeTextStaggerCurve,
  removeTextStaggerCurvePoint,
  splitTextStaggerCurveAt,
  type TextStaggerCurve,
  type TextStaggerCurvePoint,
} from '@/anim/textStaggerCurve'
import { NumberField } from '@/ui/fields/NumberField'
import {
  editCurvePart,
  type StaggerCurvePart,
} from '@/ui/staggerCurveEditorMath'

const VIEW_W = 280
const VIEW_H = 150
const PAD_L = 24
const PAD_R = 14
const PAD_T = 12
const PAD_B = 22
type DragPart = StaggerCurvePart

export function StaggerCurveEditor({
  curve,
  onCommit,
  onReset,
  onPreview,
  onPreviewFinish,
  onPreviewCancel,
}: {
  curve: TextStaggerCurve
  onCommit: (next: TextStaggerCurve) => void
  onReset: () => void
  onPreview?: (next: TextStaggerCurve) => void
  onPreviewFinish?: () => void
  onPreviewCancel?: () => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragCancelRef = useRef<(() => void) | null>(null)
  const sourceKey = curveSignature(curve)
  const [draftState, setDraftState] = useState(() => ({
    sourceKey,
    curve,
  }))
  const [selectedPointId, setSelectedPointId] = useState(
    curve.points[0]?.id ?? '',
  )
  const displayed =
    draftState.sourceKey === sourceKey ? draftState.curve : curve
  const selectedPoint =
    displayed.points.find((point) => point.id === selectedPointId) ??
    displayed.points[0]!
  const selectedIndex = displayed.points.findIndex(
    (point) => point.id === selectedPoint.id,
  )
  const selectedIsInterior =
    selectedIndex > 0 && selectedIndex < displayed.points.length - 1

  useEffect(
    () => () => {
      dragCancelRef.current?.()
    },
    [],
  )

  const setDraft = (next: TextStaggerCurve) => {
    setDraftState({ sourceKey, curve: next })
  }
  const commit = (next: TextStaggerCurve) => {
    const normalized = normalizeTextStaggerCurve(next)
    if (!normalized) return
    if (curveSignature(normalized) === curveSignature(curve)) return
    setDraft(normalized)
    onCommit(normalized)
  }

  const addPoint = (atX?: number) => {
    if (displayed.points.length >= MAX_TEXT_STAGGER_CURVE_POINTS) return
    const x = atX ?? largestSegmentMidpoint(displayed)
    const id = newCurvePointId()
    const next = splitTextStaggerCurveAt(displayed, x, id)
    if (next.points.length === displayed.points.length) return
    setSelectedPointId(id)
    commit(next)
  }

  const deleteSelected = () => {
    if (!selectedIsInterior) return
    const next = removeTextStaggerCurvePoint(displayed, selectedPoint.id)
    const nextSelection = next.points[Math.max(0, selectedIndex - 1)]?.id ?? ''
    setSelectedPointId(nextSelection)
    commit(next)
  }

  const beginDrag = (
    event: React.PointerEvent,
    pointId: string,
    part: DragPart,
  ) => {
    if (event.button !== 0) return
    const svg = svgRef.current
    const pointIndex = displayed.points.findIndex((point) => point.id === pointId)
    if (!svg || pointIndex < 0) return
    if (dragCancelRef.current) return
    if (
      part === 'anchor' &&
      (pointIndex === 0 || pointIndex === displayed.points.length - 1)
    ) {
      setSelectedPointId(pointId)
      return
    }
    event.preventDefault()
    event.stopPropagation()
    ;(event.currentTarget as SVGElement).focus?.()
    setSelectedPointId(pointId)
    const pointerId = event.pointerId
    const start = displayed
    let latest = start
    let moved = false

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onCancel)
      window.removeEventListener('keydown', onKeyDown, true)
      dragCancelRef.current = null
    }
    const onMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return
      pointerEvent.preventDefault()
      const target = pointerToGraph(svg, pointerEvent.clientX, pointerEvent.clientY)
      latest = editCurvePart(start, pointId, part, target.x, target.y)
      moved = true
      setDraft(latest)
      onPreview?.(latest)
    }
    const onUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return
      cleanup()
      if (moved) {
        commit(latest)
        onPreviewFinish?.()
      }
    }
    const onCancel = (pointerEvent?: PointerEvent | Event) => {
      if (
        pointerEvent instanceof PointerEvent &&
        pointerEvent.pointerId !== pointerId
      ) {
        return
      }
      cleanup()
      setDraft(start)
      onPreviewCancel?.()
    }
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return
      keyEvent.preventDefault()
      keyEvent.stopPropagation()
      keyEvent.stopImmediatePropagation()
      onCancel()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onCancel)
    // Capture Escape before the app-wide shortcut handler can clear the
    // scene selection while this editor is cancelling an active drag.
    window.addEventListener('keydown', onKeyDown, true)
    dragCancelRef.current = onCancel
  }

  const nudge = (
    event: React.KeyboardEvent,
    pointId: string,
    part: DragPart,
  ) => {
    const step = event.shiftKey ? 0.05 : event.altKey ? 0.002 : 0.01
    const delta =
      event.key === 'ArrowLeft'
        ? { x: -step, y: 0 }
        : event.key === 'ArrowRight'
          ? { x: step, y: 0 }
          : event.key === 'ArrowUp'
            ? { x: 0, y: step }
            : event.key === 'ArrowDown'
              ? { x: 0, y: -step }
              : null
    if (!delta) {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        event.stopPropagation()
        if (selectedIsInterior) deleteSelected()
      }
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat) return
    const pointIndex = displayed.points.findIndex(
      (candidate) => candidate.id === pointId,
    )
    if (
      part === 'anchor' &&
      (pointIndex === 0 || pointIndex === displayed.points.length - 1)
    ) {
      return
    }
    const point = displayed.points.find((candidate) => candidate.id === pointId)
    if (!point) return
    const current = graphPartPosition(point, part)
    commit(
      editCurvePart(
        displayed,
        pointId,
        part,
        current.x + delta.x,
        current.y + delta.y,
      ),
    )
  }

  const path = staggerCurvePath(displayed)
  const selectedNumber = Math.max(1, selectedIndex + 1)

  return (
    <div
      data-curve-editor="trail-profile"
      className="rounded-md border border-border bg-panel-raised p-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-medium tracking-wider text-text-dim uppercase">
            Trail profile <span className="text-stagger">· across text</span>
          </div>
          <div className="mt-0.5 font-mono text-[9px] text-text-dim">
            {displayed.points.length} points
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => addPoint()}
            disabled={displayed.points.length >= MAX_TEXT_STAGGER_CURVE_POINTS}
            className="h-7 rounded bg-panel px-2 text-[10px] text-text-muted hover:text-text disabled:opacity-40"
          >
            + Point
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            disabled={!selectedIsInterior}
            className="grid h-7 w-7 place-items-center rounded bg-panel text-text-muted hover:text-text disabled:opacity-35"
            aria-label="Delete selected stagger curve point"
            title="Delete selected point"
          >
            <TrashIcon />
          </button>
          <button
            type="button"
            onClick={onReset}
            className="h-7 rounded px-2 text-[10px] text-text-dim hover:bg-panel hover:text-text"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="mt-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-auto w-full select-none rounded border border-border bg-panel"
          role="group"
          aria-label="Editable traveling trail profile. Double-click to add a point."
          onDoubleClick={(event) => {
            if ((event.target as Element).closest('[data-curve-control]')) return
            const svg = svgRef.current
            if (!svg) return
            const target = pointerToGraph(
              svg,
              event.clientX,
              event.clientY,
            )
            addPoint(target.x)
          }}
        >
          <g stroke="var(--color-border)" strokeWidth={0.5}>
            <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={VIEW_H - PAD_B} />
            <line x1={PAD_L} y1={VIEW_H - PAD_B} x2={VIEW_W - PAD_R} y2={VIEW_H - PAD_B} />
            <line
              x1={PAD_L}
              y1={(PAD_T + VIEW_H - PAD_B) / 2}
              x2={VIEW_W - PAD_R}
              y2={(PAD_T + VIEW_H - PAD_B) / 2}
              strokeDasharray="2 3"
            />
            <line
              x1={(PAD_L + VIEW_W - PAD_R) / 2}
              y1={PAD_T}
              x2={(PAD_L + VIEW_W - PAD_R) / 2}
              y2={VIEW_H - PAD_B}
              strokeDasharray="2 3"
            />
          </g>
          <g
            fill="var(--color-text-dim)"
            fontFamily="var(--font-mono, monospace)"
            fontSize={8}
          >
            <text x={PAD_L} y={VIEW_H - 7}>Front</text>
            <text x={VIEW_W - PAD_R} y={VIEW_H - 7} textAnchor="end">Tail</text>
            <text x={4} y={VIEW_H - PAD_B + 3}>Initial</text>
            <text x={4} y={PAD_T + 3}>Final</text>
          </g>
          <path
            d={path}
            fill="none"
            stroke="var(--color-stagger)"
            strokeWidth={2}
            strokeLinecap="round"
          />

          <SelectedHandles
            curve={displayed}
            point={selectedPoint}
            onPointerDown={beginDrag}
            onKeyDown={nudge}
          />

          {displayed.points.map((point, index) => {
            const position = project(point.x, point.y)
            const selected = point.id === selectedPoint.id
            return (
              <g key={point.id} data-curve-control="anchor">
                <circle
                  cx={position.x}
                  cy={position.y}
                  r={11}
                  fill="transparent"
                  onPointerDown={(event) => beginDrag(event, point.id, 'anchor')}
                />
                <circle
                  cx={position.x}
                  cy={position.y}
                  r={selected ? 5 : 3.5}
                  fill={selected ? 'var(--color-stagger)' : 'var(--color-panel-raised)'}
                  stroke="var(--color-stagger-ring)"
                  strokeWidth={1.5}
                  tabIndex={0}
                  role="button"
                  aria-roledescription="two-dimensional curve point"
                  aria-label={`Trail point ${index + 1} of ${displayed.points.length}: ${Math.round(point.x * 100)} percent phase, ${Math.round(point.y * 100)} percent completion`}
                  onFocus={() => setSelectedPointId(point.id)}
                  onPointerDown={(event) => beginDrag(event, point.id, 'anchor')}
                  onKeyDown={(event) => nudge(event, point.id, 'anchor')}
                  style={{ cursor: index === 0 || index === displayed.points.length - 1 ? 'default' : 'move' }}
                />
              </g>
            )
          })}
        </svg>
      </div>

      <div className="mt-2 text-[10px] text-text-dim">
        Point {selectedNumber}/{displayed.points.length}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5">
          <span className="text-[9px] text-text-dim uppercase">Phase</span>
          <NumberField
            value={Math.round(selectedPoint.x * 100)}
            onCommit={(value) =>
              commit(
                editCurvePart(
                  displayed,
                  selectedPoint.id,
                  'anchor',
                  value / 100,
                  selectedPoint.y,
                ),
              )
            }
            min={0}
            max={100}
            suffix="%"
            disabled={!selectedIsInterior}
            ariaLabel="Selected trail point phase"
            width="w-full"
          />
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5">
          <span className="text-[9px] text-text-dim uppercase">Completion</span>
          <NumberField
            value={Math.round(selectedPoint.y * 100)}
            onCommit={(value) =>
              commit(
                editCurvePart(
                  displayed,
                  selectedPoint.id,
                  'anchor',
                  selectedPoint.x,
                  value / 100,
                ),
              )
            }
            min={0}
            max={100}
            suffix="%"
            disabled={!selectedIsInterior}
            ariaLabel="Selected trail point completion"
            width="w-full"
          />
        </div>
      </div>
      <p className="mt-2 text-[9px] leading-snug text-text-dim">
        Double-click to add a point. This bend travels through the ordered
        text: the front is initial, and the tail settles toward final. Trail
        length sets its span; Time easing moves the whole profile.
      </p>
    </div>
  )
}

export function StaggerCurveMini({
  curve,
}: {
  curve: TextStaggerCurve
}) {
  return (
    <svg
      viewBox="0 0 64 24"
      className="h-6 w-16"
      aria-hidden="true"
    >
      <path
        d={staggerCurvePath(curve, 64, 24, 2, 2, 2, 2)}
        fill="none"
        stroke="var(--color-stagger)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  )
}

function SelectedHandles({
  curve,
  point,
  onPointerDown,
  onKeyDown,
}: {
  curve: TextStaggerCurve
  point: TextStaggerCurvePoint
  onPointerDown: (
    event: React.PointerEvent,
    pointId: string,
    part: DragPart,
  ) => void
  onKeyDown: (
    event: React.KeyboardEvent,
    pointId: string,
    part: DragPart,
  ) => void
}) {
  const index = curve.points.findIndex((candidate) => candidate.id === point.id)
  const anchor = project(point.x, point.y)
  const handles: Array<{ part: 'in' | 'out'; x: number; y: number }> = []
  if (index > 0) handles.push({ part: 'in', x: point.inX, y: point.inY })
  if (index < curve.points.length - 1) {
    handles.push({ part: 'out', x: point.outX, y: point.outY })
  }
  return handles.map((handle) => {
    const position = project(handle.x, handle.y)
    return (
      <g key={handle.part} data-curve-control="handle">
        <line
          x1={anchor.x}
          y1={anchor.y}
          x2={position.x}
          y2={position.y}
          stroke="var(--color-stagger)"
          strokeOpacity={0.55}
          strokeWidth={1}
        />
        <circle
          cx={position.x}
          cy={position.y}
          r={10}
          fill="transparent"
          onPointerDown={(event) => onPointerDown(event, point.id, handle.part)}
        />
        <circle
          cx={position.x}
          cy={position.y}
          r={3.5}
          fill="var(--color-panel-raised)"
          stroke="var(--color-stagger)"
          strokeWidth={1.5}
          tabIndex={0}
          role="button"
          aria-roledescription="curve handle"
          aria-label={`${handle.part === 'in' ? 'Incoming' : 'Outgoing'} handle: ${Math.round(handle.x * 100)} percent phase, ${Math.round(handle.y * 100)} percent completion`}
          onPointerDown={(event) => onPointerDown(event, point.id, handle.part)}
          onKeyDown={(event) => onKeyDown(event, point.id, handle.part)}
          style={{ cursor: 'grab' }}
        />
      </g>
    )
  })
}

function graphPartPosition(
  point: TextStaggerCurvePoint,
  part: DragPart,
): { x: number; y: number } {
  if (part === 'in') return { x: point.inX, y: point.inY }
  if (part === 'out') return { x: point.outX, y: point.outY }
  return { x: point.x, y: point.y }
}

function staggerCurvePath(
  curve: TextStaggerCurve,
  width = VIEW_W,
  height = VIEW_H,
  padLeft = PAD_L,
  padRight = PAD_R,
  padTop = PAD_T,
  padBottom = PAD_B,
): string {
  const map = (x: number, y: number) => ({
    x: padLeft + x * (width - padLeft - padRight),
    y: padTop + (1 - y) * (height - padTop - padBottom),
  })
  return curve.points
    .slice(0, -1)
    .map((point, index) => {
      const next = curve.points[index + 1]!
      const p0 = map(point.x, point.y)
      const p1 = map(point.outX, point.outY)
      const p2 = map(next.inX, next.inY)
      const p3 = map(next.x, next.y)
      return `${index === 0 ? `M ${p0.x},${p0.y} ` : ''}C ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`
    })
    .join(' ')
}

function project(x: number, y: number): { x: number; y: number } {
  return {
    x: PAD_L + x * (VIEW_W - PAD_L - PAD_R),
    y: PAD_T + (1 - y) * (VIEW_H - PAD_T - PAD_B),
  }
}

function pointerToGraph(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const bounds = svg.getBoundingClientRect()
  const svgX = ((clientX - bounds.left) / Math.max(1, bounds.width)) * VIEW_W
  const svgY = ((clientY - bounds.top) / Math.max(1, bounds.height)) * VIEW_H
  return {
    x: clamp((svgX - PAD_L) / (VIEW_W - PAD_L - PAD_R), 0, 1),
    y: clamp(1 - (svgY - PAD_T) / (VIEW_H - PAD_T - PAD_B), 0, 1),
  }
}

function largestSegmentMidpoint(curve: TextStaggerCurve): number {
  let largestStart = 0
  let largestEnd = 1
  let largestSpan = -1
  for (let index = 0; index < curve.points.length - 1; index++) {
    const start = curve.points[index]!.x
    const end = curve.points[index + 1]!.x
    if (end - start > largestSpan) {
      largestSpan = end - start
      largestStart = start
      largestEnd = end
    }
  }
  return (largestStart + largestEnd) / 2
}

function curveSignature(curve: TextStaggerCurve): string {
  return curve.points
    .map((point) =>
      [
        point.id,
        point.x,
        point.y,
        point.inX,
        point.inY,
        point.outX,
        point.outY,
      ].join(':'),
    )
    .join('|')
}

function newCurvePointId(): string {
  return `curve-point-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    >
      <path d="M3.5 4.5h9" />
      <path d="M6 2.75h4" />
      <path d="M5 4.5l.5 8h5l.5-8" />
    </svg>
  )
}

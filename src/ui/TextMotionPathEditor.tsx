// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react'
import {
  MAX_TEXT_MOTION_PATH_POINTS,
  normalizeTextMotionPath,
  removeTextMotionPathPoint,
  splitTextMotionPathAt,
  type TextMotionPath,
  type TextMotionPathPoint,
} from '@/anim/textMotionPath'
import { NumberField } from '@/ui/fields/NumberField'
import { startGlobalPointerDrag } from '@/ui/pointerDrag'
import {
  editTextMotionPathPart,
  largestTextMotionPathSegmentMidpoint,
  nearestTextMotionPathAmount,
  textMotionPathPartPosition,
  type TextMotionPathPart,
  type TextMotionPathPosition,
} from '@/ui/textMotionPathEditorMath'

const VIEW_W = 280
const VIEW_H = 176
const PAD_L = 18
const PAD_R = 14
const PAD_T = 14
const PAD_B = 20
type DragPart = TextMotionPathPart
type Axis = 'x' | 'y' | 'z'

interface MotionPathView {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export function TextMotionPathEditor({
  path,
  onCommit,
  onReset,
  onPreview,
  onPreviewFinish,
  onPreviewCancel,
}: {
  path: TextMotionPath
  onCommit: (next: TextMotionPath) => void
  onReset: () => void
  onPreview?: (next: TextMotionPath) => void
  onPreviewFinish?: () => void
  onPreviewCancel?: () => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragCancelRef = useRef<(() => void) | null>(null)
  const numericScrubStartRef = useRef<TextMotionPath | null>(null)
  const previewCancelRef = useRef(onPreviewCancel)
  const sourceKey = motionPathSignature(path)
  const [draftState, setDraftState] = useState(() => ({
    sourceKey,
    path,
  }))
  const [selectedPointId, setSelectedPointId] = useState(
    path.points.at(-1)?.id ?? path.points[0]?.id ?? '',
  )
  const displayed =
    draftState.sourceKey === sourceKey ? draftState.path : path
  const selectedPoint =
    displayed.points.find((point) => point.id === selectedPointId) ??
    displayed.points.at(-1)!
  const selectedIndex = displayed.points.findIndex(
    (point) => point.id === selectedPoint.id,
  )
  const selectedIsSettled = selectedIndex === 0
  const selectedIsInterior =
    selectedIndex > 0 && selectedIndex < displayed.points.length - 1
  // Deliberately derive the graph viewport from the committed prop. During a
  // drag the draft may extend beyond it, but the coordinate system stays put
  // beneath the pointer instead of zooming and making the curve jump.
  const view = motionPathView(path)

  useEffect(() => {
    previewCancelRef.current = onPreviewCancel
  }, [onPreviewCancel])

  useEffect(
    () => () => {
      dragCancelRef.current?.()
      if (numericScrubStartRef.current) previewCancelRef.current?.()
    },
    [],
  )

  const setDraft = (next: TextMotionPath) => {
    setDraftState({ sourceKey, path: next })
  }
  const commit = (next: TextMotionPath) => {
    const normalized = normalizeTextMotionPath(next)
    if (!normalized) return
    if (motionPathSignature(normalized) === motionPathSignature(path)) return
    setDraft(normalized)
    onCommit(normalized)
  }

  const addPoint = (atAmount?: number) => {
    if (displayed.points.length >= MAX_TEXT_MOTION_PATH_POINTS) return
    const amount = atAmount ?? largestTextMotionPathSegmentMidpoint(displayed)
    const id = newMotionPathPointId()
    const next = splitTextMotionPathAt(displayed, amount, id)
    if (next.points.length === displayed.points.length) return
    setSelectedPointId(id)
    commit(next)
  }

  const deleteSelected = () => {
    if (!selectedIsInterior) return
    const next = removeTextMotionPathPoint(displayed, selectedPoint.id)
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
    if (!svg || pointIndex < 0 || dragCancelRef.current) return
    if (part === 'anchor' && pointIndex === 0) {
      setSelectedPointId(pointId)
      return
    }
    event.preventDefault()
    event.stopPropagation()
    ;(event.currentTarget as SVGElement).focus?.()
    setSelectedPointId(pointId)
    const pointerId = event.pointerId
    const start = displayed
    const startPoint = start.points.find((point) => point.id === pointId)!
    const startPart = textMotionPathPartPosition(startPoint, part)
    let latest = start

    dragCancelRef.current = startGlobalPointerDrag(pointerId, {
      onMove: (pointerEvent) => {
        const target = pointerToWorld(
          svg,
          pointerEvent.clientX,
          pointerEvent.clientY,
          view,
        )
        latest = editTextMotionPathPart(start, pointId, part, {
          ...target,
          z: startPart.z,
        })
        setDraft(latest)
        onPreview?.(latest)
      },
      onCommit: () => {
        commit(latest)
        onPreviewFinish?.()
      },
      onCancel: () => {
        setDraft(start)
        onPreviewCancel?.()
      },
      onCleanup: () => {
        dragCancelRef.current = null
      },
    })
  }

  const nudge = (
    event: React.KeyboardEvent,
    pointId: string,
    part: DragPart,
  ) => {
    const step = event.shiftKey ? 0.5 : event.altKey ? 0.01 : 0.1
    const delta =
      event.key === 'ArrowLeft'
        ? { x: -step, y: 0 }
        : event.key === 'ArrowRight'
          ? { x: step, y: 0 }
          : event.key === 'ArrowUp'
            ? { x: 0, y: -step }
            : event.key === 'ArrowDown'
              ? { x: 0, y: step }
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
    if (part === 'anchor' && pointIndex === 0) return
    const point = displayed.points[pointIndex]
    if (!point) return
    const current = textMotionPathPartPosition(point, part)
    commit(
      editTextMotionPathPart(displayed, pointId, part, {
        x: current.x + delta.x,
        y: current.y + delta.y,
        z: current.z,
      }),
    )
  }

  const editSelectedAxis = (
    base: TextMotionPath,
    axis: Axis,
    value: number,
  ): TextMotionPath => {
    const point =
      base.points.find((candidate) => candidate.id === selectedPoint.id) ??
      base.points.at(-1)!
    return editTextMotionPathPart(base, point.id, 'anchor', {
      x: axis === 'x' ? value : point.x,
      y: axis === 'y' ? value : point.y,
      z: axis === 'z' ? value : point.z,
    })
  }

  const previewAxis = (axis: Axis, value: number) => {
    const start = numericScrubStartRef.current ?? displayed
    numericScrubStartRef.current = start
    const next = editSelectedAxis(start, axis, value)
    setDraft(next)
    onPreview?.(next)
  }
  const commitAxisScrub = (axis: Axis, value: number) => {
    const start = numericScrubStartRef.current ?? displayed
    numericScrubStartRef.current = null
    commit(editSelectedAxis(start, axis, value))
    onPreviewFinish?.()
  }
  const cancelAxisScrub = () => {
    const start = numericScrubStartRef.current
    numericScrubStartRef.current = null
    if (start) setDraft(start)
    onPreviewCancel?.()
  }

  const svgPath = motionPathSvgPath(displayed, view)
  const selectedNumber = Math.max(1, selectedIndex + 1)
  const settledPoint = displayed.points[0]!
  const hiddenPoint = displayed.points.at(-1)!
  const grid = gridLines(view)

  return (
    <div
      data-curve-editor="motion-path"
      className="rounded-md border border-border bg-panel-raised p-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-medium tracking-wider text-text-dim uppercase">
            Motion path <span className="text-accent">· XYZ</span>
          </div>
          <div className="mt-0.5 font-mono text-[9px] text-text-dim">
            {displayed.points.length} points · line-height units
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => addPoint()}
            disabled={displayed.points.length >= MAX_TEXT_MOTION_PATH_POINTS}
            className="h-7 rounded bg-panel px-2 text-[10px] text-text-muted hover:text-text disabled:opacity-40"
          >
            + Point
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            disabled={!selectedIsInterior}
            className="grid h-7 w-7 place-items-center rounded bg-panel text-text-muted hover:text-text disabled:opacity-35"
            aria-label="Delete selected motion path point"
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
          aria-label="Editable text motion path. Double-click near the curve to add a point."
          onDoubleClick={(event) => {
            if ((event.target as Element).closest('[data-curve-control]')) return
            const svg = svgRef.current
            if (!svg) return
            const target = pointerToWorld(
              svg,
              event.clientX,
              event.clientY,
              view,
            )
            addPoint(nearestTextMotionPathAmount(displayed, target))
          }}
        >
          <g stroke="var(--color-border)" strokeWidth={0.5}>
            {grid.vertical.map((x) => {
              const projected = project({ x, y: 0 }, view)
              return (
                <line
                  key={`x-${x}`}
                  x1={projected.x}
                  y1={PAD_T}
                  x2={projected.x}
                  y2={VIEW_H - PAD_B}
                  strokeDasharray={Math.abs(x) < 1e-9 ? undefined : '2 3'}
                  strokeOpacity={Math.abs(x) < 1e-9 ? 1 : 0.55}
                />
              )
            })}
            {grid.horizontal.map((y) => {
              const projected = project({ x: 0, y }, view)
              return (
                <line
                  key={`y-${y}`}
                  x1={PAD_L}
                  y1={projected.y}
                  x2={VIEW_W - PAD_R}
                  y2={projected.y}
                  strokeDasharray={Math.abs(y) < 1e-9 ? undefined : '2 3'}
                  strokeOpacity={Math.abs(y) < 1e-9 ? 1 : 0.55}
                />
              )
            })}
          </g>

          <path
            d={svgPath}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={2}
            strokeLinecap="round"
          />

          <SelectedHandles
            path={displayed}
            point={selectedPoint}
            view={view}
            onPointerDown={beginDrag}
            onKeyDown={nudge}
          />

          {displayed.points.map((point, index) => {
            const position = project(point, view)
            const selected = point.id === selectedPoint.id
            const settled = index === 0
            return (
              <g key={point.id} data-curve-control="anchor">
                <circle
                  cx={position.x}
                  cy={position.y}
                  r={11}
                  fill="transparent"
                  onPointerDown={(event) =>
                    beginDrag(event, point.id, 'anchor')
                  }
                />
                <circle
                  cx={position.x}
                  cy={position.y}
                  r={selected ? 5 : 3.5}
                  fill={
                    selected
                      ? 'var(--color-accent)'
                      : 'var(--color-panel-raised)'
                  }
                  stroke="var(--color-accent)"
                  strokeWidth={settled ? 2 : 1.5}
                  tabIndex={0}
                  role="button"
                  aria-roledescription="spatial motion path point"
                  aria-label={`${settled ? 'Settled' : index === displayed.points.length - 1 ? 'Hidden start' : `Motion path point ${index + 1}`} at X ${formatCoordinate(point.x)}, Y ${formatCoordinate(point.y)}, Z ${formatCoordinate(point.z)} line heights`}
                  onFocus={() => setSelectedPointId(point.id)}
                  onPointerDown={(event) =>
                    beginDrag(event, point.id, 'anchor')
                  }
                  onKeyDown={(event) => nudge(event, point.id, 'anchor')}
                  style={{ cursor: settled ? 'default' : 'move' }}
                />
              </g>
            )
          })}

          <EndpointLabel point={hiddenPoint} view={view} label="Hidden" />
          <EndpointLabel point={settledPoint} view={view} label="Settled" />
        </svg>
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-text-dim">
        <span>
          Point {selectedNumber}/{displayed.points.length}
        </span>
        <span>{selectedIsSettled ? 'Fixed final position' : `t ${Math.round(selectedPoint.t * 100)}%`}</span>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1.5">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <div key={axis} className="grid min-w-0 gap-1">
            <span className="text-[9px] text-text-dim uppercase">{axis}</span>
            <NumberField
              value={selectedPoint[axis]}
              onCommit={(value) =>
                commit(editSelectedAxis(displayed, axis, value))
              }
              onScrubPreview={(value) => previewAxis(axis, value)}
              onScrubCommit={(value) => commitAxisScrub(axis, value)}
              onScrubCancel={cancelAxisScrub}
              min={-10}
              max={10}
              step={0.1}
              suffix="lh"
              disabled={selectedIsSettled}
              ariaLabel={`Selected motion path point ${axis.toUpperCase()}`}
              width="w-full"
            />
          </div>
        ))}
      </div>
      <p className="mt-2 text-[9px] leading-snug text-text-dim">
        Letters travel from Hidden to Settled. Drag points and handles in XY;
        Z adds depth. Double-click near the path to add a point.
      </p>
    </div>
  )
}

export function TextMotionPathMini({ path }: { path: TextMotionPath }) {
  const width = 64
  const height = 28
  const view = motionPathView(path, 0.12)
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-7 w-16" aria-hidden="true">
      <path
        d={motionPathSvgPath(path, view, width, height, 3, 3, 3, 3)}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {[path.points[0], path.points.at(-1)].map((point, index) => {
        if (!point) return null
        const position = project(point, view, width, height, 3, 3, 3, 3)
        return (
          <circle
            key={point.id}
            cx={position.x}
            cy={position.y}
            r={index === 0 ? 2 : 1.6}
            fill={index === 0 ? 'var(--color-accent)' : 'var(--color-panel-raised)'}
            stroke="var(--color-accent)"
            strokeWidth={1}
          />
        )
      })}
    </svg>
  )
}

function SelectedHandles({
  path,
  point,
  view,
  onPointerDown,
  onKeyDown,
}: {
  path: TextMotionPath
  point: TextMotionPathPoint
  view: MotionPathView
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
  const index = path.points.findIndex((candidate) => candidate.id === point.id)
  const anchor = project(point, view)
  const handles: Array<{
    part: 'in' | 'out'
    position: TextMotionPathPosition
  }> = []
  if (index > 0) {
    handles.push({
      part: 'in',
      position: { x: point.inX, y: point.inY, z: point.inZ },
    })
  }
  if (index < path.points.length - 1) {
    handles.push({
      part: 'out',
      position: { x: point.outX, y: point.outY, z: point.outZ },
    })
  }
  return handles.map((handle) => {
    const position = project(handle.position, view)
    return (
      <g key={handle.part} data-curve-control="handle">
        <line
          x1={anchor.x}
          y1={anchor.y}
          x2={position.x}
          y2={position.y}
          stroke="var(--color-accent)"
          strokeOpacity={0.55}
          strokeWidth={1}
        />
        <circle
          cx={position.x}
          cy={position.y}
          r={10}
          fill="transparent"
          onPointerDown={(event) =>
            onPointerDown(event, point.id, handle.part)
          }
        />
        <circle
          cx={position.x}
          cy={position.y}
          r={3.5}
          fill="var(--color-panel-raised)"
          stroke="var(--color-accent)"
          strokeWidth={1.5}
          tabIndex={0}
          role="button"
          aria-roledescription="motion path handle"
          aria-label={`${handle.part === 'in' ? 'Incoming' : 'Outgoing'} motion path handle at X ${formatCoordinate(handle.position.x)}, Y ${formatCoordinate(handle.position.y)}, Z ${formatCoordinate(handle.position.z)} line heights`}
          onPointerDown={(event) =>
            onPointerDown(event, point.id, handle.part)
          }
          onKeyDown={(event) => onKeyDown(event, point.id, handle.part)}
          style={{ cursor: 'grab' }}
        />
      </g>
    )
  })
}

function EndpointLabel({
  point,
  view,
  label,
}: {
  point: TextMotionPathPoint
  view: MotionPathView
  label: string
}) {
  const position = project(point, view)
  const above = position.y > PAD_T + 14
  return (
    <text
      x={position.x}
      y={position.y + (above ? -8 : 12)}
      textAnchor={position.x > VIEW_W - PAD_R - 32 ? 'end' : position.x < PAD_L + 32 ? 'start' : 'middle'}
      fill="var(--color-text-dim)"
      fontFamily="var(--font-mono, monospace)"
      fontSize={8}
      pointerEvents="none"
    >
      {label}
    </text>
  )
}

function motionPathSvgPath(
  path: TextMotionPath,
  view: MotionPathView,
  width = VIEW_W,
  height = VIEW_H,
  padLeft = PAD_L,
  padRight = PAD_R,
  padTop = PAD_T,
  padBottom = PAD_B,
): string {
  return path.points
    .slice(0, -1)
    .map((point, index) => {
      const next = path.points[index + 1]!
      const p0 = project(point, view, width, height, padLeft, padRight, padTop, padBottom)
      const p1 = project(
        { x: point.outX, y: point.outY },
        view,
        width,
        height,
        padLeft,
        padRight,
        padTop,
        padBottom,
      )
      const p2 = project(
        { x: next.inX, y: next.inY },
        view,
        width,
        height,
        padLeft,
        padRight,
        padTop,
        padBottom,
      )
      const p3 = project(next, view, width, height, padLeft, padRight, padTop, padBottom)
      return `${index === 0 ? `M ${p0.x},${p0.y} ` : ''}C ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`
    })
    .join(' ')
}

function motionPathView(path: TextMotionPath, paddingRatio = 0.16): MotionPathView {
  const xs = [0]
  const ys = [0]
  for (const point of path.points) {
    xs.push(point.x, point.inX, point.outX)
    ys.push(point.y, point.inY, point.outY)
  }
  let minX = Math.min(...xs)
  let maxX = Math.max(...xs)
  let minY = Math.min(...ys)
  let maxY = Math.max(...ys)

  ;[minX, maxX] = ensureSpan(minX, maxX, 2)
  ;[minY, maxY] = ensureSpan(minY, maxY, 3)
  const padX = Math.max(0.2, (maxX - minX) * paddingRatio)
  const padY = Math.max(0.2, (maxY - minY) * paddingRatio)
  return {
    minX: minX - padX,
    maxX: maxX + padX,
    minY: minY - padY,
    maxY: maxY + padY,
  }
}

function ensureSpan(min: number, max: number, minimum: number): [number, number] {
  const span = max - min
  if (span >= minimum) return [min, max]
  const center = (min + max) / 2
  return [center - minimum / 2, center + minimum / 2]
}

function project(
  point: Pick<TextMotionPathPosition, 'x' | 'y'>,
  view: MotionPathView,
  width = VIEW_W,
  height = VIEW_H,
  padLeft = PAD_L,
  padRight = PAD_R,
  padTop = PAD_T,
  padBottom = PAD_B,
): { x: number; y: number } {
  return {
    x:
      padLeft +
      ((point.x - view.minX) / Math.max(1e-9, view.maxX - view.minX)) *
        (width - padLeft - padRight),
    // Motion coordinates use screen semantics: +Y goes down, so unlike a
    // mathematical graph no inversion is needed here.
    y:
      padTop +
      ((point.y - view.minY) / Math.max(1e-9, view.maxY - view.minY)) *
        (height - padTop - padBottom),
  }
}

function pointerToWorld(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  view: MotionPathView,
): TextMotionPathPosition {
  const bounds = svg.getBoundingClientRect()
  const svgX = ((clientX - bounds.left) / Math.max(1, bounds.width)) * VIEW_W
  const svgY = ((clientY - bounds.top) / Math.max(1, bounds.height)) * VIEW_H
  return {
    x:
      view.minX +
      ((svgX - PAD_L) / (VIEW_W - PAD_L - PAD_R)) *
        (view.maxX - view.minX),
    y:
      view.minY +
      ((svgY - PAD_T) / (VIEW_H - PAD_T - PAD_B)) *
        (view.maxY - view.minY),
    z: 0,
  }
}

function gridLines(view: MotionPathView): {
  vertical: number[]
  horizontal: number[]
} {
  return {
    vertical: gridValues(view.minX, view.maxX),
    horizontal: gridValues(view.minY, view.maxY),
  }
}

function gridValues(min: number, max: number): number[] {
  const span = Math.max(1e-9, max - min)
  const roughStep = span / 6
  const power = 10 ** Math.floor(Math.log10(roughStep))
  const normalized = roughStep / power
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
    power
  const values: number[] = []
  const start = Math.ceil(min / step) * step
  for (let value = start; value <= max + step * 1e-6; value += step) {
    values.push(Math.abs(value) < step * 1e-9 ? 0 : value)
  }
  if (min < 0 && max > 0 && !values.some((value) => value === 0)) values.push(0)
  return values.sort((a, b) => a - b)
}

function motionPathSignature(path: TextMotionPath): string {
  return path.points
    .map((point) =>
      [
        point.id,
        point.t,
        point.x,
        point.y,
        point.z,
        point.inX,
        point.inY,
        point.inZ,
        point.outX,
        point.outY,
        point.outZ,
      ].join(':'),
    )
    .join('|')
}

function newMotionPathPointId(): string {
  return `motion-path-point-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function formatCoordinate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
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

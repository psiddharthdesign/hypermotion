// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { NumberField } from '@/ui/fields/NumberField'
import {
  BEZIER_TIMING_Y_MAX,
  BEZIER_TIMING_Y_MIN,
  buildBezierTimingPath,
  clampBezierTiming,
  projectBezierTimingPoint,
  unprojectBezierTimingPoint,
  updateBezierTimingHandle,
  type BezierTimingHandle,
  type BezierTimingValue,
} from '@/ui/bezierTimingEditorMath'

const VIEW_WIDTH = 264
const VIEW_HEIGHT = 144
const GRAPH_BOUNDS = {
  x: 12,
  y: 10,
  width: VIEW_WIDTH - 24,
  height: VIEW_HEIGHT - 26,
}

export interface BezierTimingEditorProps {
  value: BezierTimingValue
  onChange: (next: BezierTimingValue) => void
  disabled?: boolean
}

export function BezierTimingEditor({
  value,
  onChange,
  disabled = false,
}: BezierTimingEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const draggingRef = useRef(false)
  const coordinateScrubOriginRef = useRef<BezierTimingValue | null>(null)
  const [externalX1, externalY1, externalX2, externalY2] = value
  const externalCurve = clampBezierTiming(value)
  const [curve, setCurve] = useState<BezierTimingValue>(externalCurve)
  const curveRef = useRef<BezierTimingValue>(externalCurve)
  const start = projectBezierTimingPoint({ x: 0, y: 0 }, GRAPH_BOUNDS)
  const end = projectBezierTimingPoint({ x: 1, y: 1 }, GRAPH_BOUNDS)
  const first = projectBezierTimingPoint(
    { x: curve[0], y: curve[1] },
    GRAPH_BOUNDS,
  )
  const second = projectBezierTimingPoint(
    { x: curve[2], y: curve[3] },
    GRAPH_BOUNDS,
  )
  const yZero = start.y
  const yOne = end.y

  useEffect(
    () => () => {
      dragCleanupRef.current?.()
    },
    [],
  )

  useEffect(() => {
    if (draggingRef.current) return
    const next = clampBezierTiming([
      externalX1,
      externalY1,
      externalX2,
      externalY2,
    ])
    curveRef.current = next
    setCurve(next)
  }, [externalX1, externalX2, externalY1, externalY2])

  const previewCurve = (next: BezierTimingValue) => {
    curveRef.current = next
    setCurve(next)
  }

  const emitCoordinate = (index: number, nextValue: number) => {
    const next: BezierTimingValue = [...curve]
    next[index] = nextValue
    const clamped = clampBezierTiming(next)
    previewCurve(clamped)
    onChange(clamped)
  }

  const previewCoordinateScrub = (index: number, nextValue: number) => {
    const origin = coordinateScrubOriginRef.current ?? curveRef.current
    coordinateScrubOriginRef.current = origin
    const next: BezierTimingValue = [...origin]
    next[index] = nextValue
    previewCurve(clampBezierTiming(next))
  }

  const commitCoordinateScrub = (index: number, nextValue: number) => {
    const origin = coordinateScrubOriginRef.current ?? curveRef.current
    coordinateScrubOriginRef.current = null
    const next: BezierTimingValue = [...origin]
    next[index] = nextValue
    const clamped = clampBezierTiming(next)
    previewCurve(clamped)
    onChange(clamped)
  }

  const cancelCoordinateScrub = () => {
    const origin = coordinateScrubOriginRef.current
    coordinateScrubOriginRef.current = null
    if (origin) previewCurve(origin)
  }

  const beginDrag = (
    event: ReactPointerEvent<SVGCircleElement>,
    handle: BezierTimingHandle,
  ) => {
    if (disabled || event.button !== 0 || dragCleanupRef.current) return
    const svg = svgRef.current
    if (!svg) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus()
    const pointerId = event.pointerId
    const startingCurve = curve
    draggingRef.current = true
    curveRef.current = curve

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onFinish)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onCancel)
      dragCleanupRef.current = null
    }
    const onMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return
      pointerEvent.preventDefault()
      const rect = svg.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const point = unprojectBezierTimingPoint(
        {
          x:
            ((pointerEvent.clientX - rect.left) / rect.width) *
            VIEW_WIDTH,
          y:
            ((pointerEvent.clientY - rect.top) / rect.height) *
            VIEW_HEIGHT,
        },
        GRAPH_BOUNDS,
      )
      previewCurve(
        updateBezierTimingHandle(
          startingCurve,
          handle,
          point.x,
          point.y,
        ),
      )
    }
    const onFinish = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return
      const next = curveRef.current
      cleanup()
      draggingRef.current = false
      onChange(next)
    }
    const onCancel = (cancelEvent: Event) => {
      if (
        'pointerId' in cancelEvent &&
        cancelEvent.pointerId !== pointerId
      ) {
        return
      }
      cleanup()
      draggingRef.current = false
      previewCurve(startingCurve)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onFinish)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onCancel)
    dragCleanupRef.current = cleanup
  }

  const nudgeHandle = (
    event: ReactKeyboardEvent<SVGCircleElement>,
    handle: BezierTimingHandle,
  ) => {
    if (disabled) return
    const multiplier = event.shiftKey ? 10 : event.altKey ? 0.2 : 1
    const xStep = 0.01 * multiplier
    const yStep = 0.05 * multiplier
    const offset = handle === 1 ? 0 : 2
    const delta =
      event.key === 'ArrowLeft'
        ? { x: -xStep, y: 0 }
        : event.key === 'ArrowRight'
          ? { x: xStep, y: 0 }
          : event.key === 'ArrowUp'
            ? { x: 0, y: yStep }
            : event.key === 'ArrowDown'
              ? { x: 0, y: -yStep }
              : null
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    const next = updateBezierTimingHandle(
      curve,
      handle,
      curve[offset] + delta.x,
      curve[offset + 1] + delta.y,
    )
    previewCurve(next)
    onChange(next)
  }

  return (
    <div
      className={[
        'rounded border border-border bg-panel-raised p-2',
        disabled ? 'opacity-50' : '',
      ].join(' ')}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="h-auto w-full touch-none select-none rounded-md border border-border bg-panel"
        role="group"
        aria-label="Custom cubic Bezier timing curve"
      >
        <rect
          x={GRAPH_BOUNDS.x}
          y={GRAPH_BOUNDS.y}
          width={GRAPH_BOUNDS.width}
          height={Math.max(0, yOne - GRAPH_BOUNDS.y)}
          fill="var(--color-accent)"
          fillOpacity={0.025}
        />
        <rect
          x={GRAPH_BOUNDS.x}
          y={yZero}
          width={GRAPH_BOUNDS.width}
          height={Math.max(
            0,
            GRAPH_BOUNDS.y + GRAPH_BOUNDS.height - yZero,
          )}
          fill="var(--color-accent)"
          fillOpacity={0.025}
        />

        <g stroke="var(--color-border)" strokeWidth={0.75}>
          {[0.25, 0.5, 0.75].map((progress) => (
            <line
              key={progress}
              x1={GRAPH_BOUNDS.x + GRAPH_BOUNDS.width * progress}
              y1={GRAPH_BOUNDS.y}
              x2={GRAPH_BOUNDS.x + GRAPH_BOUNDS.width * progress}
              y2={GRAPH_BOUNDS.y + GRAPH_BOUNDS.height}
              strokeDasharray="2 3"
            />
          ))}
          <line
            x1={GRAPH_BOUNDS.x}
            y1={yZero}
            x2={GRAPH_BOUNDS.x + GRAPH_BOUNDS.width}
            y2={yZero}
          />
          <line
            x1={GRAPH_BOUNDS.x}
            y1={yOne}
            x2={GRAPH_BOUNDS.x + GRAPH_BOUNDS.width}
            y2={yOne}
          />
        </g>

        <line
          x1={start.x}
          y1={start.y}
          x2={first.x}
          y2={first.y}
          stroke="var(--color-accent)"
          strokeOpacity={0.45}
          strokeWidth={1}
        />
        <line
          x1={end.x}
          y1={end.y}
          x2={second.x}
          y2={second.y}
          stroke="var(--color-accent)"
          strokeOpacity={0.45}
          strokeWidth={1}
        />
        <path
          d={buildBezierTimingPath(curve, GRAPH_BOUNDS)}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={start.x} cy={start.y} r={3} fill="var(--color-text-dim)" />
        <circle cx={end.x} cy={end.y} r={3} fill="var(--color-text-dim)" />

        <BezierHandle
          number={1}
          point={first}
          value={curve}
          disabled={disabled}
          onPointerDown={(event) => beginDrag(event, 1)}
          onKeyDown={(event) => nudgeHandle(event, 1)}
        />
        <BezierHandle
          number={2}
          point={second}
          value={curve}
          disabled={disabled}
          onPointerDown={(event) => beginDrag(event, 2)}
          onKeyDown={(event) => nudgeHandle(event, 2)}
        />

        <g
          fill="var(--color-text-dim)"
          fontFamily="var(--font-mono, monospace)"
          fontSize={8}
          aria-hidden="true"
        >
          <text x={GRAPH_BOUNDS.x + 3} y={yZero - 4}>
            0
          </text>
          <text x={GRAPH_BOUNDS.x + 3} y={yOne - 4}>
            1
          </text>
        </g>
      </svg>

      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {([
          ['X1', 0, 0, 1, 'First control point X'],
          [
            'Y1',
            1,
            BEZIER_TIMING_Y_MIN,
            BEZIER_TIMING_Y_MAX,
            'First control point Y',
          ],
          ['X2', 2, 0, 1, 'Second control point X'],
          [
            'Y2',
            3,
            BEZIER_TIMING_Y_MIN,
            BEZIER_TIMING_Y_MAX,
            'Second control point Y',
          ],
        ] as const).map(([label, index, min, max, ariaLabel]) => (
          <div key={label} className="min-w-0">
            <div className="mb-1 text-[9px] font-medium tracking-wide text-text-dim uppercase">
              {label}
            </div>
            <NumberField
              value={curve[index]}
              onCommit={(next) => emitCoordinate(index, next)}
              onScrubPreview={(next) =>
                previewCoordinateScrub(index, next)
              }
              onScrubCommit={(next) =>
                commitCoordinateScrub(index, next)
              }
              onScrubCancel={cancelCoordinateScrub}
              min={min}
              max={max}
              step={0.01}
              ariaLabel={ariaLabel}
              disabled={disabled}
              width="w-full"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function BezierHandle({
  number,
  point,
  value,
  disabled,
  onPointerDown,
  onKeyDown,
}: {
  number: BezierTimingHandle
  point: { x: number; y: number }
  value: BezierTimingValue
  disabled: boolean
  onPointerDown: (event: ReactPointerEvent<SVGCircleElement>) => void
  onKeyDown: (event: ReactKeyboardEvent<SVGCircleElement>) => void
}) {
  const offset = number === 1 ? 0 : 2
  const description = `Control point ${number}, X ${formatValue(value[offset])}, Y ${formatValue(value[offset + 1])}`
  return (
    <circle
      cx={point.x}
      cy={point.y}
      r={7}
      fill="var(--color-panel-raised)"
      stroke="var(--color-accent)"
      strokeWidth={2}
      tabIndex={disabled ? undefined : 0}
      role="slider"
      aria-roledescription="two-dimensional timing handle"
      aria-label={description}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={value[offset]}
      aria-valuetext={`X ${formatValue(value[offset])}, Y ${formatValue(value[offset + 1])}`}
      aria-disabled={disabled}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="outline-none focus:stroke-text"
      style={{ cursor: disabled ? 'not-allowed' : 'grab' }}
    />
  )
}

function formatValue(value: number): string {
  return Number(value.toFixed(2)).toString()
}

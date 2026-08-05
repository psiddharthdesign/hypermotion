// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  EASING_PRESETS,
  MAX_EASING_STRENGTH,
  bezierOf,
  clampEasingStrength,
  type EasingPresetId,
} from '@/anim'
import type { EasingKind } from '@/scene'
import { BezierTimingEditor } from '@/ui/BezierTimingEditor'

/**
 * Jitter-style easing picker.
 *
 * Presented as a grid of preset tiles + a detail strip showing the
 * selected preset's curve preview and a strength slider (0–200).
 *
 * Design choices:
 *   - Preset choice lives OUTSIDE the picker (owner decides what to do
 *     with the resulting EasingKind — it could write to the selected
 *     keyframe's easingOut, or a track's defaultEasing, or a preset
 *     application's default). That keeps the picker reusable.
 *   - Strength is always a 0–200 integer. Each preset interprets it
 *     differently (see easingPresets.ts); from the picker's POV the
 *     only contract is "build(strength) → EasingKind".
 *   - Curve preview is a 60×60 SVG drawn from the bezier control points.
 *     Overshoot presets can dip below 0 or above 1 — the viewBox is
 *     expanded so those strokes don't clip.
 */

export interface EasingPickerProps {
  presetId: EasingPresetId
  strength: number
  onChange: (next: {
    presetId: EasingPresetId
    strength: number
    easing: EasingKind
    source: 'preset' | 'strength' | 'custom'
  }) => void
  /** Title shown above the picker; hidden when null. */
  title?: string | null
  /** Optional subset for contexts where some curves are too noisy. */
  allowedPresetIds?: EasingPresetId[]
  /** Concrete saved curve, used for custom and persisted selections. */
  easingValue?: EasingKind
  /** Differing curves in the current selection. */
  mixed?: boolean
  /** Supporting selection-scope copy beneath the title. */
  description?: string
  disabled?: boolean
}

export function EasingPicker({
  presetId,
  strength,
  onChange,
  title = 'Easing',
  allowedPresetIds,
  easingValue,
  mixed = false,
  description,
  disabled = false,
}: EasingPickerProps) {
  const allowedKey = allowedPresetIds?.join('|') ?? ''
  const presets = useMemo(
    () =>
      allowedPresetIds
        ? EASING_PRESETS.filter((p) => allowedPresetIds.includes(p.id))
        : EASING_PRESETS,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allowedKey],
  )
  const current = presets.find((p) => p.id === presetId) ?? presets[0] ?? EASING_PRESETS[0]!
  const safeStrength = clampEasingStrength(strength)
  const strengthGestureRef = useRef(false)
  const strengthDraftRef = useRef(safeStrength)
  const [strengthDragging, setStrengthDragging] = useState(false)
  const [strengthDraft, setStrengthDraft] = useState(safeStrength)
  const displayStrength = strengthDragging ? strengthDraft : safeStrength
  const easing = strengthDragging
    ? current.build(displayStrength)
    : easingValue ?? current.build(displayStrength)
  const curve = bezierOf(easing)

  useEffect(() => {
    if (strengthGestureRef.current) return
    strengthDraftRef.current = safeStrength
    setStrengthDraft(safeStrength)
  }, [safeStrength])

  const pickPreset = (id: EasingPresetId) => {
    if (disabled) return
    const def = presets.find((p) => p.id === id) ?? current
    const nextEasing =
      id === 'custom'
        ? ({ bezier: curve } as EasingKind)
        : def.build(displayStrength)
    onChange({
      presetId: id,
      strength: displayStrength,
      easing: nextEasing,
      source: 'preset',
    })
  }

  const pickStrength = (n: number) => {
    if (disabled || mixed || presetId === 'custom') return
    const clamped = clampEasingStrength(n)
    onChange({
      presetId,
      strength: clamped,
      easing: current.build(clamped),
      source: 'strength',
    })
  }

  const beginStrengthGesture = (
    event: ReactPointerEvent<HTMLInputElement>,
  ) => {
    if (strengthDisabled) return
    strengthGestureRef.current = true
    strengthDraftRef.current = safeStrength
    setStrengthDraft(safeStrength)
    setStrengthDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const previewStrength = (n: number) => {
    const clamped = clampEasingStrength(n)
    strengthDraftRef.current = clamped
    setStrengthDraft(clamped)
    if (!strengthGestureRef.current) pickStrength(clamped)
  }

  const finishStrengthGesture = (commit: boolean) => {
    if (!strengthGestureRef.current) return
    strengthGestureRef.current = false
    setStrengthDragging(false)
    if (commit) {
      pickStrength(strengthDraftRef.current)
    } else {
      strengthDraftRef.current = safeStrength
      setStrengthDraft(safeStrength)
    }
  }

  const pickCustomCurve = (
    next: [number, number, number, number],
  ) => {
    if (disabled) return
    onChange({
      presetId: 'custom',
      strength: safeStrength,
      easing: { bezier: next },
      source: 'custom',
    })
  }

  const strengthDisabled =
    disabled || mixed || presetId === 'none' || presetId === 'custom'

  return (
    <div className="overflow-hidden rounded-md bg-app-bg shadow-[var(--shadow-control)]">
      {title ? (
        <div className="border-b border-border px-2.5 py-2">
          <div className="text-[12px] font-semibold text-text">
            {title}
          </div>
          {description ? (
            <div className="mt-1 text-[10px] leading-snug text-text-muted">
              {description}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Preset tile grid — 3 columns, compact. */}
      <div className="grid grid-cols-3 gap-1 p-2">
        {presets.map((p) => {
          const active = !mixed && p.id === presetId
          const curveForTile = bezierOf(p.build(displayStrength))
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => pickPreset(p.id)}
              disabled={disabled}
              title={p.hint}
              className={
                'flex flex-col items-stretch gap-1 rounded border px-1.5 py-1.5 text-left transition-colors ' +
                (active
                  ? 'border-accent bg-accent-soft/40 text-text'
                  : 'border-border bg-panel hover:border-border-strong hover:bg-panel-raised text-text-muted') +
                (disabled ? ' cursor-not-allowed opacity-45' : '')
              }
            >
              <CurveMini curve={curveForTile} active={active} />
              <span className="truncate text-[10px] leading-tight">
                {p.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Custom exposes editable control points; named presets use strength. */}
      {presetId === 'custom' && !mixed ? (
        <div className="border-t border-border p-2">
          <div className="mb-2 flex items-baseline justify-between px-0.5">
            <span className="text-[11px] font-medium text-text">
              Custom curve
            </span>
            <span className="text-[9px] text-text-dim">
              Drag handles or enter values
            </span>
          </div>
          <BezierTimingEditor
            value={curve}
            onChange={pickCustomCurve}
            disabled={disabled}
          />
        </div>
      ) : (
        <div className="border-t border-border p-2.5">
          <div className="flex items-start gap-2.5">
            <CurvePreview curve={curve} />
            <div className="flex min-w-0 flex-1 flex-col justify-between">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] font-medium text-text">
                  {mixed ? 'Mixed timing' : current.label}
                </span>
                <span className="font-mono text-[10px] text-text-dim tabular-nums">
                  {mixed
                    ? 'Choose a preset'
                    : strengthDisabled
                      ? '—'
                      : `${Math.round(displayStrength)}%`}
                </span>
              </div>
              <div className="mt-2">
                <input
                  type="range"
                  min={0}
                  max={MAX_EASING_STRENGTH}
                  step={1}
                  value={strengthDisabled ? 0 : displayStrength}
                  disabled={strengthDisabled}
                  onPointerDown={beginStrengthGesture}
                  onPointerUp={() => finishStrengthGesture(true)}
                  onPointerCancel={() => finishStrengthGesture(false)}
                  onBlur={() => finishStrengthGesture(true)}
                  onChange={(e) =>
                    previewStrength(parseInt(e.currentTarget.value, 10))
                  }
                  className="h-1 w-full appearance-none rounded-full bg-border accent-accent disabled:opacity-40"
                />
                <div className="mt-1 flex justify-between font-mono text-[9px] text-text-dim">
                  <span>Soft</span>
                  <span>Extreme</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 60×60 curve preview used in the detail strip. */
function CurvePreview({
  curve,
}: {
  curve: [number, number, number, number]
}) {
  const [x1, y1, x2, y2] = curve
  // ViewBox is (-0.3, -0.3) → (1.3, 1.3) to show overshoot handles going
  // past 0 or 1. Swap y so 0=bottom, 1=top (curves read "upward"). That's
  // the opposite of SVG's default y-down coordinates, so we flip.
  const W = 60
  const H = 60
  const flipY = (y: number) => 1 - y
  const map = (x: number, y: number) =>
    [W * x, H * flipY(y)] as const
  const [sx, sy] = map(0, 0)
  const [ex, ey] = map(1, 1)
  const [c1x, c1y] = map(x1, y1)
  const [c2x, c2y] = map(x2, y2)
  const viewBox = curveViewBox(curve, W, H, 0.2, 0.12)
  return (
    <svg
      width={W}
      height={H}
      viewBox={viewBox}
      className="flex-shrink-0 rounded border border-border bg-panel"
    >
      {/* Bounding box and baseline. */}
      <rect
        x={0}
        y={0}
        width={W}
        height={H}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="0.5"
      />
      <line
        x1={0}
        y1={H}
        x2={W}
        y2={0}
        stroke="currentColor"
        strokeOpacity="0.15"
        strokeDasharray="2 2"
        strokeWidth="0.5"
      />
      {/* Bezier curve. */}
      <path
        d={`M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Control handles. */}
      <line
        x1={sx}
        y1={sy}
        x2={c1x}
        y2={c1y}
        stroke="var(--color-accent-soft)"
        strokeWidth="0.75"
      />
      <line
        x1={ex}
        y1={ey}
        x2={c2x}
        y2={c2y}
        stroke="var(--color-accent-soft)"
        strokeWidth="0.75"
      />
      <circle cx={c1x} cy={c1y} r="1.5" fill="var(--color-accent)" />
      <circle cx={c2x} cy={c2y} r="1.5" fill="var(--color-accent)" />
    </svg>
  )
}

/** Tiny sparkline-style curve used inside each preset tile. */
function CurveMini({
  curve,
  active,
}: {
  curve: [number, number, number, number]
  active: boolean
}) {
  const [x1, y1, x2, y2] = curve
  const W = 48
  const H = 20
  const flipY = (y: number) => 1 - y
  const map = (x: number, y: number) => [W * x, H * flipY(y)] as const
  const [sx, sy] = map(0, 0)
  const [ex, ey] = map(1, 1)
  const [c1x, c1y] = map(x1, y1)
  const [c2x, c2y] = map(x2, y2)
  const viewBox = curveViewBox(curve, W, H, 0.15, 0.18)
  return (
    <svg
      width="100%"
      height={H}
      viewBox={viewBox}
      preserveAspectRatio="none"
      className="h-5 w-full"
    >
      <path
        d={`M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`}
        fill="none"
        stroke={active ? 'var(--color-accent)' : 'currentColor'}
        strokeOpacity={active ? 1 : 0.6}
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Keep endpoints and unbounded value handles visible at strengths up to 200. */
function curveViewBox(
  curve: [number, number, number, number],
  width: number,
  height: number,
  xPadding: number,
  yPadding: number,
): string {
  const [, y1, , y2] = curve
  const ys = [height, 0, height * (1 - y1), height * (1 - y2)]
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const padY = Math.max(height * yPadding, (maxY - minY) * 0.06)
  return [
    -width * xPadding,
    minY - padY,
    width * (1 + xPadding * 2),
    maxY - minY + padY * 2,
  ].join(' ')
}

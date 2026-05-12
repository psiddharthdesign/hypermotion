// SPDX-License-Identifier: Apache-2.0

import { useMemo } from 'react'
import {
  EASING_PRESETS,
  bezierOf,
  type EasingPresetId,
} from '@/anim'
import type { EasingKind } from '@/scene'

/**
 * Jitter-style easing picker.
 *
 * Presented as a grid of preset tiles + a detail strip showing the
 * selected preset's curve preview and a strength slider (0–100).
 *
 * Design choices:
 *   - Preset choice lives OUTSIDE the picker (owner decides what to do
 *     with the resulting EasingKind — it could write to the selected
 *     keyframe's easingOut, or a track's defaultEasing, or a preset
 *     application's default). That keeps the picker reusable.
 *   - Strength is always a 0–100 integer. Each preset interprets it
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
  }) => void
  /** Title shown above the picker; hidden when null. */
  title?: string | null
}

export function EasingPicker({
  presetId,
  strength,
  onChange,
  title = 'Easing',
}: EasingPickerProps) {
  const current = EASING_PRESETS.find((p) => p.id === presetId) ?? EASING_PRESETS[0]!
  const easing = useMemo(() => current.build(strength), [current, strength])
  const curve = useMemo(() => bezierOf(easing), [easing])

  const pickPreset = (id: EasingPresetId) => {
    const def = EASING_PRESETS.find((p) => p.id === id) ?? current
    onChange({ presetId: id, strength, easing: def.build(strength) })
  }

  const pickStrength = (n: number) => {
    const clamped = Math.max(0, Math.min(100, n))
    onChange({ presetId, strength: clamped, easing: current.build(clamped) })
  }

  const strengthDisabled = presetId === 'none'

  return (
    <div className="rounded border border-border bg-panel-raised">
      {title ? (
        <div className="border-b border-border px-2.5 py-1.5 text-[10px] font-medium tracking-wider text-text-dim uppercase">
          {title}
        </div>
      ) : null}

      {/* Preset tile grid — 3 columns, compact. */}
      <div className="grid grid-cols-3 gap-1 p-2">
        {EASING_PRESETS.map((p) => {
          const active = p.id === presetId
          const curveForTile = bezierOf(p.build(strength))
          return (
            <button
              key={p.id}
              onClick={() => pickPreset(p.id)}
              title={p.hint}
              className={
                'flex flex-col items-stretch gap-1 rounded border px-1.5 py-1.5 text-left transition-colors ' +
                (active
                  ? 'border-accent bg-accent-soft/40 text-text'
                  : 'border-border bg-panel hover:border-border-strong hover:bg-panel-raised text-text-muted')
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

      {/* Detail strip: big curve + strength slider. */}
      <div className="border-t border-border p-2.5">
        <div className="flex items-start gap-2.5">
          <CurvePreview curve={curve} />
          <div className="flex min-w-0 flex-1 flex-col justify-between">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-medium text-text">
                {current.label}
              </span>
              <span className="font-mono text-[10px] text-text-dim tabular-nums">
                {strengthDisabled ? '—' : Math.round(strength)}
              </span>
            </div>
            <div className="mt-2">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={strengthDisabled ? 0 : strength}
                disabled={strengthDisabled}
                onChange={(e) => pickStrength(parseInt(e.currentTarget.value, 10))}
                className="h-1 w-full appearance-none rounded-full bg-border accent-accent disabled:opacity-40"
              />
              <div className="mt-1 flex justify-between font-mono text-[9px] text-text-dim">
                <span>Soft</span>
                <span>Strong</span>
              </div>
            </div>
          </div>
        </div>
      </div>
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
  return (
    <svg
      width={W}
      height={H}
      viewBox={`${-W * 0.2} ${-H * 0.2} ${W * 1.4} ${H * 1.4}`}
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
  return (
    <svg
      width="100%"
      height={H}
      viewBox={`${-W * 0.15} ${-H * 0.4} ${W * 1.3} ${H * 1.8}`}
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
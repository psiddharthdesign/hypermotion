// SPDX-License-Identifier: Apache-2.0

import { useMemo, useRef } from 'react'
import type { EasingKind, Track } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { useSceneAPI, useSceneVersion } from '@/scene'
import { useUI } from '@/state/ui'
import { patchStaggerKeyframeBundle } from '@/anim/staggerSets'

/**
 * After-Effects-style value-over-time graph editor.
 *
 * Mounted in the Animate panel whenever the timeline's keyframe
 * selection narrows to keyframes from a single numeric track. The
 * graph plots each keyframe as a control point and each between-
 * keyframe segment as a cubic bezier curve. Bezier handles are
 * draggable — committing one writes back the new
 * `easingOut: { bezier: [x1, y1, x2, y2] }` on the keyframe at the
 * segment's start.
 *
 * Bezier semantics match CSS: the (x1, y1) and (x2, y2) control
 * points live in the segment's local 0..1 box, where x is normalized
 * time (0 at the segment start, 1 at its end) and y is normalized
 * value (0 at the start value, 1 at the end value). For a downward
 * segment (end value < start value), the renderer flips the value
 * axis so an "ease-out" curve still reads as "decelerate to the
 * end value" — same as the engine evaluates it.
 *
 * Limitations (MVP):
 *   - Only numeric tracks. Variant / fill tracks fall back to a
 *     "no graph for this track" message.
 *   - Per-keyframe value editing isn't here yet — the user retimes
 *     keyframes on the timeline; this panel is the easing-curve
 *     editor only. Numeric value editing is on the roadmap (drag
 *     keyframe vertically to change value).
 *   - Spring easings show as their ease-out bezier approximation
 *     (matches what the engine renders).
 */

const VIEW_W = 320
const VIEW_H = 220
const PAD_L = 36
const PAD_R = 12
const PAD_T = 12
const PAD_B = 28

type Pt = { x: number; y: number }

/**
 * Look up the keyframe's easing — falls back to the track default,
 * then to a flat ease-in-out — and decompose it into the four bezier
 * coordinates used by the curve solver. Only cubic-bezier presets
 * and explicit `{ bezier }` values produce real curves; spring +
 * 'linear' fall through to identity-ish defaults.
 */
function bezierCoords(
  easing: EasingKind | undefined,
): [number, number, number, number] {
  const PRESETS: Record<string, [number, number, number, number]> = {
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
    linear: [0, 0, 1, 1],
  }
  if (!easing) return PRESETS['ease-in-out']!
  if (typeof easing === 'string') return PRESETS[easing] ?? PRESETS.linear!
  if ('bezier' in easing) return easing.bezier
  // Spring stub — engine treats as ease-out, surface that here too.
  return PRESETS['ease-out']!
}

/**
 * Decide which keyframes the panel should show curves for. Returns
 * a single {track, keyframes} when:
 *   - the live keyframe selection is non-empty AND
 *   - every selected keyframe lives on the same track AND
 *   - the underlying track is numeric (we can't graph variants).
 *
 * Returns null in every other case (so the panel can fall back to
 * "select keyframes from one track to edit the curve").
 */
export function describeGraphTarget(
  api: SceneAPI,
  selectedKeys: string[],
): { track: Track; keyframes: Track['keyframes'] } | null {
  if (selectedKeys.length === 0) return null
  let trackId: string | null = null
  for (const key of selectedKeys) {
    const sep = key.indexOf(':')
    if (sep < 0) return null
    const tid = key.slice(0, sep)
    if (trackId === null) trackId = tid
    else if (trackId !== tid) return null
  }
  if (!trackId) return null
  const track = api.getTrack(trackId)
  if (!track) return null
  const numeric = track.keyframes.every((k) => typeof k.value === 'number')
  if (!numeric) return null
  // Need at least 2 keyframes to have a segment to ease.
  if (track.keyframes.length < 2) return null
  return { track, keyframes: track.keyframes }
}

export function GraphEditor() {
  // Re-render whenever scene changes so live track edits show up.
  // The version is ALSO threaded into the `target` memo's deps so
  // that after each handle-drag mutation, we re-fetch the track and
  // hand a fresh keyframes array down to GraphSurface. Without that,
  // the memo would keep the stale reference and the curve would
  // appear frozen even though the data underneath had changed —
  // exactly the "handles don't move visually" symptom.
  const version = useSceneVersion()
  const api = useSceneAPI()
  const selectedKeys = useUI((s) => s.selectedKeyframes)
  const target = useMemo(
    () => describeGraphTarget(api, selectedKeys),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, selectedKeys, version],
  )

  if (!target) {
    return (
      <div className="rounded border border-border bg-panel-raised p-3">
        <div className="text-[10px] font-medium tracking-wider text-text-dim uppercase">
          Graph editor
        </div>
        <div className="mt-1.5 text-[11px] text-text-dim leading-snug">
          Select keyframes from a single numeric track on the timeline
          to edit its easing curves with bezier handles. Mirrors the
          After Effects graph editor — drag handles to retune the
          curve, dot positions reflect time × value.
        </div>
      </div>
    )
  }

  return (
    <div className="rounded border border-border bg-panel-raised p-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-medium tracking-wider text-text-dim uppercase">
          Graph editor
        </div>
        <div className="font-mono text-[10px] text-text-dim">
          {humanProperty(target.track.propertyId)} · {target.keyframes.length} kfs
        </div>
      </div>
      <div className="mt-2">
        <GraphSurface track={target.track} api={api} />
      </div>
      <div className="mt-2 text-[10px] leading-snug text-text-dim">
        Drag the bezier handles to retune each segment. Each segment's
        easing belongs to the keyframe at its start, written back as
        a custom cubic-bezier.
      </div>
    </div>
  )
}

/**
 * The actual SVG surface. Plots keyframes in (time, value) space,
 * connects them with bezier paths derived from each keyframe's
 * easingOut, and renders draggable control handles for the two
 * bezier control points per segment.
 */
function GraphSurface({ track, api }: { track: Track; api: SceneAPI }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const kfs = track.keyframes
  // Numeric-only is enforced upstream; this is a safe cast.
  const values = kfs.map((k) => k.value as number)

  // Time + value extents. We pad a hair on the value axis so a flat
  // track (all values equal) still shows a visible curve baseline.
  const tMin = kfs[0]!.time
  const tMax = kfs[kfs.length - 1]!.time
  const tSpan = Math.max(1e-6, tMax - tMin)
  const vMin = Math.min(...values)
  const vMax = Math.max(...values)
  const vSpan = Math.max(1e-6, vMax - vMin)
  const flat = vSpan < 1e-3
  // Visual padding — leave room above and below the curve so handles
  // aren't clipped at the box edges when a segment is steep.
  const vMinPad = flat ? vMin - 1 : vMin - vSpan * 0.15
  const vMaxPad = flat ? vMax + 1 : vMax + vSpan * 0.15

  const innerW = VIEW_W - PAD_L - PAD_R
  const innerH = VIEW_H - PAD_T - PAD_B

  /** Map (time, value) → SVG coords (top-left origin). */
  const project = (t: number, v: number): Pt => {
    const xN = (t - tMin) / tSpan
    const yN = (v - vMinPad) / (vMaxPad - vMinPad)
    return {
      x: PAD_L + xN * innerW,
      // Y axis flipped — high values plot toward the top.
      y: PAD_T + (1 - yN) * innerH,
    }
  }

  /** Inverse of project — used by drag handlers to translate
   * pointer coords back into (time, value) space. */
  const unproject = (sx: number, sy: number): Pt => {
    const xN = (sx - PAD_L) / innerW
    const yN = 1 - (sy - PAD_T) / innerH
    return {
      x: tMin + xN * tSpan,
      y: vMinPad + yN * (vMaxPad - vMinPad),
    }
  }

  // Build SVG path data for the curve and gather handle positions.
  // For each segment i (between kf[i] and kf[i+1]), the bezier
  // control points are positioned at the keyframe's normalized
  // (x1, y1) and (x2, y2) within the segment's local box.
  const segments = useMemo(() => {
    const out: Array<{
      i: number
      p0: Pt
      p1: Pt
      p2: Pt
      p3: Pt
      bz: [number, number, number, number]
    }> = []
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i]!
      const b = kfs[i + 1]!
      const av = a.value as number
      const bv = b.value as number
      const tA = a.time
      const tB = b.time
      const dt = tB - tA
      const dv = bv - av
      const bz = bezierCoords(a.easingOut ?? track.defaultEasing)
      // Bezier control coords in time/value space.
      const p1Time = tA + bz[0] * dt
      const p1Val = av + bz[1] * dv
      const p2Time = tA + bz[2] * dt
      const p2Val = av + bz[3] * dv
      out.push({
        i,
        p0: project(tA, av),
        p1: project(p1Time, p1Val),
        p2: project(p2Time, p2Val),
        p3: project(tB, bv),
        bz,
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kfs, tMin, tSpan, vMinPad, vMaxPad, innerW, innerH])

  /**
   * Drag a single control point. `which` selects p1 or p2 of the
   * segment. We translate pointer movement into a change in the
   * keyframe's easingOut bezier. Time component is clamped to
   * [0, 1] (the bezier x-coord must stay monotonic for the engine
   * to remain invertible); value component is unconstrained, since
   * CSS allows over- and undershoot beziers (>1 or <0).
   *
   * Three subtle bits to get right:
   *
   *   1. Don't call `setPointerCapture` — the captured target is
   *      a child of the SVG, and `setTrack` re-renders the SVG on
   *      every move which can invalidate the capture. Using plain
   *      window listeners + the SVG's bounding rect for hit math
   *      is the bulletproof pattern.
   *
   *   2. Snapshot BOTH bezier coords at drag-start. Otherwise each
   *      move re-derives `cur` from the keyframe's already-updated
   *      easingOut and the un-dragged pair drifts. With a snapshot,
   *      only the dragged pair changes; the other stays put.
   *
   *   3. Look up the latest track from `api` inside `onMove` rather
   *      than closing over the render-time `track` constant. That
   *      way, if the engine re-snapshots between moves, we still
   *      write back to the right track id rather than stomping a
   *      stale shape.
   */
  const onHandleDown = (
    e: React.PointerEvent,
    segIndex: number,
    which: 1 | 2,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const svg = svgRef.current
    if (!svg) return

    // Drag-start snapshots — these stay constant for the whole drag.
    const startKfs = kfs
    const a = startKfs[segIndex]!
    const b = startKfs[segIndex + 1]!
    const av = a.value as number
    const bv = b.value as number
    const tA = a.time
    const tB = b.time
    const dt = Math.max(1e-6, tB - tA)
    const dv = bv - av
    const startBz = bezierCoords(a.easingOut ?? track.defaultEasing)
    const trackId = track.id

    const onMove = (ev: PointerEvent) => {
      ev.preventDefault()
      const rect = svg.getBoundingClientRect()
      // Translate viewport client coords into our SVG viewBox coords.
      const sx = ((ev.clientX - rect.left) / rect.width) * VIEW_W
      const sy = ((ev.clientY - rect.top) / rect.height) * VIEW_H
      const { x: tHere, y: vHere } = unproject(sx, sy)
      // Convert to normalized segment coords (0..1 on the time axis).
      const xn = clamp((tHere - tA) / dt, 0, 1)
      const yn = dv === 0 ? 0 : (vHere - av) / dv
      // Mutate one pair only; the other stays at the drag-start value.
      const next: [number, number, number, number] = [...startBz]
      if (which === 1) {
        next[0] = xn
        next[1] = yn
      } else {
        next[2] = xn
        next[3] = yn
      }
      // Read the latest track from the api so concurrent edits to
      // OTHER keyframes (e.g. someone retiming on the timeline) don't
      // get clobbered when we write our segIndex update.
      const live = api.getTrack(trackId)
      if (!live) return
      const liveKf = live.keyframes[segIndex]
      if (!liveKf) return
      if (
        patchStaggerKeyframeBundle(api, trackId, liveKf.id, {
          easingOut: { bezier: next } as EasingKind,
        })
      ) {
        return
      }
      const updated = {
        ...liveKf,
        easingOut: { bezier: next } as EasingKind,
      }
      const nextKfs = live.keyframes.map((k, i) =>
        i === segIndex ? updated : k,
      )
      api.setTrack({ ...live, keyframes: nextKfs })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Compose the path "d" string. Each segment is a single cubic.
  const pathD = segments
    .map(
      (s, idx) =>
        (idx === 0 ? `M ${s.p0.x},${s.p0.y} ` : '') +
        `C ${s.p1.x},${s.p1.y} ${s.p2.x},${s.p2.y} ${s.p3.x},${s.p3.y}`,
    )
    .join(' ')

  // Y-axis labels: min, mid, max value. Useful so the user can see
  // approximately what value each control point represents.
  const yMid = (vMinPad + vMaxPad) / 2
  const yLabels = [
    { v: vMaxPad, y: PAD_T + 0 },
    { v: yMid, y: PAD_T + innerH / 2 },
    { v: vMinPad, y: PAD_T + innerH },
  ]

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="h-auto w-full select-none rounded border border-border bg-panel"
      role="img"
      aria-label="Easing curve graph"
    >
      {/* Grid */}
      <g stroke="var(--color-border)" strokeWidth={0.5}>
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + innerH} />
        <line
          x1={PAD_L}
          y1={PAD_T + innerH}
          x2={PAD_L + innerW}
          y2={PAD_T + innerH}
        />
        <line
          x1={PAD_L}
          y1={PAD_T + innerH / 2}
          x2={PAD_L + innerW}
          y2={PAD_T + innerH / 2}
          strokeDasharray="2 2"
        />
      </g>
      {/* Axis labels */}
      <g
        fontFamily="var(--font-mono, monospace)"
        fontSize={9}
        fill="var(--color-text-dim)"
      >
        {yLabels.map((l, i) => (
          <text key={i} x={PAD_L - 4} y={l.y + 3} textAnchor="end">
            {formatNumber(l.v)}
          </text>
        ))}
        <text x={PAD_L} y={VIEW_H - 8}>
          {formatNumber(tMin)}s
        </text>
        <text x={PAD_L + innerW} y={VIEW_H - 8} textAnchor="end">
          {formatNumber(tMax)}s
        </text>
      </g>

      {/* Curve */}
      <path
        d={pathD}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={1.5}
      />

      {/* Per-segment control handles */}
      {segments.map((s) => (
        <g key={s.i}>
          {/* Handle lines from anchor to control */}
          <line
            x1={s.p0.x}
            y1={s.p0.y}
            x2={s.p1.x}
            y2={s.p1.y}
            stroke="var(--color-accent)"
            strokeOpacity={0.4}
            strokeWidth={1}
          />
          <line
            x1={s.p3.x}
            y1={s.p3.y}
            x2={s.p2.x}
            y2={s.p2.y}
            stroke="var(--color-accent)"
            strokeOpacity={0.4}
            strokeWidth={1}
          />
          {/* Out-handle of the segment-start keyframe */}
          <circle
            cx={s.p1.x}
            cy={s.p1.y}
            r={4}
            fill="var(--color-panel-raised)"
            stroke="var(--color-accent)"
            strokeWidth={1.5}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => onHandleDown(e, s.i, 1)}
          />
          {/* In-handle of the segment-end keyframe */}
          <circle
            cx={s.p2.x}
            cy={s.p2.y}
            r={4}
            fill="var(--color-panel-raised)"
            stroke="var(--color-accent)"
            strokeWidth={1.5}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => onHandleDown(e, s.i, 2)}
          />
        </g>
      ))}

      {/* Anchor (keyframe) points on top of everything */}
      {kfs.map((kf, i) => {
        const p = project(kf.time, kf.value as number)
        return (
          <rect
            key={kf.id}
            x={p.x - 3.5}
            y={p.y - 3.5}
            width={7}
            height={7}
            transform={`rotate(45 ${p.x} ${p.y})`}
            fill="white"
            stroke="var(--color-accent)"
            strokeWidth={1.5}
          >
            <title>{`kf ${i + 1}: ${formatNumber(kf.time)}s → ${formatNumber(
              kf.value as number,
            )}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 100) return n.toFixed(0)
  if (Math.abs(n) >= 10) return n.toFixed(1)
  return n.toFixed(2)
}

function humanProperty(id: string): string {
  const map: Record<string, string> = {
    'transform.x': 'X',
    'transform.y': 'Y',
    'transform.z': 'Z',
    'transform.rotation': 'Rotation',
    'transform.rotationX': 'Rotate X',
    'transform.rotationY': 'Rotate Y',
    'transform.scaleX': 'Scale X',
    'transform.scaleY': 'Scale Y',
    'appearance.opacity': 'Opacity',
    'appearance.cornerRadius': 'Corner',
    'appearance.fill': 'Fill',
    'text.progress': 'Text Animation',
  }
  return map[id] ?? id
}

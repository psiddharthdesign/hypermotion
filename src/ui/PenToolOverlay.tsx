// SPDX-License-Identifier: Apache-2.0

import type { PenSession } from '@/ui/penToolStore'

const CLOSE_HIT_RADIUS_PX = 8

function segmentPathData(
  start: { x: number; y: number },
  end: { x: number; y: number },
  controlStart?: { x: number; y: number },
  controlEnd?: { x: number; y: number },
): string {
  if (controlStart && controlEnd) {
    return `M ${start.x} ${start.y} C ${controlStart.x} ${controlStart.y} ${controlEnd.x} ${controlEnd.y} ${end.x} ${end.y}`
  }
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`
}

/**
 * Live preview of an in-progress Pen tool path — the committed points and
 * segments drawn so far, a rubber-band line/curve from the last point to
 * the cursor, and a highlighted ring on the first point once there are
 * enough points to close back onto it. Reads directly from `penToolStore`
 * (via the `session` prop, kept in sync by the caller's
 * `useSyncExternalStore`) rather than the scene document — nothing here
 * is a real node yet.
 *
 * Mounted in the same canvas-space coordinate host the rect/ellipse draw
 * tools' own ghost preview already uses (see `drawPreview` in
 * Canvas.tsx) — session points are already in that same space, so no
 * separate projection is needed here.
 */
export function PenToolOverlay({
  session,
  zoom,
}: {
  session: PenSession | null
  zoom: number
}) {
  if (!session) return null
  const item = session.document.items[0]
  if (!item) return null

  const stemWidth = 1.5 / Math.max(zoom, 0.001)
  const dashedWidth = 1 / Math.max(zoom, 0.001)
  const handlePx = 4 / Math.max(zoom, 0.001)
  const firstPoint = item.geometry.points[session.firstPointId]
  const lastPoint = item.geometry.points[session.lastPointId]
  const closeHitRadius = CLOSE_HIT_RADIUS_PX / Math.max(zoom, 0.001)
  const canClose =
    session.lastPointId !== session.firstPointId && !!firstPoint

  const segmentPaths = Object.values(item.geometry.segments).map((segment) => {
    const start = item.geometry.points[segment.startPointId]
    const end = item.geometry.points[segment.endPointId]
    if (!start || !end) return null
    return (
      <path
        key={segment.id}
        d={segmentPathData(start, end, segment.controlStart, segment.controlEnd)}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={stemWidth}
      />
    )
  })

  const anchorDots = Object.values(item.geometry.points).map((point) => (
    <circle
      key={point.id}
      cx={point.x}
      cy={point.y}
      r={handlePx}
      fill={
        point.id === session.firstPointId && canClose
          ? 'var(--color-accent)'
          : 'var(--color-panel)'
      }
      stroke="var(--color-accent)"
      strokeWidth={stemWidth}
    />
  ))

  return (
    <svg
      className="pointer-events-none absolute overflow-visible"
      style={{ left: 0, top: 0, width: 1, height: 1 }}
    >
      {segmentPaths}
      {lastPoint && session.cursor ? (
        <path
          d={segmentPathData(
            lastPoint,
            session.cursor,
            session.pendingOutgoingHandle ?? undefined,
            undefined,
          )}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={dashedWidth}
          strokeDasharray={`${4 / Math.max(zoom, 0.001)} ${3 / Math.max(zoom, 0.001)}`}
        />
      ) : null}
      {anchorDots}
      {canClose && firstPoint ? (
        <circle
          cx={firstPoint.x}
          cy={firstPoint.y}
          r={closeHitRadius}
          fill="none"
          stroke="var(--color-accent)"
          strokeOpacity={0.35}
          strokeWidth={stemWidth}
        />
      ) : null}
    </svg>
  )
}

// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react'
import type { SolvedLayout, Rect } from '@/layout'
import type { NodeId } from '@/scene'
import { useSceneAPI } from '@/scene'
import { useUI } from '@/state/ui'

/**
 * Distance annotations overlay.
 *
 * When the user:
 *   1. has exactly one element selected,
 *   2. holds Alt (Option on macOS),
 *   3. hovers the pointer over another element on the canvas,
 * we draw Figma-style red dashed guides with centered distance pills
 * showing the gap between the selected rect and the element under the
 * cursor. If no element is under the cursor, we fall back to the
 * selected element's parent — the natural "how far is this from the
 * edges of the frame it sits in" measurement.
 *
 * Coordinate space:
 *   All SVG content lives inside the same `canvas` coordinate space as
 *   SelectionOverlay (the caller passes canvasWidth / canvasHeight and
 *   positions this component at the artboard origin). The `zoom` prop
 *   is used to keep stroke widths and label sizes crisp at any zoom —
 *   we divide by zoom the same way SelectionOverlay does.
 *
 * What it draws (per axis):
 *   - Horizontal gap when the two rects do NOT overlap on the X axis:
 *     a dashed line from the near right/left edges with a pill label
 *     showing `{gap}`. Vertical position of the line sits at the
 *     shared overlap on Y (if any) or the midpoint between the rects.
 *   - Symmetric vertical gap on the Y axis.
 *   - When the rects overlap on an axis we skip that axis's line — a
 *     zero gap is uninformative and Figma doesn't draw it either.
 *
 * Listeners are global window listeners because the overlay itself is
 * pointer-events:none (so clicks still hit nodes underneath). The
 * pointer position is derived from the workspace container's client
 * rect, the same inverse transform Canvas uses for clientToCanvas.
 */
export function DistanceOverlay({
  solved,
  canvasWidth,
  canvasHeight,
  zoom,
  workspaceRef,
  view,
  rootId,
}: {
  solved: SolvedLayout
  canvasWidth: number
  canvasHeight: number
  zoom: number
  workspaceRef: React.RefObject<HTMLElement | null>
  view: { panX: number; panY: number; zoom: number }
  rootId: NodeId | null
}) {
  const api = useSceneAPI()
  const selection = useUI((s) => s.selection)
  const [altDown, setAltDown] = useState(false)
  const [pointer, setPointer] = useState<{ clientX: number; clientY: number } | null>(null)
  const hoverNodeRef = useRef<NodeId | null>(null)
  const [hoverNode, setHoverNode] = useState<NodeId | null>(null)

  // Track Alt globally. Using keydown/keyup on window avoids focus
  // issues (a form field having focus shouldn't disable measurements).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt' || e.altKey) setAltDown(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt' || !e.altKey) setAltDown(false)
    }
    const blur = () => setAltDown(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // Track pointer globally while Alt is held. Outside that window we
  // don't need the pointer position, so we avoid the overhead of
  // storing it on every mouse twitch the rest of the time.
  useEffect(() => {
    if (!altDown) {
      setPointer(null)
      setHoverNode(null)
      hoverNodeRef.current = null
      return
    }
    const move = (e: PointerEvent) => {
      setPointer({ clientX: e.clientX, clientY: e.clientY })
      // Hit test — find the nearest [data-node-id] under the cursor.
      // Because this overlay is pointer-events:none, elementFromPoint
      // sees the node DOM directly.
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const nodeEl = el?.closest('[data-node-id]') as HTMLElement | null
      const id = (nodeEl?.dataset.nodeId ?? null) as NodeId | null
      if (id !== hoverNodeRef.current) {
        hoverNodeRef.current = id
        setHoverNode(id)
      }
    }
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [altDown])

  // Early-outs that would have produced nothing to draw anyway.
  const selectedId = selection.length === 1 ? selection[0]! : null
  if (!altDown || !selectedId || !rootId) return null
  if (selectedId === rootId) return null
  const selectedRect = solved[selectedId]
  if (!selectedRect) return null

  // Target = the hover node, or the selected node's parent as a
  // fallback so the user sees *something* useful while roaming over
  // empty canvas. Never measure against the selected node itself.
  let targetId: NodeId | null = hoverNode && hoverNode !== selectedId ? hoverNode : null
  if (!targetId) {
    const node = api.getNode(selectedId)
    targetId = node?.parent ?? null
  }
  if (!targetId || targetId === selectedId) return null
  const targetRect = solved[targetId]
  if (!targetRect) return null

  // Suppress the listed pointer position when it's not over the canvas
  // — avoids ghost hovers when Alt is held during a drag outside the
  // workspace (the pointer listener still fires globally).
  void pointer
  void workspaceRef
  void view

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={canvasWidth}
      height={canvasHeight}
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      style={{ overflow: 'visible' }}
    >
      {renderAnnotations(selectedRect, targetRect, zoom)}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Geometry + rendering
// ---------------------------------------------------------------------------

const RED = '#ff3b5c'
/**
 * Stroke / font sizes are scaled by 1/zoom so they look consistent at
 * any zoom level — a 1px line at 200% zoom should still read as 1px
 * after the CSS transform scale. Same trick Selection overlay uses.
 */
function inv(zoom: number) {
  return 1 / Math.max(zoom, 0.01)
}

interface Annotation {
  kind: 'h' | 'v'
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
}

/**
 * Build the list of distance annotations between two rects.
 *
 * - Horizontal annotation when the rects don't overlap on X (one is
 *   strictly left of the other). Line sits at the midpoint of the
 *   vertical overlap if any, otherwise at the midpoint between the
 *   two rect centers vertically.
 * - Vertical annotation: symmetric on Y.
 *
 * When the rects overlap on an axis, Figma shows "distance from each
 * edge to the corresponding edge" as dual guides — we add those too
 * so contained / overlapping shapes still produce useful readouts.
 */
function buildAnnotations(a: Rect, b: Rect): Annotation[] {
  const out: Annotation[] = []

  // Axis overlap tests. `overlapX` iff projections on X intersect.
  const overlapX = a.x < b.x + b.width && b.x < a.x + a.width
  const overlapY = a.y < b.y + b.height && b.y < a.y + a.height

  // --- Horizontal gap ------------------------------------------------
  if (!overlapX) {
    // Rects are side-by-side. Draw one line between the nearest
    // vertical edges.
    const leftward = a.x > b.x // true if a is to the right of b
    const x1 = leftward ? b.x + b.width : a.x + a.width
    const x2 = leftward ? a.x : b.x
    // Place the line at the y-overlap midpoint (if rects overlap on
    // Y) or the midpoint between rect centers (if they don't).
    const y = overlapY
      ? (Math.max(a.y, b.y) + Math.min(a.y + a.height, b.y + b.height)) / 2
      : (a.y + a.height / 2 + b.y + b.height / 2) / 2
    out.push({
      kind: 'h',
      x1: Math.min(x1, x2),
      y1: y,
      x2: Math.max(x1, x2),
      y2: y,
      label: `${Math.round(Math.abs(x2 - x1))}`,
    })
  } else {
    // Rects overlap on X. Show the distance from each side of `a` to
    // the corresponding side of `b` — non-zero ones only, so shapes
    // that share an edge don't emit a trivial 0px label.
    const leftGap = a.x - b.x
    const rightGap = b.x + b.width - (a.x + a.width)
    const yTop = Math.max(a.y, b.y) - 12 // place above the shared band
    if (Math.abs(leftGap) > 0.5) {
      const x1 = Math.min(a.x, b.x)
      const x2 = Math.max(a.x, b.x)
      out.push({
        kind: 'h',
        x1,
        y1: yTop,
        x2,
        y2: yTop,
        label: `${Math.round(Math.abs(leftGap))}`,
      })
    }
    if (Math.abs(rightGap) > 0.5) {
      const x1 = Math.min(a.x + a.width, b.x + b.width)
      const x2 = Math.max(a.x + a.width, b.x + b.width)
      out.push({
        kind: 'h',
        x1,
        y1: yTop,
        x2,
        y2: yTop,
        label: `${Math.round(Math.abs(rightGap))}`,
      })
    }
  }

  // --- Vertical gap --------------------------------------------------
  if (!overlapY) {
    const upward = a.y > b.y
    const y1 = upward ? b.y + b.height : a.y + a.height
    const y2 = upward ? a.y : b.y
    const x = overlapX
      ? (Math.max(a.x, b.x) + Math.min(a.x + a.width, b.x + b.width)) / 2
      : (a.x + a.width / 2 + b.x + b.width / 2) / 2
    out.push({
      kind: 'v',
      x1: x,
      y1: Math.min(y1, y2),
      x2: x,
      y2: Math.max(y1, y2),
      label: `${Math.round(Math.abs(y2 - y1))}`,
    })
  } else {
    const topGap = a.y - b.y
    const bottomGap = b.y + b.height - (a.y + a.height)
    const xLeft = Math.max(a.x, b.x) - 12
    if (Math.abs(topGap) > 0.5) {
      const y1 = Math.min(a.y, b.y)
      const y2 = Math.max(a.y, b.y)
      out.push({
        kind: 'v',
        x1: xLeft,
        y1,
        x2: xLeft,
        y2,
        label: `${Math.round(Math.abs(topGap))}`,
      })
    }
    if (Math.abs(bottomGap) > 0.5) {
      const y1 = Math.min(a.y + a.height, b.y + b.height)
      const y2 = Math.max(a.y + a.height, b.y + b.height)
      out.push({
        kind: 'v',
        x1: xLeft,
        y1,
        x2: xLeft,
        y2,
        label: `${Math.round(Math.abs(bottomGap))}`,
      })
    }
  }

  return out
}

/**
 * Render one annotation: a dashed red line with small perpendicular
 * end-caps, plus a filled red pill containing the distance label. Line
 * stroke + end-caps + label all scale by 1/zoom so they stay readable
 * across the full zoom range.
 *
 * The target rect's outline is drawn separately (see renderAnnotations)
 * in solid red so the user knows which element they're measuring to.
 */
function renderAnnotations(a: Rect, b: Rect, zoom: number): React.ReactNode {
  const stroke = Math.max(1 * inv(zoom), 0.5)
  const fontSize = Math.max(10 * inv(zoom), 6)
  const pillPadX = 4 * inv(zoom)
  const pillPadY = 2 * inv(zoom)
  const dash = `${4 * inv(zoom)} ${3 * inv(zoom)}`
  const capLen = 5 * inv(zoom)

  const annotations = buildAnnotations(a, b)

  return (
    <g>
      {/* Target outline — tells the user "this is the element you're
          measuring *to*". Matches Figma, where the hovered element
          gets a red selection tint while Alt is held. */}
      <rect
        x={b.x}
        y={b.y}
        width={b.width}
        height={b.height}
        fill="none"
        stroke={RED}
        strokeWidth={stroke}
        strokeOpacity={0.8}
        pointerEvents="none"
      />
      {annotations.map((a, i) => {
        const cx = (a.x1 + a.x2) / 2
        const cy = (a.y1 + a.y2) / 2
        // End-caps are short perpendicular strokes that make the line
        // read as a "to" arrow without the fuss of SVG markers.
        const caps =
          a.kind === 'h'
            ? [
                { x1: a.x1, y1: a.y1 - capLen, x2: a.x1, y2: a.y1 + capLen },
                { x1: a.x2, y1: a.y2 - capLen, x2: a.x2, y2: a.y2 + capLen },
              ]
            : [
                { x1: a.x1 - capLen, y1: a.y1, x2: a.x1 + capLen, y2: a.y1 },
                { x1: a.x2 - capLen, y1: a.y2, x2: a.x2 + capLen, y2: a.y2 },
              ]
        // Label sizing is a rough function of character count — SVG
        // has no auto-fit without measureText, and eyeballing 6.5px
        // per digit at 10px type works well enough.
        const charW = fontSize * 0.65
        const textW = a.label.length * charW
        const pillW = textW + pillPadX * 2
        const pillH = fontSize + pillPadY * 2
        const pillX = cx - pillW / 2
        const pillY = cy - pillH / 2

        return (
          <g key={i}>
            <line
              x1={a.x1}
              y1={a.y1}
              x2={a.x2}
              y2={a.y2}
              stroke={RED}
              strokeWidth={stroke}
              strokeDasharray={dash}
            />
            {caps.map((c, j) => (
              <line
                key={j}
                x1={c.x1}
                y1={c.y1}
                x2={c.x2}
                y2={c.y2}
                stroke={RED}
                strokeWidth={stroke}
              />
            ))}
            <rect
              x={pillX}
              y={pillY}
              width={pillW}
              height={pillH}
              rx={pillH / 2}
              ry={pillH / 2}
              fill={RED}
            />
            <text
              x={cx}
              y={cy}
              fill="#fff"
              fontSize={fontSize}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              textAnchor="middle"
              dominantBaseline="central"
              style={{ userSelect: 'none' }}
            >
              {a.label}
            </text>
          </g>
        )
      })}
    </g>
  )
}
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useRef } from 'react'
import { useSceneAPI } from '@/scene'
import type { NodeId, SizeAxis } from '@/scene'
import { useUI } from '@/state/ui'
import {
  recordKeyframesForPatch,
  stampToActiveTracksForPatch,
} from '@/anim'

/**
 * Eight-handle resize gizmo overlaid on a selected node.
 *
 * Handles are screen-pixels at any zoom — we divide by workspace zoom
 * so they stay grabbable when you zoom out. Drag math: pointer delta is
 * divided by zoom to convert workspace-pixels to canvas-pixels, then
 * fed into a {dx, dy, dw, dh} transform based on which handle is
 * grabbed. The NW handle, for example, moves the top-left corner:
 * width decreases by dx, x grows by dx. The E handle only changes
 * width. And so on.
 *
 * Resize writes to `size.width` / `size.height` as numbers. If the
 * current size token is 'hug' or 'fill', we capture the solved rect's
 * width/height at drag-start as the numeric base — drags always
 * commit back as numbers. The user can flip back to hug/fill from the
 * Inspector afterwards.
 *
 * We DON'T touch `transform.x` / `transform.y` on resize. If this node
 * is inside a flex/grid parent, its rendered position is whatever Yoga
 * computes; updating transform.x wouldn't actually move the NW corner
 * of the rect. This matches Figma: resize commands a size, Yoga picks
 * the final placement.
 *
 * Caveat: rotation is not respected. Dragging NE on a rotated node
 * doesn't rotate the drag axis. Good enough for MVP. We'll revisit
 * when Step 4.5 brings real gizmo rendering in Pixi.
 */

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export function ResizeHandles({
  nodeId,
  rectWidth,
  rectHeight,
  zoom,
}: {
  nodeId: NodeId
  rectWidth: number
  rectHeight: number
  zoom: number
}) {
  const api = useSceneAPI()
  const dragRef = useRef<{
    handle: HandleId
    pointerId: number
    startX: number
    startY: number
    w0: number
    h0: number
  } | null>(null)

  const startDrag = useCallback(
    (handle: HandleId) => (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const node = api.getNode(nodeId)
      if (!node || !('size' in node) || node.locked) return

      // Seed the drag from the rendered rect. If the stored size is a
      // number, that matches rect; if it's hug/fill, rect is what the
      // user sees and dragging from the visible size is what they
      // expect.
      dragRef.current = {
        handle,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        w0: rectWidth,
        h0: rectHeight,
      }
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current
        if (!d || ev.pointerId !== d.pointerId) return
        const z = useUI.getState().view.zoom || 1
        const dx = (ev.clientX - d.startX) / z
        const dy = (ev.clientY - d.startY) / z

        // Figure out which directions change width / height. +1 means
        // dragging this handle in that direction grows the dimension.
        let wSign = 0
        let hSign = 0
        if (d.handle === 'e' || d.handle === 'ne' || d.handle === 'se') wSign = 1
        if (d.handle === 'w' || d.handle === 'nw' || d.handle === 'sw') wSign = -1
        if (d.handle === 's' || d.handle === 'se' || d.handle === 'sw') hSign = 1
        if (d.handle === 'n' || d.handle === 'ne' || d.handle === 'nw') hSign = -1

        const nextW = Math.max(1, d.w0 + dx * wSign)
        const nextH = Math.max(1, d.h0 + dy * hSign)

        const current = api.getNode(nodeId)
        if (!current || !('size' in current)) return

        // Only write axes the handle affects. An E-handle drag
        // shouldn't collapse a 'hug' height into a fixed number.
        const patch: { width?: SizeAxis; height?: SizeAxis } = {}
        if (wSign !== 0) patch.width = nextW
        if (hSign !== 0) patch.height = nextH
        if (Object.keys(patch).length === 0) return

        api.setNodeProperty(nodeId, 'size', {
          ...current.size,
          ...patch,
        })
      }

      const onUp = (ev: PointerEvent) => {
        const d = dragRef.current
        if (!d || ev.pointerId !== d.pointerId) return
        try {
          el.releasePointerCapture(d.pointerId)
        } catch {
          // pointer may already be released by the browser
        }
        // Commit on pointerup so the whole resize is one keyframe, not
        // one per pointermove tick.
        //   - recording=on  → stamp regardless (creates tracks if needed)
        //   - recording=off → only stamp on tracks the user already
        //                     authored, otherwise the static-value
        //                     update is invisibly stomped by the track
        //                     under REPLACE semantics.
        const ui = useUI.getState()
        const current = api.getNode(nodeId)
        if (current && 'size' in current) {
          const patch: Record<string, unknown> = {}
          // Only record axes that could have changed (the drag math
          // knows via handle orientation, but at this point we're
          // past that — commit whatever numeric values were written).
          if (typeof current.size.width === 'number') {
            patch.width = current.size.width
          }
          if (typeof current.size.height === 'number') {
            patch.height = current.size.height
          }
          if (Object.keys(patch).length > 0) {
            if (ui.recording) {
              recordKeyframesForPatch(api, nodeId, ui.playhead, 'size', patch)
            } else {
              stampToActiveTracksForPatch(
                api,
                nodeId,
                ui.playhead,
                'size',
                patch,
              )
            }
          }
        }
        dragRef.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [api, nodeId, rectWidth, rectHeight],
  )

  const size = 8 / Math.max(zoom, 0.001)
  const half = size / 2

  // Each handle sits at its anchor; we center via translate(-50%, -50%)
  // so positioning numbers read naturally ("top-right = right: 0, top: 0").
  const handles: Array<{ id: HandleId; style: React.CSSProperties; cursor: string }> = [
    { id: 'nw', style: { left: -half, top: -half }, cursor: 'nwse-resize' },
    { id: 'n', style: { left: '50%', top: -half, marginLeft: -half }, cursor: 'ns-resize' },
    { id: 'ne', style: { right: -half, top: -half }, cursor: 'nesw-resize' },
    { id: 'e', style: { right: -half, top: '50%', marginTop: -half }, cursor: 'ew-resize' },
    { id: 'se', style: { right: -half, bottom: -half }, cursor: 'nwse-resize' },
    { id: 's', style: { left: '50%', bottom: -half, marginLeft: -half }, cursor: 'ns-resize' },
    { id: 'sw', style: { left: -half, bottom: -half }, cursor: 'nesw-resize' },
    { id: 'w', style: { left: -half, top: '50%', marginTop: -half }, cursor: 'ew-resize' },
  ]

  return (
    <>
      {handles.map((h) => (
        <div
          key={h.id}
          onPointerDown={startDrag(h.id)}
          className="absolute bg-panel"
          style={{
            width: size,
            height: size,
            pointerEvents: 'auto',
            cursor: h.cursor,
            border: `${1 / Math.max(zoom, 0.001)}px solid var(--color-accent)`,
            borderRadius: 1,
            // Handles sit ABOVE the outline so clicks land on them first.
            zIndex: 2,
            ...h.style,
          }}
        />
      ))}
    </>
  )
}
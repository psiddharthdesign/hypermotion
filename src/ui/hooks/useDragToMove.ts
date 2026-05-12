// SPDX-License-Identifier: Apache-2.0

import { useCallback, useRef } from 'react'
import { useSceneAPI } from '@/scene'
import type { NodeId } from '@/scene'
import { useUI } from '@/state/ui'
import {
  recordKeyframesForPatch,
  stampToActiveTracksForPatch,
} from '@/anim'

/**
 * Pointer-driven drag-to-move for a single scene node.
 *
 * On pointerdown the hook selects the node and captures the pointer on
 * the element so subsequent move / up events keep firing even when the
 * cursor leaves the node's bounds. Delta pixels are divided by the
 * current workspace zoom so "one pixel on screen" stays "one pixel on
 * screen" at any zoom level.
 *
 * What moves: `transform.x` and `transform.y` — the animatable
 * post-layout offset. The scene's structural position (rect.x, rect.y
 * from Yoga) is never mutated by drag. That's the whole point of the
 * split: designers can nudge a layer out of its slot without breaking
 * the auto-layout relationship.
 *
 * When drag is *blocked* (flow child inside a flex/grid parent), the
 * hook still handles selection on pointerdown but silently ignores
 * the move deltas. This matches Figma: clicking a flow item inside
 * auto-layout selects it but dragging it doesn't let it escape its
 * slot — users have to flip it to 'absolute' first (Inspector toggle)
 * or drag from the layer panel to reorder. The alternative — freely
 * moving the transform — produced the exact "text floats away from
 * auto-layout" bug users complained about.
 *
 * Disabled when `isRoot` is true — the scene frame itself is positioned
 * by the canvas box, not by a transform offset, and dragging it would
 * only confuse things.
 */
export function useDragToMove(nodeId: NodeId, isRoot: boolean) {
  const api = useSceneAPI()
  const setSelection = useUI((s) => s.setSelection)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    tx0: number
    ty0: number
    moved: boolean
  } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      if (isRoot) return
      const node = api.getNode(nodeId)
      if (!node || node.locked) return
      // Selecting on pointerdown (not click) matches Figma's feel —
      // the selection frame appears before you've released the mouse.
      //
      // Multi-select on canvas: shift/cmd-pointerdown TOGGLES the node
      // in the existing selection instead of replacing it. Without this,
      // a designer holding shift to add a third node was actually losing
      // their first two — which broke "select these and change them
      // together" cold. Plain pointerdown still replaces selection
      // (Figma parity).
      const additive = e.shiftKey || e.metaKey || e.ctrlKey
      if (additive) {
        useUI.getState().toggleInSelection(nodeId, true)
      } else {
        const current = useUI.getState().selection
        // If the node is already part of the active selection, leave the
        // selection alone — that lets the user drag a multi-selection as
        // a group without dropping every other node on pointerdown.
        if (!current.includes(nodeId)) setSelection([nodeId])
      }

      // Decide upfront whether this pointer session is allowed to
      // translate the transform. Flow children under a flex/grid
      // parent stay pinned to their Yoga slot — the layout owns their
      // position. Any other case (absolute child, or parent with no
      // layout mode at all) behaves like the free canvas and moves.
      const parent = node.parent ? api.getNode(node.parent) : null
      const parentMode =
        parent && 'layout' in parent ? parent.layout.mode : 'none'
      const moveAllowed = node.position === 'absolute' || parentMode === 'none'

      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        tx0: node.transform.x,
        ty0: node.transform.y,
        moved: false,
      }
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current
        if (!d || ev.pointerId !== d.pointerId) return
        if (!moveAllowed) return // selection-only drag inside auto-layout
        const zoom = useUI.getState().view.zoom || 1
        const dx = (ev.clientX - d.startX) / zoom
        const dy = (ev.clientY - d.startY) / zoom
        if (!d.moved && Math.hypot(dx, dy) < 2) return
        d.moved = true
        const current = api.getNode(nodeId)
        if (!current) return
        api.setNodeProperty(nodeId, 'transform', {
          ...current.transform,
          x: d.tx0 + dx,
          y: d.ty0 + dy,
        })
      }

      const onUp = (ev: PointerEvent) => {
        const d = dragRef.current
        if (!d || ev.pointerId !== d.pointerId) return
        el.releasePointerCapture(d.pointerId)
        // Record-mode commit: the drag is a single edit from the user's
        // point of view, so we stamp one keyframe on pointerup (not on
        // every move tick) — matches how AE's stopwatch treats a drag.
        if (d.moved) {
          const ui = useUI.getState()
          const current = api.getNode(nodeId)
          if (current) {
            const patch = {
              x: current.transform.x,
              y: current.transform.y,
            }
            if (ui.recording) {
              // Record mode — stamp regardless of existing tracks.
              recordKeyframesForPatch(
                api,
                nodeId,
                ui.playhead,
                'transform',
                patch,
              )
            } else {
              // Otherwise, follow whichever transform.x/y tracks the user
              // already authored. Without this, dragging a layer with an
              // active position track silently fails — the static value
              // updates but the track stomps it on the next frame.
              stampToActiveTracksForPatch(
                api,
                nodeId,
                ui.playhead,
                'transform',
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
    [api, isRoot, nodeId, setSelection],
  )

  return { onPointerDown }
}
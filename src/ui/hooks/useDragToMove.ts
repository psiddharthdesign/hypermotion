// SPDX-License-Identifier: Apache-2.0

import { useCallback, useRef } from 'react'
import { useSceneAPI } from '@/scene'
import type { NodeId } from '@/scene'
import { useUI } from '@/state/ui'
import { canMoveChildOnCanvas } from '@/ui/canvasMove'
import {
  getAnimEngine,
  recordKeyframesForPatch,
  stampToActiveTracksForPatch,
} from '@/anim'
import {
  commitNodeTransformPreviews,
  nodeTransformDragOrigin,
  nodeTransformPreviewStore,
  type NodeTransformPreview,
} from '@/ui/nodeTransformPreviewStore'

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
    staticOffsetX: number
    staticOffsetY: number
    authorOffsetX: number
    authorOffsetY: number
    latest: NodeTransformPreview
    moved: boolean
  } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      if (isRoot) return
      const node = api.getNode(nodeId)
      if (!node || node.locked) return
      e.stopPropagation()
      // Selecting on pointerdown (not click) matches Figma's feel —
      // the selection frame appears before you've released the mouse.
      //
      // Shift remains the additive canvas modifier. Command/Ctrl is the
      // direct-selection modifier: because each NodeView is flattened into
      // paint order, the event target is the deepest visible child under the
      // pointer. Replace the selection with that child instead of toggling it
      // into a possibly unrelated multi-selection. Command/Ctrl+Shift still
      // extends the current selection with the directly hit child.
      if (e.shiftKey) {
        useUI.getState().toggleInSelection(nodeId, true)
      } else if (e.metaKey || e.ctrlKey) {
        setSelection([nodeId])
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
      const moveAllowed = canMoveChildOnCanvas(node.position, parentMode)
      const engineValue = getAnimEngine().getSnapshot()[nodeId]
      const origin = nodeTransformDragOrigin(node, engineValue)
      const tx0 = origin.display.x
      const ty0 = origin.display.y

      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        tx0,
        ty0,
        staticOffsetX: origin.static.x - origin.display.x,
        staticOffsetY: origin.static.y - origin.display.y,
        authorOffsetX: origin.author.x - origin.display.x,
        authorOffsetY: origin.author.y - origin.display.y,
        latest: { x: tx0, y: ty0 },
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
        d.latest = {
          x: d.tx0 + dx,
          y: d.ty0 + dy,
        }
        nodeTransformPreviewStore.preview({ [nodeId]: d.latest })
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
          commitNodeTransformPreviews(
            api,
            {
              [nodeId]: {
                x: d.latest.x + d.staticOffsetX,
                y: d.latest.y + d.staticOffsetY,
              },
            },
            (committedNodeId) => {
              const authorPatch = {
                x: d.latest.x + d.authorOffsetX,
                y: d.latest.y + d.authorOffsetY,
              }
              if (ui.recording) {
                // Record mode — stamp regardless of existing tracks.
                recordKeyframesForPatch(
                  api,
                  committedNodeId,
                  ui.playhead,
                  'transform',
                  authorPatch,
                )
              } else {
                // Otherwise, follow whichever transform.x/y tracks the user
                // already authored. Without this, dragging a layer with an
                // active position track silently fails — the static value
                // updates but the track stomps it on the next frame.
                stampToActiveTracksForPatch(
                  api,
                  committedNodeId,
                  ui.playhead,
                  'transform',
                  authorPatch,
                )
              }
            },
          )
          nodeTransformPreviewStore.finish()
        } else {
          nodeTransformPreviewStore.clear()
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

// SPDX-License-Identifier: Apache-2.0

import { useUI } from '@/state/ui'
import { useSceneAPI, useSceneVersion } from '@/scene'
import type { NodeId } from '@/scene'
import type { SolvedLayout } from '@/layout'
import type { AnimatedValue } from '@/ui/hooks/useAnimatedValues'
import type { InheritedAnim } from '@/ui/Canvas'
import { ResizeHandles } from '@/ui/ResizeHandles'

/**
 * Selection frame overlay.
 *
 * Renders a 1px accent outline around each selected node, composited
 * on top of the rendered scene. The outline lives on its own layer
 * (outside `overflow:hidden` parents) so it stays visible even if a
 * node hits the edge of its clipping frame.
 *
 * Outline width is divided by the workspace zoom so the line stays
 * visually 1.5px at any zoom level — without this, zooming out makes
 * it vanish, zooming in makes it fat.
 */
export function SelectionOverlay({
  solved,
  animated,
  inherited,
  zoom,
}: {
  solved: SolvedLayout
  animated: Record<NodeId, AnimatedValue>
  inherited: Record<NodeId, InheritedAnim>
  zoom: number
}) {
  useSceneVersion()
  const api = useSceneAPI()
  const selection = useUI((s) => s.selection)
  const rootId = api.getRoot()

  if (selection.length === 0) return null

  const strokeWidth = 1.5 / Math.max(zoom, 0.001)
  // Only show resize handles for a single, non-root, unlocked
  // resizable node. Multi-select handles are a post-MVP exercise
  // (need a union-bbox gizmo). Root's size is driven by the Scene
  // inspector's Width / Height.
  const singleSelection =
    selection.length === 1 ? selection[0]! : null
  const handleNode = singleSelection ? api.getNode(singleSelection) : null
  const showHandles =
    !!handleNode &&
    handleNode.id !== rootId &&
    !handleNode.locked &&
    'size' in handleNode

  return (
    <>
      {selection.map((id) => {
        const rect = solved[id]
        const node = api.getNode(id)
        if (!rect || !node) return null
        const isRoot = id === rootId
        const anim = animated[id]
        const inh = inherited[id]
        // Root is painted identity by the canvas; skip transform on
        // its selection outline so the two stay in sync. For non-root
        // nodes we compose under REPLACE semantics: the own transform
        // picks animated when a track exists, static otherwise, and the
        // inherited ancestor offset still composes additively (it's the
        // accumulated contribution from every ancestor, not a replacement).
        const ownX = anim?.x ?? node.transform.x
        const ownY = anim?.y ?? node.transform.y
        const ownRot = anim?.rotation ?? node.transform.rotation
        const ownSX = anim?.scaleX ?? node.transform.scaleX
        const ownSY = anim?.scaleY ?? node.transform.scaleY
        const tx = isRoot ? 0 : ownX + (inh?.x ?? 0)
        const ty = isRoot ? 0 : ownY + (inh?.y ?? 0)
        const rotation = isRoot ? 0 : ownRot + (inh?.rotation ?? 0)
        const sx = isRoot ? 1 : ownSX * (inh?.scaleX ?? 1)
        const sy = isRoot ? 1 : ownSY * (inh?.scaleY ?? 1)

        const parts: string[] = []
        if (tx !== 0 || ty !== 0) parts.push(`translate(${tx}px, ${ty}px)`)
        if (rotation !== 0) parts.push(`rotate(${rotation}deg)`)
        if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`)
        const transform = parts.length > 0 ? parts.join(' ') : undefined

        const isSingle = singleSelection === id

        return (
          <div
            key={id}
            // Container itself is click-through; only the handles catch
            // pointer events. Without this the outline would swallow
            // drags aimed at the node underneath.
            className="pointer-events-none absolute"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              transform,
              transformOrigin: 'center center',
              outline: `${strokeWidth}px solid var(--color-accent)`,
              outlineOffset: `${0.5 / Math.max(zoom, 0.001)}px`,
              // Subtle corner ticks make the selection read at a glance
              // even on tiny nodes at high zoom. 6px at 1x, scaled.
              boxShadow: `0 0 0 ${strokeWidth / 3}px var(--color-accent-soft) inset`,
            }}
          >
            {isSingle && showHandles ? (
              <ResizeHandles
                nodeId={id}
                rectWidth={rect.width}
                rectHeight={rect.height}
                zoom={zoom}
              />
            ) : null}
          </div>
        )
      })}
    </>
  )
}
// SPDX-License-Identifier: Apache-2.0

import { useSyncExternalStore } from 'react'
import { useUI } from '@/state/ui'
import { useSceneAPI, useSceneVersion } from '@/scene'
import type { NodeId, SceneAPI } from '@/scene'
import type { SolvedLayout } from '@/layout'
import type { AnimatedValue } from '@/ui/hooks/useAnimatedValues'
import type { InheritedAnim } from '@/ui/canvasRenderHelpers'
import { ResizeHandles } from '@/ui/ResizeHandles'
import { VectorEditOverlay } from '@/ui/VectorEditOverlay'
import { isEditableVectorNode } from '@/scene'
import { nodeGeometryPreviewStore } from '@/ui/nodeGeometryPreviewStore'
import { nodeGeometryPreviewRect } from '@/ui/nodeGeometryPreviewRect'
import {
  isDeviceMockupRoot,
  mockupGhostColors,
} from '@/scene/builtins/deviceMockups'

function isEffectivelyVisible(api: SceneAPI, id: NodeId): boolean {
  const visited = new Set<NodeId>()
  let node = api.getNode(id)
  while (node) {
    if (!node.visible) return false
    if (!node.parent || visited.has(node.parent)) return true
    visited.add(node.id)
    node = api.getNode(node.parent)
  }
  return false
}

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
  rootId: rootIdOverride,
}: {
  solved: SolvedLayout
  animated: Record<NodeId, AnimatedValue>
  inherited: Record<NodeId, InheritedAnim>
  zoom: number
  rootId?: NodeId | null
}) {
  useSceneVersion()
  const api = useSceneAPI()
  const selection = useUI((s) => s.selection)
  const editingVectorId = useUI((s) => s.editingVectorId)
  const geometryPreview = useSyncExternalStore(
    nodeGeometryPreviewStore.subscribe,
    nodeGeometryPreviewStore.getSnapshot,
    nodeGeometryPreviewStore.getSnapshot,
  )
  const rootId = rootIdOverride ?? api.getRoot()

  if (selection.length === 0) return null

  const strokeWidth = 1.5 / Math.max(zoom, 0.001)
  // Only show resize handles for a single, non-root, unlocked
  // resizable node. Multi-select handles are a post-MVP exercise
  // (need a union-bbox gizmo). Root's size is driven by the Scene
  // inspector's Width / Height.
  const singleSelection =
    selection.length === 1 ? selection[0]! : null
  const handleNode = singleSelection ? api.getNode(singleSelection) : null
  const editingVector =
    handleNode &&
    handleNode.id === editingVectorId &&
    isEditableVectorNode(handleNode)
      ? handleNode
      : null
  const showHandles =
    !!handleNode &&
    handleNode.id !== rootId &&
    !handleNode.locked &&
    'size' in handleNode &&
    !editingVector

  return (
    <>
      {selection.map((id) => {
        const baseRect = solved[id]
        const node = api.getNode(id)
        // A hidden layer must not leave selection chrome behind. This also
        // covers a visible child whose parent was hidden in the Layers panel.
        if (!baseRect || !node || !isEffectivelyVisible(api, id)) return null
        const rect = nodeGeometryPreviewRect(
          node,
          baseRect,
          geometryPreview[id],
        )
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
        const anchorX = isRoot ? 0.5 : anim?.anchorX ?? node.transform.anchorX ?? 0.5
        const anchorY = isRoot ? 0.5 : anim?.anchorY ?? node.transform.anchorY ?? 0.5
        const anchorZ = isRoot ? 0 : anim?.anchorZ ?? node.transform.anchorZ ?? 0
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
        const outlineColor = 'var(--color-accent)'
        const outlineSoft = 'var(--color-accent-soft)'

        return (
          <div
            key={id}
            // Container itself is click-through; only the handles catch
            // pointer events. Without this the outline would swallow
            // drags aimed at the node underneath.
            className="pointer-events-none absolute"
            data-selection-node={id}
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              transform,
              transformOrigin: `${Number((anchorX * 100).toFixed(3))}% ${Number((anchorY * 100).toFixed(3))}% ${Number(anchorZ.toFixed(3))}px`,
              outline: `${strokeWidth}px solid ${outlineColor}`,
              outlineOffset: `${0.5 / Math.max(zoom, 0.001)}px`,
              // Subtle corner ticks make the selection read at a glance
              // even on tiny nodes at high zoom. 6px at 1x, scaled.
              boxShadow: `0 0 0 ${strokeWidth / 3}px ${outlineSoft} inset`,
            }}
          >
            {isSingle &&
            geometryPreview[id]?.size &&
            isDeviceMockupRoot(api, id)
              ? (() => {
                  const colors = mockupGhostColors(api, id)
                  if (!colors) return null
                  const radius = Math.min(rect.width, rect.height) * 0.12
                  const screenInset = Math.min(rect.width, rect.height) * 0.018
                  return (
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={{
                        borderRadius: radius,
                        background: colors.bezelColor,
                      }}
                    >
                      <div
                        className="pointer-events-none absolute"
                        style={{
                          inset: screenInset,
                          borderRadius: Math.max(0, radius - screenInset),
                          background: colors.screenColor,
                        }}
                      />
                    </div>
                  )
                })()
              : null}
            {isSingle && editingVector ? (
              <svg
                className="pointer-events-none absolute inset-0 overflow-visible"
                width={rect.width}
                height={rect.height}
              >
                <VectorEditOverlay
                  node={editingVector}
                  zoom={zoom}
                  projection={{
                    clientToLocal: (clientX, clientY) => {
                      const host = document.querySelector(
                        `[data-selection-node="${id}"]`,
                      )
                      if (!(host instanceof HTMLElement)) return null
                      const box = host.getBoundingClientRect()
                      if (box.width < 1 || box.height < 1) return null
                      return {
                        x: ((clientX - box.left) / box.width) * rect.width,
                        y: ((clientY - box.top) / box.height) * rect.height,
                      }
                    },
                    localToScreen: (local) => local,
                  }}
                />
              </svg>
            ) : isSingle && showHandles ? (
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

// SPDX-License-Identifier: Apache-2.0

import { loadYoga, type Node as YogaNode, type Yoga } from 'yoga-layout/load'
import type { NodeId } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { applyChildLayoutForParent, applyNodeStyle } from '@/layout/mapper'
import type { ContainerSize, Rect, SolvedLayout } from '@/layout/types'

/**
 * Yoga WASM loader.
 *
 * Loading happens once at module scope and is memoized as a Promise.
 * Mirrors the apiReady pattern in src/scene/internals.ts — by the time
 * a React component wants to solve a layout, we've already awaited the
 * WASM fetch/instantiation.
 *
 * The returned `Yoga` object carries the node factory AND every YG enum
 * (FLEX_DIRECTION_ROW, ALIGN_CENTER, ...), which is why the mapper takes
 * the Yoga instance as a parameter — no global state, unit-testable.
 */
export const yogaReady: Promise<Yoga> = loadYoga()

/**
 * Solve a layout pass into absolute rects.
 *
 * Given a scene and a root node id, build a transient Yoga tree, run
 * `calculateLayout` once, walk the tree to accumulate parent offsets,
 * and free the WASM memory. Output is a plain `{ [id]: Rect }` map.
 *
 * IMPORTANT: this is a full re-solve. It's meant to be called from a
 * dirty-tracked hook (see src/ui/hooks/useLayout.ts), NOT every frame.
 * Every frame goes through post-layout transform/opacity application,
 * which doesn't touch Yoga.
 *
 * Also IMPORTANT: never call this before `yogaReady` resolves. The hook
 * wrapper handles the await so callers inside React don't have to.
 */
export function solveLayout(
  yoga: Yoga,
  api: SceneAPI,
  rootId: NodeId,
  container: ContainerSize,
): SolvedLayout {
  const out: SolvedLayout = {}

  // Track every Yoga node we create so we can free them all in one pass
  // at the end, even on error paths. freeRecursive would also work from
  // the root, but an explicit list is clearer and survives partial trees.
  const created: YogaNode[] = []

  const build = (id: NodeId, knownInnerWidth: number | null): YogaNode | null => {
    const node = api.getNode(id)
    if (!node) return null

    const yNode = yoga.Node.create()
    created.push(yNode)
    applyNodeStyle(yoga, yNode, node)

    const parentLayout = 'layout' in node ? node.layout : null

    // Compute this container's inner (content-box) width in pixels if
    // we can. Grid cell math needs a concrete number; flex and none
    // don't care. Rules: if the container's declared width is a number,
    // use it; if not and we inherited a known width from the caller,
    // pass it through; otherwise null (hug / fill parents). Padding is
    // always subtracted.
    let innerWidth: number | null = null
    if (parentLayout) {
      const pad = parentLayout.padding.left + parentLayout.padding.right
      if ('size' in node && typeof node.size.width === 'number') {
        innerWidth = Math.max(0, node.size.width - pad)
      } else if (knownInnerWidth !== null) {
        innerWidth = Math.max(0, knownInnerWidth - pad)
      }
    }

    const children = api.getChildren(id)
    children.forEach((child, i) => {
      // For children: we pass the parent's inner width as the child's
      // "known outer width" floor — it can further narrow to its own
      // declared size inside build().
      const yChild = build(child.id, innerWidth)
      if (yChild) {
        yNode.insertChild(yChild, i)
        if (parentLayout) {
          const childSize = 'size' in child ? child.size : null
          applyChildLayoutForParent(
            yoga,
            yChild,
            parentLayout,
            childSize,
            i,
            innerWidth,
            child.position,
          )
        }
      }
    })

    return yNode
  }

  const yRoot = build(rootId)
  if (!yRoot) return out

  // The root node IS the artboard. Regardless of what size the root
  // node stores (stale data, old sample scenes, edits that drift from
  // meta.canvas), we pin Yoga's root width/height to the container —
  // so the artboard always fills its visible box. Without this, a 640
  // root inside a 1470 canvas leaves a dead strip on the right that
  // users read as "the scene is smaller than the artboard."
  yRoot.setWidth(container.width)
  yRoot.setHeight(container.height)

  // Solve into the provided container. Yoga lays out left-to-right; RTL
  // is a future concern, gated by a scene-meta flag we don't have yet.
  yRoot.calculateLayout(container.width, container.height, yoga.DIRECTION_LTR)

  // Walk the tree to produce ABSOLUTE rects. Yoga gives us offsets from
  // the parent; we accumulate as we descend. Visiting via the Yoga tree
  // (not the scene tree) keeps us in lockstep with insertion order, so
  // `getChild(i)` aligns with `getChildren(id)[i]`.
  const walk = (yNode: YogaNode, sceneId: NodeId, parentX: number, parentY: number) => {
    const x = parentX + yNode.getComputedLeft()
    const y = parentY + yNode.getComputedTop()
    const width = yNode.getComputedWidth()
    const height = yNode.getComputedHeight()
    const rect: Rect = { x, y, width, height }
    out[sceneId] = rect

    const children = api.getChildren(sceneId)
    children.forEach((child, i) => {
      walk(yNode.getChild(i), child.id, x, y)
    })
  }

  walk(yRoot, rootId, 0, 0)

  // Release WASM memory. freeRecursive() would handle nested nodes, but
  // we've already got the flat list, and free() per node is unambiguous.
  for (const n of created) n.free()

  return out
}
// SPDX-License-Identifier: Apache-2.0

import type { Node } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { AppIcon } from '@/ui/AppIcon'
import { getLastSolvedLayout } from '@/ui/hooks/lastSolvedLayout'

/**
 * Eight-button alignment toolbar — Framer-parity layout.
 *
 * Spans the full width of the inspector right column with three groups
 * separated by hairline dividers:
 *
 *   ▌  ▌▏  ▏  │  ▔  ▬  ▁  │  ⇆  ⇅
 *   left center right     top mid bottom    distH distV
 *
 * Behavior:
 *   - Single selection (non-root): align to the parent's content box
 *     (the parent's solved rect minus its padding).
 *   - Single selection (root/scene): align the scene's immediate child
 *     content inside the artboard.
 *   - Multi-select: align inside the union bounding box of the
 *     selection. The leftmost / topmost item stays put when "Align
 *     left" / "Align top" are clicked, etc. — same as Figma.
 *   - Distribute: requires 3+ selected nodes. Spaces them evenly along
 *     the requested axis between the outermost two; the outermost
 *     items don't move.
 *
 * Disabled state:
 *   - For SINGLE-selection, when the parent is in flex / grid layout
 *     mode, alignment via transform is meaningless — the parent's
 *     auto-layout owns the slot, and a transform offset would only
 *     visually shift the node out of its solved position. The whole
 *     toolbar greys out in that case with a tooltip explaining why.
 *   - For MULTI-selection, distribute requires 3+ items; the two
 *     distribute buttons greys out when fewer than 3 are picked.
 *
 * Updates `transform.x` / `transform.y` directly. Doesn't touch size or
 * the parent's layout.
 */

export type AlignAxis =
  | 'left'
  | 'centerH'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom'
  | 'distributeH'
  | 'distributeV'

export function AlignTools({
  api,
  selection,
}: {
  api: SceneAPI
  selection: string[]
}) {
  if (selection.length === 0) return null

  // Detect the "in a stack" case: single flow selection whose parent is
  // a flex / grid container. Absolute children are explicitly opting out
  // of parent layout, so alignment-by-transform is meaningful for them.
  const inStack = (() => {
    if (selection.length !== 1) return false
    const node = api.getNode(selection[0]!)
    if (!node || !node.parent) return false
    if (node.position === 'absolute') return false
    const parent = api.getNode(node.parent)
    if (!parent || !('layout' in parent)) return false
    return parent.layout.mode === 'flex' || parent.layout.mode === 'grid'
  })()

  const canDistribute = selection.length >= 3
  const apply = (axis: AlignAxis) => {
    if (inStack) return
    if ((axis === 'distributeH' || axis === 'distributeV') && !canDistribute) {
      return
    }
    alignNodes(api, selection, axis)
  }

  const stackTitle =
    'Alignment is owned by the parent stack. Switch this layer to Absolute, switch the parent to Layout: None, or move this layer out of the stack to align it manually.'

  return (
    <div
      title={inStack ? stackTitle : undefined}
      className={[
        'hm-control-surface flex h-7 w-full items-stretch gap-0.5 p-0.5',
        inStack ? 'pointer-events-none opacity-40' : '',
      ].join(' ')}
    >
      <AlignButton axis="left" title="Align left" onClick={apply}>
        <AppIcon name="align-left" size={15} />
      </AlignButton>
      <AlignButton axis="centerH" title="Align horizontal centers" onClick={apply}>
        <AppIcon name="align-center-x" size={15} />
      </AlignButton>
      <AlignButton axis="right" title="Align right" onClick={apply}>
        <AppIcon name="align-right" size={15} />
      </AlignButton>

      <span className="my-0.5 w-px shrink-0 self-stretch bg-border" />

      <AlignButton axis="top" title="Align top" onClick={apply}>
        <AppIcon name="align-top" size={15} />
      </AlignButton>
      <AlignButton axis="middle" title="Align vertical centers" onClick={apply}>
        <AppIcon name="align-center-y" size={15} />
      </AlignButton>
      <AlignButton axis="bottom" title="Align bottom" onClick={apply}>
        <AppIcon name="align-bottom" size={15} />
      </AlignButton>

      <span className="my-0.5 w-px shrink-0 self-stretch bg-border" />

      <AlignButton
        axis="distributeH"
        title={
          canDistribute
            ? 'Distribute horizontal spacing'
            : 'Distribute horizontal spacing — needs 3+ selected'
        }
        disabled={!canDistribute}
        onClick={apply}
      >
        <AppIcon name="distribute-x" size={15} />
      </AlignButton>
      <AlignButton
        axis="distributeV"
        title={
          canDistribute
            ? 'Distribute vertical spacing'
            : 'Distribute vertical spacing — needs 3+ selected'
        }
        disabled={!canDistribute}
        onClick={apply}
      >
        <AppIcon name="distribute-y" size={15} />
      </AlignButton>
    </div>
  )
}

function AlignButton({
  axis,
  title,
  children,
  onClick,
  disabled,
}: {
  axis: AlignAxis
  title: string
  children: React.ReactNode
  onClick: (axis: AlignAxis) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(axis)}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={[
        'flex h-full flex-1 items-center justify-center rounded-[4px] transition-colors',
        disabled
          ? 'cursor-not-allowed text-text-dim opacity-40'
          : 'text-text-muted hover:bg-panel-raised hover:text-text',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Alignment math
// ---------------------------------------------------------------------------

/**
 * Apply an alignment to the selection by writing `transform.x` /
 * `transform.y` on every selected node. The reference rect depends on
 * the selection size:
 *   - 1 node  → parent's solved rect (artboard for top-level layers)
 *   - 2+      → union bounding box of the selection itself
 *
 * For multi-select, "align left" pins every node to the leftmost edge
 * of the union (so the leftmost item doesn't move; everyone else
 * snaps to it). Mirrors Figma exactly.
 *
 * Distribute splits the inner gap evenly between the outermost two
 * items; the outermost two stay put. No-op when fewer than 3 items.
 */
function alignNodes(
  api: SceneAPI,
  selection: string[],
  axis: AlignAxis,
): void {
  const solved = getLastSolvedLayout()
  if (!solved) return
  const rootId = api.getRoot()

  const rootSelected = selection.length === 1 && selection[0] === rootId
  const targetIds = rootSelected
    ? api.getChildren(rootId).map((child) => child.id)
    : selection

  const nodes: Array<{ node: Node; rect: { x: number; y: number; w: number; h: number } }> = []
  for (const id of targetIds) {
    const n = api.getNode(id)
    const r = solved[id]
    if (!n || !r) continue
    const rendered = renderedRectForNode(api, solved, n)
    if (!rendered) continue
    nodes.push({
      node: n,
      rect: rendered,
    })
  }
  if (nodes.length === 0) return

  // Distribute path — needs the union bbox just for outermost pinning.
  if (axis === 'distributeH' || axis === 'distributeV') {
    if (nodes.length < 3) return
    distributeNodes(api, nodes, axis)
    return
  }

  // Reference box: union for multi-select, parent's solved rect for
  // single. When the scene/root itself is selected, align its immediate
  // child content inside the root artboard instead of no-oping.
  let refX: number
  let refY: number
  let refW: number
  let refH: number
  if (rootSelected) {
    const root = api.getNode(rootId)
    const rootRect = root ? renderedRectForNode(api, solved, root) : null
    if (!rootRect) return
    refX = rootRect.x
    refY = rootRect.y
    refW = rootRect.w
    refH = rootRect.h
  } else if (nodes.length === 1) {
    const only = nodes[0]!
    if (!only.node.parent) return
    const parent = api.getNode(only.node.parent)
    const parentRect = parent ? renderedRectForNode(api, solved, parent) : null
    if (!parentRect) return
    refX = parentRect.x
    refY = parentRect.y
    refW = parentRect.w
    refH = parentRect.h
  } else {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const { rect } of nodes) {
      if (rect.x < minX) minX = rect.x
      if (rect.y < minY) minY = rect.y
      if (rect.x + rect.w > maxX) maxX = rect.x + rect.w
      if (rect.y + rect.h > maxY) maxY = rect.y + rect.h
    }
    refX = minX
    refY = minY
    refW = maxX - minX
    refH = maxY - minY
  }

  // Compute new transform per node by working out where its rect
  // SHOULD sit, then applying the difference as a transform delta on
  // top of the node's current static transform.
  api.doc.transact(() => {
    for (const { node, rect } of nodes) {
      let dx = 0
      let dy = 0
      switch (axis) {
        case 'left':
          dx = refX - rect.x
          break
        case 'centerH':
          dx = refX + (refW - rect.w) / 2 - rect.x
          break
        case 'right':
          dx = refX + refW - rect.w - rect.x
          break
        case 'top':
          dy = refY - rect.y
          break
        case 'middle':
          dy = refY + (refH - rect.h) / 2 - rect.y
          break
        case 'bottom':
          dy = refY + refH - rect.h - rect.y
          break
      }
      if (dx === 0 && dy === 0) continue
      api.setNodeProperty(node.id, 'transform', {
        ...node.transform,
        x: node.transform.x + dx,
        y: node.transform.y + dy,
      })
    }
  })
}

function renderedRectForNode(
  api: SceneAPI,
  solved: NonNullable<ReturnType<typeof getLastSolvedLayout>>,
  node: Node,
): { x: number; y: number; w: number; h: number } | null {
  const r = solved[node.id]
  if (!r) return null
  const offset = accumulatedStaticOffset(api, node)
  return {
    x: r.x + offset.x,
    y: r.y + offset.y,
    w: r.width,
    h: r.height,
  }
}

function accumulatedStaticOffset(
  api: SceneAPI,
  node: Node,
): { x: number; y: number } {
  const rootId = api.getRoot()
  let x = 0
  let y = 0
  let current: Node | null = node

  while (current) {
    // Canvas treats the root/artboard transform as identity. Mirror
    // that here so alignment math uses the same visual coordinate space
    // as the selection outline and painted layer.
    if (current.id !== rootId) {
      x += current.transform.x
      y += current.transform.y
    }
    current = current.parent ? api.getNode(current.parent) : null
  }

  return { x, y }
}

/**
 * Distribute selected nodes evenly along an axis. The outermost two
 * stay fixed (their positions become the bounds); every node in
 * between gets re-spaced so the gaps between them are equal.
 *
 * "Equal gap" is measured edge-to-edge — like Figma's "Tidy Up"
 * distribution mode, not center-to-center. This produces visually
 * even spacing regardless of differing item sizes.
 */
function distributeNodes(
  api: SceneAPI,
  items: Array<{ node: Node; rect: { x: number; y: number; w: number; h: number } }>,
  axis: 'distributeH' | 'distributeV',
): void {
  // Sort by primary axis position so the "outer two" are unambiguous.
  const sorted = items.slice().sort((a, b) => {
    if (axis === 'distributeH') return a.rect.x - b.rect.x
    return a.rect.y - b.rect.y
  })

  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!

  // Total span between outer edges minus the sum of inner widths gives
  // the available gap budget; divide by N-1 gaps for equal spacing.
  let totalSize = 0
  for (const it of sorted) {
    totalSize += axis === 'distributeH' ? it.rect.w : it.rect.h
  }
  const span =
    axis === 'distributeH'
      ? last.rect.x + last.rect.w - first.rect.x
      : last.rect.y + last.rect.h - first.rect.y
  const gap = (span - totalSize) / (sorted.length - 1)

  api.doc.transact(() => {
    let cursor = axis === 'distributeH' ? first.rect.x : first.rect.y
    for (let i = 0; i < sorted.length; i++) {
      const it = sorted[i]!
      const targetPos = cursor
      const currentPos = axis === 'distributeH' ? it.rect.x : it.rect.y
      const delta = targetPos - currentPos
      if (delta !== 0) {
        const t = it.node.transform
        api.setNodeProperty(it.node.id, 'transform', {
          ...t,
          x: axis === 'distributeH' ? t.x + delta : t.x,
          y: axis === 'distributeV' ? t.y + delta : t.y,
        })
      }
      cursor += (axis === 'distributeH' ? it.rect.w : it.rect.h) + gap
    }
  })
}

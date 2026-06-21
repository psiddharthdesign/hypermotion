// SPDX-License-Identifier: Apache-2.0

import type { NodeId } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import type { ContextMenuItem } from '@/state/ui'
import { useUI } from '@/state/ui'
import {
  createComponentFromSelection,
  instantiateComponent,
  ungroupFrame,
  wrapInAutoLayout,
  wrapInGrid,
} from '@/ui/actions'

/**
 * Build the right-click context menu for the given selection.
 *
 * The menu is intentionally short — just the operations a designer
 * reaches for dozens of times per session. More specialized commands
 * live in the Inspector.
 *
 * Duplicate is wired to the same logic as Cmd+D, but via a module
 * import from the keyboard-shortcuts hook would be circular. For MVP
 * we express it as a scene-graph clone locally. If the duplicate
 * behavior diverges, pull it into a shared helper.
 */
export function buildNodeContextMenu(
  api: SceneAPI,
  ids: NodeId[],
): ContextMenuItem[] {
  if (ids.length === 0) return []

  const nodes = ids.map((id) => api.getNode(id)).filter((n) => n !== null)
  const allSameParent =
    nodes.length > 0 &&
    nodes.every((n) => n!.parent === nodes[0]!.parent && n!.parent !== null)
  const singleFrame =
    ids.length === 1 && nodes[0] && nodes[0].kind === 'frame'
      ? nodes[0]
      : null

  const items: ContextMenuItem[] = []

  // Wrap in auto layout — requires 1+ nodes with a common parent.
  items.push({
    label: 'Wrap in auto layout',
    shortcut: '⇧A',
    disabled: !allSameParent,
    onClick: () => {
      const newId = wrapInAutoLayout(api, ids)
      if (newId) useUI.getState().setSelection([newId])
    },
  })

  // Wrap in grid — same same-parent rule. No Figma-style shortcut yet.
  items.push({
    label: 'Wrap in grid',
    disabled: !allSameParent,
    onClick: () => {
      const newId = wrapInGrid(api, ids)
      if (newId) useUI.getState().setSelection([newId])
    },
  })

  // Remove auto layout (a.k.a. ungroup) — only for a single frame that
  // has a parent. Matches Figma's Cmd+Shift+G ergonomics.
  if (singleFrame && singleFrame.parent) {
    items.push({
      label: 'Remove auto layout',
      shortcut: '⇧⌘G',
      onClick: () => {
        const kids = ungroupFrame(api, singleFrame.id)
        useUI.getState().setSelection(kids)
      },
    })
  }

  items.push({ kind: 'separator' })

  // Mask — toggles isMask on the bottom-most node in the selection.
  // Same logic as the Cmd+Opt+M keyboard shortcut. Single selection
  // with isMask=true gets a "Release mask" label; everything else
  // says "Use as mask". Disabled when the selection has no parent
  // (root is selected) since masks need a sibling above them.
  const allRoots = nodes.every((n) => n!.parent === null)
  if (!allRoots) {
    const singleAlreadyMask =
      ids.length === 1 && nodes[0]?.isMask === true
    items.push({
      label: singleAlreadyMask ? 'Release mask' : 'Use as mask',
      shortcut: '⌥⌘M',
      onClick: () => {
        if (ids.length === 1) {
          const n = nodes[0]!
          api.setNodeProperty(n.id, 'isMask', !n.isMask)
          return
        }
        // Multi-select: bucket by parent, mark bottom-most as mask
        // and clear the others. Mirrors the keyboard handler so the
        // two surfaces stay consistent.
        const byParent = new Map<NodeId, NodeId[]>()
        for (const n of nodes) {
          if (!n!.parent) continue
          const list = byParent.get(n!.parent) ?? []
          list.push(n!.id)
          byParent.set(n!.parent, list)
        }
        api.doc.transact(() => {
          for (const [parentId, ns] of byParent) {
            const parent = api.getNode(parentId)
            if (!parent) continue
            const order = parent.children
            const sorted = ns
              .slice()
              .sort((a, b) => order.indexOf(a) - order.indexOf(b))
            const maskId = sorted[0]!
            for (const id of sorted)
              api.setNodeProperty(id, 'isMask', id === maskId)
          }
        })
      },
    })
    items.push({ kind: 'separator' })
  }

  items.push({
    label: 'Create component',
    shortcut: '⌥⌘K',
    disabled: allRoots,
    onClick: () => {
      const componentId = createComponentFromSelection(api, ids)
      if (componentId) useUI.getState().setSelection([componentId])
    },
  })

  const singleComponent =
    ids.length === 1 && nodes[0]?.kind === 'component' ? nodes[0] : null
  if (singleComponent) {
    items.push({
      label: 'Create instance',
      onClick: () => {
        const instanceId = instantiateComponent(api, singleComponent.id)
        if (instanceId) useUI.getState().setSelection([instanceId])
      },
    })
  }

  items.push({ kind: 'separator' })

  // Rename — opens the multi-select rename dialog. Available for any
  // selection (1+); single-layer rename via the dialog is still useful
  // because the dialog lets users insert ascending numbers and run a
  // Match/replace on the existing name.
  items.push({
    label: ids.length > 1 ? `Rename ${ids.length} layers…` : 'Rename…',
    shortcut: '⌘R',
    onClick: () => useUI.getState().setRenameDialogOpen(true),
  })

  items.push({
    label: 'Duplicate',
    shortcut: '⌘D',
    onClick: () => {
      const newIds: NodeId[] = []
      for (const id of ids) {
        const dup = duplicateForContextMenu(api, id)
        if (dup) newIds.push(dup)
      }
      if (newIds.length > 0) useUI.getState().setSelection(newIds)
    },
  })

  items.push({
    label: 'Delete',
    shortcut: '⌫',
    danger: true,
    onClick: () => {
      for (const id of ids) {
        const node = api.getNode(id)
        if (node && node.parent) api.deleteNode(id)
      }
      useUI.getState().clearSelection()
    },
  })

  return items
}

/**
 * Subtree clone used by the context menu's Duplicate action.
 *
 * The keyboard shortcut has a similar helper (private to that module).
 * Keeping a second copy here is deliberate: the menu's action surface
 * is stable even if the keyboard hook is rearranged. When both share
 * the same behavior we can hoist them into `actions.ts`.
 */
function duplicateForContextMenu(api: SceneAPI, id: NodeId): NodeId | null {
  const original = api.getNode(id)
  if (!original || !original.parent) return null
  if (original.kind === 'component') return instantiateComponent(api, original.id)

  const cloneSubtree = (srcId: NodeId, parent: NodeId): NodeId => {
    const src = api.getNode(srcId)
    if (!src) return parent
    const { id: _i, parent: _p, children: _c, ...rest } = src
    void _i
    void _p
    void _c
    const newId = api.createNode(src.kind, parent, {
      ...rest,
      name: src.name + ' copy',
    } as Partial<typeof src>)
    for (const child of api.getChildren(srcId)) {
      cloneSubtree(child.id, newId)
    }
    return newId
  }

  const newId = cloneSubtree(id, original.parent)
  const copy = api.getNode(newId)
  if (copy) {
    api.setNodeProperty(newId, 'transform', {
      ...copy.transform,
      x: copy.transform.x + 16,
      y: copy.transform.y + 16,
    })
  }
  return newId
}

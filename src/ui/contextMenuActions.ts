// SPDX-License-Identifier: Apache-2.0
import { getLastSolvedLayout } from '@/ui/hooks/lastSolvedLayout'
import { createArrangement, dissolveArrangement } from '@/scene/arrangementActions'

import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { getAnimEngine } from '@/anim'
import { detachNullDependents } from '@/scene/nullObject'

import { duplicateSelection } from '@/ui/duplicateSelection'
import { instantiateComponent } from '@/ui/actions'

import type { NodeId } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import type { ContextMenuItem } from '@/state/ui'
import { useUI } from '@/state/ui'
import {
  createComponentFromSelection,
  ungroupFrame,
  applyMaskToSelection,
  wrapInAutoLayout,
  wrapInGroup,
  wrapInGrid,
} from '@/ui/actions'

/**
 * Build the right-click context menu for the given selection.
 *
 * The menu is intentionally short — just the operations a designer
 * reaches for dozens of times per session. More specialized commands
 * live in the Inspector.
 *
 * Duplicate shares the same selection action as Cmd+D.
 */
export function buildNodeContextMenu(
  api: SceneAPI,
  ids: NodeId[],
): ContextMenuItem[] {
  if (ids.length === 0) return []

  const nodes = ids.map((id) => api.getNode(id)).filter((n) => n !== null)
  const allSameParent =
    nodes.length === ids.length &&
    nodes.length > 0 &&
    nodes.every(
      (n) =>
        n!.parent === nodes[0]!.parent &&
        n!.parent !== null &&
        n!.kind !== 'camera' && n!.kind !== 'null' && n!.kind !== 'arrangement',
    )
  const singleFrame =
    ids.length === 1 && nodes[0] && nodes[0].kind === 'frame'
      ? nodes[0]
      : null

  const items: ContextMenuItem[] = []
  if (nodes.some((node) => node.id !== api.getRoot() && !['camera', 'audio', 'null', 'arrangement'].includes(node.kind))) items.push({
    label: 'Create advanced layout',
    onClick: () => {
      const id = createArrangement(api, ids, getLastSolvedLayout() ?? {}, getAnimEngine().getSnapshot())
      if (id) useUI.getState().setSelection([id])
    },
  })

  items.push({
    label: 'Wrap in group',
    shortcut: '⌘G',
    disabled: !allSameParent,
    onClick: () => {
      const newId = wrapInGroup(api, ids)
      if (newId) useUI.getState().setSelection([newId])
    },
  })

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
      label:
        singleFrame.layout.mode === 'none'
          ? 'Ungroup'
          : 'Remove auto layout',
      shortcut: '⇧⌘G',
      onClick: () => {
        const kids = ungroupFrame(api, singleFrame.id)
        useUI.getState().setSelection(kids)
      },
    })
  }

  items.push({ kind: 'separator' })

  // Masks are grouped with their content, below it in the Layers list.
  const allRoots = nodes.every((n) => n!.parent === null)
  if (!allRoots) {
    const singleAlreadyMask =
      ids.length === 1 && nodes[0]?.isMask === true
    items.push({
      label: singleAlreadyMask ? 'Release mask' : 'Use as mask',
      shortcut: '⌥⌘M',
      onClick: () => {
        useUI.getState().setSelection(applyMaskToSelection(api, ids))
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
      const newIds = duplicateSelection(api, ids)
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
        if (node && node.parent) api.doc.transact(() => {
          if (api.getNode(id)?.kind === 'null') detachNullDependents(api, id, getAnimEngine().getSnapshot())
          if (api.getNode(id)?.kind === 'arrangement') dissolveArrangement(api, id, getAnimEngine().getSnapshot(), getLastSolvedLayout() ?? undefined)
          else api.deleteNode(id)
        }, UNDOABLE_GESTURE_ORIGIN)
      }
      useUI.getState().clearSelection()
    },
  })

  return items
}

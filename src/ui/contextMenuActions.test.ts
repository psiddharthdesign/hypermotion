// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { buildNodeContextMenu } from './contextMenuActions'

describe('node context menu grouping', () => {
  it('exposes Wrap in group for a valid same-parent layer selection', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { name: 'Root' })
    const first = api.createNode('rect', root, { name: 'First' })
    const second = api.createNode('rect', root, { name: 'Second' })

    const item = buildNodeContextMenu(api, [first, second]).find(
      (candidate) => candidate.label === 'Wrap in group',
    )

    expect(item).toMatchObject({ shortcut: '⌘G', disabled: false })
    api.doc.destroy()
  })

  it('disables grouping for roots and mixed-parent selections', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { name: 'Root' })
    const first = api.createNode('rect', root, { name: 'First' })
    const nested = api.createNode('frame', root, { name: 'Nested' })
    const second = api.createNode('rect', nested, { name: 'Second' })

    const rootItem = buildNodeContextMenu(api, [root]).find(
      (candidate) => candidate.label === 'Wrap in group',
    )
    const mixedItem = buildNodeContextMenu(api, [first, second]).find(
      (candidate) => candidate.label === 'Wrap in group',
    )

    expect(rootItem?.disabled).toBe(true)
    expect(mixedItem?.disabled).toBe(true)
    api.doc.destroy()
  })
})

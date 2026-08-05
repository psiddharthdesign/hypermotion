// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { readScene, sceneToBytes } from '@/scene/file'
import type { Appearance } from '@/scene/types'

const appearance = (cornerSmoothing?: number): Appearance => ({
  opacity: 1,
  fill: { kind: 'solid', color: '#ffffff' },
  stroke: null,
  cornerRadius: 16,
  ...(cornerSmoothing === undefined ? {} : { cornerSmoothing }),
  effects: [],
})

describe('corner smoothing persistence', () => {
  it('treats a missing legacy value as zero', () => {
    const api = createSceneAPI()
    const id = api.createNode('rect', api.getRoot(), {
      appearance: appearance(),
    })

    expect(api.getNode(id)?.appearance.cornerSmoothing).toBe(0)
  })

  it('clamps authored values to the normalized range', () => {
    const api = createSceneAPI()
    const id = api.createNode('rect', api.getRoot(), {
      appearance: appearance(2),
    })

    expect(api.getNode(id)?.appearance.cornerSmoothing).toBe(1)

    api.setNodeProperty(id, 'appearance', appearance(-0.25))
    expect(api.getNode(id)?.appearance.cornerSmoothing).toBe(0)
  })

  it('normalizes ellipse corners to a true ellipse on create and update', () => {
    const api = createSceneAPI()
    const id = api.createNode('ellipse', api.getRoot(), {
      appearance: {
        ...appearance(0.6),
        cornerRadii: { tl: 10, tr: 20, br: 30, bl: 40 },
      },
    })

    expect(api.getNode(id)?.appearance).toMatchObject({
      cornerRadius: 0,
      cornerSmoothing: 0,
    })
    expect(api.getNode(id)?.appearance.cornerRadii).toBeUndefined()

    api.setNodeProperty(id, 'appearance', appearance(0.8))
    expect(api.getNode(id)?.appearance).toMatchObject({
      cornerRadius: 0,
      cornerSmoothing: 0,
    })
  })

  it('round-trips through the Yjs scene format', () => {
    const source = createSceneAPI()
    const id = source.createNode('rect', source.getRoot(), {
      appearance: appearance(0.6),
    })

    const restored = readScene(sceneToBytes(source.doc))

    expect(restored.api.getNode(id)?.appearance.cornerSmoothing).toBe(0.6)
    restored.doc.destroy()
    source.doc.destroy()
  })
})

// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import type { Layout, Transform } from '@/scene/types'
import { solveLayout, yogaReady } from '@/layout/engine'

const rowLayout: Layout = {
  mode: 'flex',
  direction: 'row',
  justify: 'start',
  align: 'start',
  gap: 10,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  wrap: false,
  columns: 1,
  rowGap: 0,
  columnGap: 0,
}

const noneLayout: Layout = {
  ...rowLayout,
  mode: 'none',
  padding: { top: 20, right: 30, bottom: 40, left: 50 },
}

function transformAt(x: number, y: number): Transform {
  return {
    x,
    y,
    z: 0,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    scaleX: 1,
    scaleY: 1,
  }
}

describe('layout visibility', () => {
  it('removes hidden flow children from auto-layout space', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, {
      size: { width: 300, height: 100 },
      layout: rowLayout,
    })
    const hidden = api.createNode('rect', root, {
      size: { width: 50, height: 20 },
      visible: false,
    })
    const visible = api.createNode('rect', root, {
      size: { width: 50, height: 20 },
    })

    const solved = solveLayout(await yogaReady, api, root, {
      width: 300,
      height: 100,
    })

    expect(solved[hidden]).toBeUndefined()
    expect(solved[visible]).toMatchObject({ x: 0, y: 0, width: 50, height: 20 })
  })

  it('excludes hidden absolute children from hug-size measurement', async () => {
    const api = createSceneAPI()
    const root = api.createNode('component', null, {
      size: { width: 'hug', height: 'hug' },
    })
    const visible = api.createNode('rect', root, {
      size: { width: 40, height: 24 },
      transform: transformAt(0, 0),
    })
    const hidden = api.createNode('rect', root, {
      size: { width: 80, height: 60 },
      transform: transformAt(300, 200),
      visible: false,
    })

    const solved = solveLayout(await yogaReady, api, root, {
      width: 1000,
      height: 1000,
    })

    expect(solved[root]).toMatchObject({ width: 40, height: 24 })
    expect(solved[visible]).toBeDefined()
    expect(solved[hidden]).toBeUndefined()
  })
})

describe('None-mode free positioning', () => {
  it('ignores stored flow padding for fixed children', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, {
      size: { width: 300, height: 180 },
      layout: noneLayout,
    })
    const child = api.createNode('rect', root, {
      size: { width: 80, height: 40 },
      transform: transformAt(12, 16),
    })

    const solved = solveLayout(await yogaReady, api, root, {
      width: 300,
      height: 180,
    })

    // Transforms are applied after Yoga; the layout origin must remain (0, 0).
    expect(solved[child]).toMatchObject({ x: 0, y: 0, width: 80, height: 40 })
  })

  it('does not shrink fill children by dormant padding', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, {
      size: { width: 300, height: 180 },
      layout: noneLayout,
    })
    const child = api.createNode('rect', root, {
      size: { width: 'fill', height: 'fill' },
    })

    const solved = solveLayout(await yogaReady, api, root, {
      width: 300,
      height: 180,
    })

    expect(solved[child]).toMatchObject({ x: 0, y: 0, width: 300, height: 180 })
  })

  it('continues to honor padding in flex mode', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, {
      size: { width: 300, height: 180 },
      layout: { ...rowLayout, padding: noneLayout.padding },
    })
    const child = api.createNode('rect', root, {
      size: { width: 'fill', height: 40 },
    })

    const solved = solveLayout(await yogaReady, api, root, {
      width: 300,
      height: 180,
    })

    expect(solved[child]).toMatchObject({ x: 50, y: 20, width: 220, height: 40 })
  })
})

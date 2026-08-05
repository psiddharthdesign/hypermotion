// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { solveLayout, yogaReady } from '@/layout'
import { createSceneAPI } from '@/scene/doc'
import type { Layout } from '@/scene'
import {
  canPatchAnimatedLeafSizes,
  createAnimatedSizeSnapshotSelector,
  patchAnimatedLeafSizes,
  sceneAPIWithAnimatedSizes,
} from '@/ui/animatedSizeLayout'

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

describe('animated size layout', () => {
  it('ignores unrelated animation frames and structurally shares equal sizes', () => {
    const select = createAnimatedSizeSnapshotSelector()

    const empty = select({ rect: { x: 24, opacity: 0.5 } })
    expect(empty).toEqual({})
    expect(select({ rect: { rotation: 45 } })).toBe(empty)

    const first = select({ rect: { width: 120, height: 24 } })
    expect(first).toEqual({ rect: { width: 120, height: 24 } })
    expect(select({ rect: { width: 120, height: 24, opacity: 0.8 } })).toBe(
      first,
    )
    expect(select({ rect: { width: 140, height: 24 } })).not.toBe(first)
  })

  it('reflows auto-layout siblings from numeric size tracks without mutating authored size', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, {
      size: { width: 300, height: 100 },
      layout: rowLayout,
    })
    const first = api.createNode('rect', root, {
      size: { width: 50, height: 20 },
    })
    const second = api.createNode('rect', root, {
      size: { width: 50, height: 20 },
    })

    const liveApi = sceneAPIWithAnimatedSizes(api, {
      [first]: { width: 120 },
    })
    const solved = solveLayout(await yogaReady, liveApi, root, {
      width: 300,
      height: 100,
    })

    expect(solved[first]).toMatchObject({ width: 120, height: 20 })
    expect(solved[second]).toMatchObject({ x: 130, width: 50 })
    expect(api.getNode(first)).toMatchObject({
      size: { width: 50, height: 20 },
    })
  })

  it('patches a free-positioned leaf rect without running another layout pass', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, {
      size: { width: 300, height: 100 },
      layout: { ...rowLayout, mode: 'none' },
    })
    const bar = api.createNode('rect', root, {
      size: { width: 938, height: 1 },
    })
    const solved = solveLayout(await yogaReady, api, root, {
      width: 300,
      height: 100,
    })
    const values = { [bar]: { width: 469, height: 41 } }

    expect(canPatchAnimatedLeafSizes(api, values)).toBe(true)
    const patched = patchAnimatedLeafSizes(solved, values)

    expect(patched[bar]).toMatchObject({ width: 469, height: 41 })
    expect(solved[bar]).toMatchObject({ width: 938, height: 1 })
    expect(api.getNode(bar)).toMatchObject({
      size: { width: 938, height: 1 },
    })
  })

  it('requires a full solve for a flow child or animated container', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, {
      size: { width: 300, height: 100 },
      layout: rowLayout,
    })
    const flowChild = api.createNode('rect', root, {
      size: { width: 50, height: 20 },
    })
    expect(
      canPatchAnimatedLeafSizes(api, { [flowChild]: { width: 120 } }),
    ).toBe(false)

    api.setNodeProperty(root, 'layout', { ...rowLayout, mode: 'none' })
    const container = api.createNode('frame', root, {
      size: { width: 50, height: 20 },
      layout: rowLayout,
    })
    api.createNode('rect', container, { size: { width: 10, height: 10 } })
    expect(
      canPatchAnimatedLeafSizes(api, { [container]: { width: 120 } }),
    ).toBe(false)
  })
})

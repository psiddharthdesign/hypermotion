// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { solveLayout, yogaReady } from '@/layout'
import { createSceneAPI } from '@/scene/doc'
import type { Layout } from '@/scene'
import {
  canPatchAnimatedLayout,
  createAnimatedLayoutSnapshotSelector,
  sceneAPIWithAnimatedLayout,
} from '@/ui/animatedLayout'
import { sceneAPIWithNodeLayoutPreviews } from '@/ui/nodeLayoutPreviewStore'

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

describe('animated layout', () => {
  it('ignores paint/transform frames and structurally shares held layout values', () => {
    const select = createAnimatedLayoutSnapshotSelector()

    const empty = select({ child: { x: 24, opacity: 0.5 } })
    expect(empty).toEqual({})
    expect(select({ child: { rotation: 45 } })).toBe(empty)

    const first = select({
      root: {
        layoutDirection: 'row',
        layoutGap: 18,
        layoutPaddingLeft: 16,
      },
    })
    expect(first).toEqual({
      root: {
        layoutDirection: 'row',
        layoutGap: 18,
        layoutPaddingLeft: 16,
      },
    })
    expect(
      select({
        root: {
          layoutDirection: 'row',
          layoutGap: 18,
          layoutPaddingLeft: 16,
          opacity: 0.8,
        },
      }),
    ).toBe(first)
  })

  it('reflows flex siblings for animated gap, padding, and direction without mutating the scene', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, {
      size: { width: 300, height: 160 },
      layout: rowLayout,
    })
    const first = api.createNode('rect', root, {
      size: { width: 50, height: 20 },
    })
    const second = api.createNode('rect', root, {
      size: { width: 50, height: 20 },
    })

    const rowApi = sceneAPIWithAnimatedLayout(api, {
      [root]: {
        layoutGap: 30,
        layoutPaddingTop: 8,
        layoutPaddingLeft: 20,
      },
    })
    const rowSolved = solveLayout(await yogaReady, rowApi, root, {
      width: 300,
      height: 160,
    })
    expect(rowSolved[first]).toMatchObject({ x: 20, y: 8 })
    expect(rowSolved[second]).toMatchObject({ x: 100, y: 8 })

    const columnApi = sceneAPIWithAnimatedLayout(api, {
      [root]: {
        layoutDirection: 'column',
        layoutGap: 30,
        layoutPaddingTop: 8,
        layoutPaddingLeft: 20,
      },
    })
    const columnSolved = solveLayout(await yogaReady, columnApi, root, {
      width: 300,
      height: 160,
    })
    expect(columnSolved[first]).toMatchObject({ x: 20, y: 8 })
    expect(columnSolved[second]).toMatchObject({ x: 20, y: 58 })

    expect(api.getNode(root)).toMatchObject({
      layout: {
        direction: 'row',
        gap: 10,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    })
  })

  it('reflows grid columns when animated padding changes the content box', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, {
      size: { width: 300, height: 120 },
      layout: {
        ...rowLayout,
        mode: 'grid',
        columns: 2,
        columnGap: 20,
        rowGap: 12,
      },
    })
    const first = api.createNode('rect', root, {
      size: { width: 'fill', height: 20 },
    })
    const second = api.createNode('rect', root, {
      size: { width: 'fill', height: 20 },
    })

    const liveApi = sceneAPIWithAnimatedLayout(api, {
      [root]: {
        layoutPaddingLeft: 30,
        layoutPaddingRight: 30,
      },
    })
    const solved = solveLayout(await yogaReady, liveApi, root, {
      width: 300,
      height: 120,
    })

    expect(solved[first]).toMatchObject({ x: 30, width: 110 })
    expect(solved[second]).toMatchObject({ x: 160, width: 110 })
    expect(api.getNode(root)).toMatchObject({
      layout: { padding: { top: 0, right: 0, bottom: 0, left: 0 } },
    })
  })

  it('lets a transient inspector scrub paint above an active layout track', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, {
      size: { width: 300, height: 100 },
      layout: rowLayout,
    })
    api.createNode('rect', root, { size: { width: 50, height: 20 } })
    const second = api.createNode('rect', root, {
      size: { width: 50, height: 20 },
    })

    const animatedApi = sceneAPIWithAnimatedLayout(api, {
      [root]: { layoutGap: 30 },
    })
    const scrubApi = sceneAPIWithNodeLayoutPreviews(animatedApi, {
      [root]: { gap: 44 },
    })
    const solved = solveLayout(await yogaReady, scrubApi, root, {
      width: 300,
      height: 100,
    })

    expect(solved[second]).toMatchObject({ x: 94 })
    expect(api.getNode(root)).toMatchObject({ layout: { gap: 10 } })
  })

  it('keeps the rect-only fast path for free-positioned size tracks only', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, {
      size: { width: 300, height: 100 },
      layout: { ...rowLayout, mode: 'none' },
    })
    const child = api.createNode('rect', root, {
      size: { width: 50, height: 20 },
    })

    expect(canPatchAnimatedLayout(api, { [child]: { width: 80 } })).toBe(true)
    expect(canPatchAnimatedLayout(api, { [root]: { layoutGap: 24 } })).toBe(
      false,
    )
  })
})

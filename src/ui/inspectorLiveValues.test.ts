// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { getAnimEngine } from '@/anim/engine'
import { createAnimatedSnapshotSelector } from './hooks/useAnimatedValues'
import { liveInspectorNode } from './inspectorLiveValues'

describe('live inspector values', () => {
  it('follows intermediate and held track values without changing the saved node', () => {
    const api = createSceneAPI()
    const id = api.createNode('frame', null)
    const node = api.getNode(id)!
    const before = JSON.stringify(node)
    for (const [propertyId, end] of [
      ['transform.y', 200], ['transform.rotationX', 90],
      ['appearance.opacity', 1], ['size.width', 400], ['layout.gap', 40],
    ] as const) {
      api.setTrack({
        id: propertyId, nodeId: id, propertyId, defaultEasing: 'linear',
        keyframes: [
          { id: 'start', time: 0, value: 0 },
          { id: 'end', time: 4, value: end },
        ],
      })
    }
    const engine = getAnimEngine()
    engine.attach(api)
    const select = createAnimatedSnapshotSelector([id])
    for (const time of [1, 2, 3, 4, 5]) {
      engine.seek(time)
      const live = liveInspectorNode(node, select(engine.getSnapshot())[id])
      const progress = Math.min(time / 4, 1)
      expect(live.transform.y).toBeCloseTo(progress * 200)
      expect(live.transform.rotationX).toBeCloseTo(progress * 90)
      expect(live.appearance.opacity).toBeCloseTo(progress)
      expect('size' in live && live.size.width).toBeCloseTo(progress * 400)
      expect('layout' in live && live.layout.gap).toBeCloseTo(progress * 40)
    }
    expect(JSON.stringify(api.getNode(id))).toBe(before)
  })

  it('preserves unanimated fields and zero values in multi-selection projections', () => {
    const api = createSceneAPI()
    const id = api.createNode('frame', null)
    const node = api.getNode(id)!
    expect(liveInspectorNode(node)).toBe(node)
    const live = liveInspectorNode(node, {
      x: 0, opacity: 0, fill: '#123456', cornerRadius: 16,
      layoutPaddingLeft: 24, layoutDirection: 'column',
    })
    expect(live.appearance).toMatchObject({
      opacity: 0, fill: { kind: 'solid', color: '#123456' }, cornerRadius: 16,
    })
    expect(live.transform.y).toBe(node.transform.y)
    expect('layout' in live && live.layout.padding.left).toBe(24)
    expect('layout' in live && live.layout.direction).toBe('column')
    expect('layout' in live && 'layout' in node && live.layout.padding.top)
      .toBe('layout' in node && node.layout.padding.top)
  })
})

import { describe, it, expect } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { applyLayerFade } from './layerFade'

describe('layer fades', () => {
  it('fits both fades inside the visible trimmed video range', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    const id = api.createNode('video', root, { duration: 20, startTime: -2, trimStart: 4, trimEnd: 16, playbackRate: 2 })
    expect(applyLayerFade(api, id, 'both', 10, 'linear')).toBe(true)
    const keys = api.getTracksForNode(id)[0]!.keyframes
    expect(keys.map(k => [k.time, k.value])).toEqual([[0, 0], [2, 1], [4, 0]])
  })
  it('preserves opacity animation outside the fade interval', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    const id = api.createNode('rect', root)
    api.setTrack({ id: 'opacity', nodeId: id, propertyId: 'appearance.opacity', defaultEasing: 'linear', keyframes: [{ id: 'later', time: 3, value: 0.7 }] })
    applyLayerFade(api, id, 'in', 0.5, 'ease-in-out')
    expect(api.getTracksForNode(id)[0]!.keyframes.at(-1)).toMatchObject({ id: 'later', time: 3, value: 0.7 })
  })
})

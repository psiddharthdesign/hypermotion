// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { createMaskRasterCache, maskRasterKey } from './maskRasterCache'

describe('live mask raster reuse', () => {
  it('reuses painted alpha across fresh document reads, previews and committed transforms', () => {
    const api = createSceneAPI()
    const id = api.createNode('rect', null, { isMask: true })
    const rect = { x: 0, y: 0, width: 320, height: 200 }
    const first = api.getNode(id)!
    const key = maskRasterKey(first, rect)
    expect(api.getNode(id)).not.toBe(first)
    expect(maskRasterKey(api.getNode(id)!, rect, { x: 80, rotation: 20, opacity: 0.4 })).toBe(key)
    api.setNodeProperty(id, 'transform', { ...first.transform, x: 80, rotation: 20 })
    expect(maskRasterKey(api.getNode(id)!, { ...rect, x: 100 })).toBe(key)
    const cache = createMaskRasterCache<object>()
    const raster = {}
    cache.set(id, key, raster, 320 * 200)
    expect(cache.get(id, maskRasterKey(api.getNode(id)!, rect))).toBe(raster)
    expect(cache.get(id, maskRasterKey(first, rect, { effectBlur: { blur: 32 } }))).toBeUndefined()
    expect(maskRasterKey(first, { ...rect, width: 400 })).not.toBe(key)
    api.setNodeProperty(id, 'appearance', { ...first.appearance, fill: null })
    expect(maskRasterKey(api.getNode(id)!, rect)).not.toBe(key)
  })

  it('bounds memory, replaces stale paints and clears after image loads', () => {
    const cache = createMaskRasterCache<string>(100)
    cache.set('a', 'old', 'a', 60)
    cache.set('a', 'new', 'new a', 60)
    cache.set('b', 'b', 'b', 40)
    expect(cache.get('a', 'old')).toBeUndefined()
    expect(cache.get('a', 'new')).toBe('new a')
    cache.set('c', 'c', 'c', 40)
    expect(cache.get('b', 'b')).toBeUndefined()
    expect(cache.get('a', 'new')).toBe('new a')
    cache.clear()
    expect(cache.get('a', 'new')).toBeUndefined()
  })
})

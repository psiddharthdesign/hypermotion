// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { videoFitUv, resolveVideoCrop, videoResizeSize } from './videoFit'
import { createSceneAPI } from '@/scene/doc'

describe('video fit and non-destructive crop', () => {
  it('crops wide footage into a square without stretching', () => {
    const uv = videoFitUv(1920, 1080, 500, 500, 'cover')
    expect(uv.repeatX).toBeCloseTo(1080 / 1920)
    expect(uv.repeatY).toBe(1)
    expect(uv.offsetX).toBeCloseTo((1 - 1080 / 1920) / 2)
  })
  it('contains the entire video with transparent bars', () => {
    const uv = videoFitUv(1920, 1080, 500, 500, 'contain')
    expect(uv.repeatX).toBeCloseTo(1)
    expect(uv.repeatY).toBeCloseTo(1920 / 1080)
    expect(uv.offsetY).toBeLessThan(0)
  })
  it('stretches only in the explicit Deform/fill mode', () => {
    expect(videoFitUv(1920, 1080, 500, 500, 'fill')).toEqual({ repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0 })
  })
  it('zooms and positions portrait crops without mutating footage', () => {
    const uv = videoFitUv(1080, 1920, 500, 500, 'cover', { x: 0, y: 1, zoom: 2 })
    expect(uv.repeatX).toBe(0.5)
    expect(uv.repeatY).toBeCloseTo(1080 / 1920 / 2)
    expect(uv.offsetY).toBeCloseTo(1 - uv.repeatY)
  })
  it('clamps unsafe crop values', () => {
    expect(resolveVideoCrop({ x: -1, y: 2, zoom: NaN })).toEqual({ x: 0, y: 1, zoom: 1 })
  })
  it('locks aspect ratio during corner resizing', () => {
    const next = videoResizeSize(1920, 1080, 960, 1000)
    expect(next).toEqual({ width: 960, height: 540 })
  })
  it('persists crop, updates it, and keeps the source intact', () => {
    const api = createSceneAPI()
    const id = api.createNode('video', api.getRoot(), {
      src: 'original.webm', crop: { x: 0.1, y: 0.8, zoom: 2 },
    })
    expect(api.getNode(id)).toMatchObject({ src: 'original.webm', crop: { x: 0.1, y: 0.8, zoom: 2 } })
    api.setNodeProperty(id, 'crop', { x: 0.5, y: 0.5, zoom: 1 })
    expect(api.getNode(id)).toMatchObject({ src: 'original.webm', crop: { x: 0.5, y: 0.5, zoom: 1 } })
  })
})

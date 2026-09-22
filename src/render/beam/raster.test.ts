// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { amplifyBeamAlpha, beamRasterScale } from './raster'

describe('Beam intensity and raster budget', () => {
  it('increases color coverage above one without bleaching RGB or touching transparent pixels', () => {
    const original = new Uint8ClampedArray([255,20,80,32, 20,40,255,128, 0,0,0,0, 255,0,0,255])
    const normal = original.slice(); amplifyBeamAlpha(normal,1)
    expect(normal).toEqual(original)
    const stronger = original.slice(); amplifyBeamAlpha(stronger,2)
    const strongest = original.slice(); amplifyBeamAlpha(strongest,8)
    expect(stronger[3]).toBeGreaterThan(original[3])
    expect(strongest[3]).toBeGreaterThan(stronger[3])
    expect(stronger[7]).toBeGreaterThan(original[7])
    expect(stronger.filter((_,i)=>i%4!==3)).toEqual(original.filter((_,i)=>i%4!==3))
    expect(strongest[11]).toBe(0)
    expect(strongest[15]).toBe(255)
  })
  it('keeps large outside glows inside the pixel budget without changing their logical size', () => {
    expect(beamRasterScale(480,240,2)).toBe(2)
    for(const [width,height] of [[16000,12000],[200000,200],[1e15,1e15]]) {
      const scale = beamRasterScale(width,height,4)
      expect(Math.ceil(width*scale)).toBeLessThanOrEqual(4096)
      expect(Math.ceil(height*scale)).toBeLessThanOrEqual(4096)
      expect(width*scale*height*scale).toBeLessThanOrEqual(4_000_001)
      expect(scale).toBeGreaterThan(0)
    }
  })
})

// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  buildApertureBokehPlan,
  resolveDofRenderQuality,
} from './apertureBokeh'

describe('aperture bokeh export plan', () => {
  it('treats the supplied Max Blur as a hard cap', () => {
    const plan = buildApertureBokehPlan({
      width: 1920,
      height: 1080,
      blurPx: 3.1,
      bladeCount: 3,
      bokehRatio: 4,
      quality: 'cinematic',
    })
    expect(plan.blurPx).toBeCloseTo(3.1)
  })

  it('maps legacy numeric quality to named export tiers', () => {
    expect(resolveDofRenderQuality(undefined)).toBe('cinematic')
    expect(resolveDofRenderQuality(undefined, 4)).toBe('high')
    expect(resolveDofRenderQuality(undefined, 8)).toBe('ultra')
    expect(resolveDofRenderQuality(undefined, 32)).toBe('cinematic')
    expect(resolveDofRenderQuality('cinematic', 1)).toBe('cinematic')
  })

  it('is deterministic and keeps polygon kernels centred', () => {
    const options = {
      width: 1920,
      height: 1080,
      blurPx: 24,
      bladeCount: 7,
      bladeRotation: 18,
      bokehRatio: 1,
      quality: 'cinematic' as const,
    }
    const first = buildApertureBokehPlan(options)
    const second = buildApertureBokehPlan(options)
    expect(second).toEqual(first)

    const centroid = first.samples.reduce(
      (sum, sample) => ({ x: sum.x + sample.x, y: sum.y + sample.y }),
      { x: 0, y: 0 },
    )
    expect(centroid.x / first.samples.length).toBeCloseTo(0, 9)
    expect(centroid.y / first.samples.length).toBeCloseTo(0, 9)
  })

  it('uses progressively larger but bounded quality budgets', () => {
    const common = {
      width: 1920,
      height: 1080,
      blurPx: 64,
      bladeCount: 0,
    }
    const high = buildApertureBokehPlan({ ...common, quality: 'high' })
    const ultra = buildApertureBokehPlan({ ...common, quality: 'ultra' })
    const cinematic = buildApertureBokehPlan({
      ...common,
      quality: 'cinematic',
    })

    expect(high.samples.length).toBeLessThan(ultra.samples.length)
    expect(ultra.samples.length).toBeLessThan(cinematic.samples.length)
    expect(high.samples.length).toBeLessThanOrEqual(12)
    expect(ultra.samples.length).toBeLessThanOrEqual(24)
    expect(cinematic.samples.length).toBeLessThanOrEqual(40)
  })

  it('honours polygon sample caps even when the aperture has more blades', () => {
    const plan = buildApertureBokehPlan({
      width: 1920,
      height: 1080,
      blurPx: 64,
      bladeCount: 16,
      quality: 'high',
    })
    const centroid = plan.samples.reduce(
      (sum, sample) => ({ x: sum.x + sample.x, y: sum.y + sample.y }),
      { x: 0, y: 0 },
    )

    expect(plan.samples).toHaveLength(12)
    expect(centroid.x / plan.samples.length).toBeCloseTo(0, 9)
    expect(centroid.y / plan.samples.length).toBeCloseTo(0, 9)
  })

  it('adapts large-frame work while retaining the selected tier floor', () => {
    const hd = buildApertureBokehPlan({
      width: 1920,
      height: 1080,
      blurPx: 64,
      quality: 'ultra',
    })
    const fourK = buildApertureBokehPlan({
      width: 3840,
      height: 2160,
      blurPx: 64,
      quality: 'ultra',
    })
    expect(fourK.samples.length).toBeLessThan(hd.samples.length)
    expect(fourK.samples.length).toBeGreaterThanOrEqual(12)
  })

  it('applies anamorphic ratio without changing kernel centre', () => {
    const round = buildApertureBokehPlan({
      width: 960,
      height: 540,
      blurPx: 20,
      bokehRatio: 1,
      quality: 'cinematic',
    })
    const wide = buildApertureBokehPlan({
      width: 960,
      height: 540,
      blurPx: 20,
      bokehRatio: 4,
      quality: 'cinematic',
    })
    const extent = (axis: 'x' | 'y', plan: typeof round) =>
      Math.max(...plan.samples.map((sample) => Math.abs(sample[axis])))

    expect(extent('x', wide)).toBeCloseTo(extent('x', round) * 2, 8)
    expect(extent('y', wide)).toBeCloseTo(extent('y', round) / 2, 8)
  })
})

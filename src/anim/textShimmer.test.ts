import { createSceneAPI } from '@/scene/doc'
import { getAnimEngine } from './engine'
import { describe, expect, it } from 'vitest'
import { textAnimationDefaults, normalizeTextAnimation } from './textAnimations'
import { textShimmerFill } from './textShimmer'

describe('Shimmer text paint', () => {
  const config = textAnimationDefaults('shimmer')
  it('repeats deterministically and preserves phase when a scene is split', () => {
    expect(textShimmerFill(config, 0.75)).toEqual(textShimmerFill(config, 2.75))
    expect(textShimmerFill({ ...config, startTime: -0.5 }, 0.25)).toEqual(textShimmerFill(config, 0.75))
    expect(textShimmerFill(config, 0.5)).not.toEqual(textShimmerFill(config, 1))
  })
  it('leaves the base visible outside a sweep and reaches the highlight color', () => {
    const start = textShimmerFill(config, 0, '#000000')
    const middle = textShimmerFill({ ...config, shimmerColor: '#ff0000' }, 1, '#000000')
    if (start.kind !== 'linear' || middle.kind !== 'linear') throw new Error('Expected linear paint')
    expect(start.stops.every(stop => stop.color === '#00000059')).toBe(true)
    expect(middle.stops[32]?.color).toBe('#ff0000ff')
    expect(textShimmerFill({ ...config, shimmerLoop: false }, 3)).toEqual(textShimmerFill({ ...config, shimmerLoop: false }, 4))
  })
  it('uses the OKLCH colors emitted by the text picker instead of falling back to gray', () => {
    const fill = textShimmerFill(config, 0, 'oklch(62.7955% 0.257683 29.2339)')
    if (fill.kind !== 'linear') throw new Error('Expected linear paint')
    expect(fill.stops.every(stop => stop.color === '#ff000059')).toBe(true)
    expect(textShimmerFill(config, 0, 'oklch(1 0 0)')).toEqual(textShimmerFill(config, 0, '#ffffff'))
  })
  it('preserves base color transparency for OKLCH and hex sources', () => {
    for (const color of ['oklch(1 0 0 / 50%)', '#ffffff80', '#fff8']) {
      const fill = textShimmerFill({ ...config, shimmerOpacity: 1 }, 0, color)
      if (fill.kind !== 'linear') throw new Error('Expected linear paint')
      expect(fill.stops[0]?.color).toBe(color === '#fff8' ? '#ffffff88' : '#ffffff80')
    }
  })
  it('retains settings on save and normalizes invalid controls', () => {
    const stored = normalizeTextAnimation(JSON.parse(JSON.stringify({ ...config, shimmerColor: '#abcdef', shimmerOpacity: 0.2, shimmerLoop: false })))!
    expect(stored).toMatchObject({ id: 'shimmer', shimmerColor: '#abcdef', shimmerOpacity: 0.2, shimmerLoop: false, applyTo: 'layer' })
    expect(normalizeTextAnimation({ ...config, shimmerWidth: -4, shimmerBlur: 20, shimmerOpacity: 4 })).toMatchObject({ shimmerWidth: 0.02, shimmerBlur: 1, shimmerOpacity: 1 })
  })
  it('uses timeline endpoints and keyframe easing after retiming', () => {
    const api = createSceneAPI()
    const id = api.createNode('text', null, { text: 'Thinking' })
    api.setTrack({ id: 'shimmer', nodeId: id, propertyId: 'text.progress', defaultEasing: 'linear', textAnimation: config, keyframes: [{ id: 'a', time: 1, value: 0, easingOut: 'ease-in' }, { id: 'b', time: 5, value: 1 }] })
    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(3)
    expect(engine.getSnapshot()[id]?.textAnimation).toMatchObject({ startTime: 1, duration: 4, customEasing: 'ease-in' })
    engine.seek(7)
    expect(engine.getSnapshot()[id]?.textAnimation?.duration).toBe(4)
  })
  it('responds to easing, width, blur and direction', () => {
    for (const patch of [{ easingPresetId: 'smooth' as const }, { shimmerWidth: 0.6 }, { shimmerBlur: 0.1 }, { direction: 'left' as const }]) {
      expect(textShimmerFill({ ...config, ...patch }, 0.75)).not.toEqual(textShimmerFill(config, 0.75))
    }
  })
})

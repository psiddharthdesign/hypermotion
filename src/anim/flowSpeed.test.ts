// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import type { Track } from '@/scene/types'
import { integratedFlowDistance } from './flowSpeed'

function track(values: Array<[number, number]>): Track {
  return { id: 'speed', nodeId: 'flow', propertyId: 'connection.flowSpeed', defaultEasing: 'linear', keyframes: values.map(([time, value], i) => ({ id: String(i), time, value })) }
}
describe('keyframed flow velocity integration', () => {
  it('ramps velocity continuously instead of multiplying time by current speed', () => {
    const speed = track([[0, 0], [2, 200]])
    expect(integratedFlowDistance(speed, 1)).toBeCloseTo(50)
    expect(integratedFlowDistance(speed, 2)).toBeCloseTo(200)
    expect(integratedFlowDistance(speed, 3)).toBeCloseTo(400)
    expect(integratedFlowDistance(speed, 2.001) - integratedFlowDistance(speed, 1.999)).toBeCloseTo(0.4, 3)
    expect(integratedFlowDistance(speed, 1)).toBeCloseTo(50)
  })
  it('preserves displacement when velocity pauses or reverses, including duplicate-time changes', () => {
    const speed = track([[0, 100], [1, 100], [1, 0], [2, 0], [3, -100]])
    expect(integratedFlowDistance(speed, 1)).toBeCloseTo(100)
    expect(integratedFlowDistance(speed, 2)).toBeCloseTo(100)
    expect(integratedFlowDistance(speed, 3)).toBeCloseTo(50)
    expect(integratedFlowDistance(speed, 0)).toBe(0)
  })
  it('holds the boundary speeds and integrates easing overrides deterministically', () => {
    const speed = track([[1, 100], [3, 300]])
    speed.keyframes[0]!.easingOut = 'ease-in-out'
    expect(integratedFlowDistance(speed, 1)).toBeCloseTo(100)
    expect(integratedFlowDistance(speed, 3)).toBeCloseTo(500, 3)
    expect(integratedFlowDistance(speed, -1)).toBeCloseTo(-100)
  })
})

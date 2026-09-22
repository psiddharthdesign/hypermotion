// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { beamColorPositions, beamDistribution } from './distribution'
import type { BorderBeamEffect } from '@/scene/borderBeam'
const effect: BorderBeamEffect = {kind:'border-beam',nonUniform:true,variation:1,spread:1,seed:7}
const samples = (e: BorderBeamEffect, phase=0) => Array.from({length:128},(_,i)=>beamDistribution(e,phase)(i/128))

describe('non-uniform Beam distribution', () => {
  it('makes unequal highlights and repeats exactly across seeks and the seam', () => {
    const a=samples(effect,.2)
    expect(Math.max(...a)-Math.min(...a)).toBeGreaterThan(.6)
    expect(samples(effect,.7)).not.toEqual(a)
    expect(samples(effect,.2)).toEqual(a)
    expect(beamDistribution(effect,.2)(0)).toBeCloseTo(beamDistribution(effect,.2)(1),12)
    expect(samples({...effect,seed:8},.2)).not.toEqual(a)
    expect(a.every(value=>value>=0&&value<=1)).toBe(true)
  })
  it('supports a stationary arrangement, stronger variation, and broader highlights', () => {
    expect(samples({...effect,animatePattern:false},.1)).toEqual(samples({...effect,animatePattern:false},.7))
    expect(samples({...effect,variation:0})).toEqual(Array(128).fill(1))
    expect(Math.min(...samples({...effect,variation:3}))).toBeLessThan(Math.min(...samples(effect)))
    const total=(values:number[])=>values.reduce((a,b)=>a+b,0)
    expect(total(samples({...effect,spread:2}))).toBeGreaterThan(total(samples({...effect,spread:.5})))
  })
  it('keeps color stops ordered and unequal, with even spacing when disabled', () => {
    const positions=beamColorPositions(6,effect)
    expect(positions[0]).toBe(0)
    expect(positions.at(-1)).toBe(1)
    expect(positions.every((value,i)=>i===0||value>positions[i-1])).toBe(true)
    expect(positions[1]-positions[0]).not.toBeCloseTo(positions[2]-positions[1],3)
    beamColorPositions(6,{...effect,nonUniform:false}).forEach((value,i)=>expect(value).toBeCloseTo(i/6))
    expect(beamColorPositions(6,{...effect,variation:1e6}).every(Number.isFinite)).toBe(true)
  })
})

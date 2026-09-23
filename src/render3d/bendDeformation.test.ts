// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { DEFAULT_BEND_DEFORMATION } from '@/scene/deformation'
import {
  bendDeformationInTargetSpace,
  bendPoint,
  bendPointStack,
  bendUsesDepthCompositing,
  resolveBendDeformation,
  resolveBendStackInTargetSpace,
} from './bendDeformation'

describe('bend deformation', () => {
  it('wraps the capture length around a predictable circular arc', () => {
    const bend = {
      ...DEFAULT_BEND_DEFORMATION,
      angle: 90,
      captureLength: 100,
      resolvedLength: 100,
    }
    const endpoint = bendPoint({ x: 100, y: 0, z: 0 }, bend)
    expect(endpoint.x).toBeCloseTo(200 / Math.PI, 4)
    expect(endpoint.y).toBeCloseTo(0, 6)
    expect(endpoint.z).toBeCloseTo(200 / Math.PI, 4)
  })

  it('keeps geometry beyond a limited region on its endpoint tangent', () => {
    const bend = {
      ...DEFAULT_BEND_DEFORMATION,
      angle: 90,
      captureLength: 100,
      resolvedLength: 100,
      limitToRegion: true,
    }
    const beyond = bendPoint({ x: 150, y: 0, z: 0 }, bend)
    expect(beyond.x).toBeCloseTo(200 / Math.PI, 4)
    expect(beyond.y).toBeCloseTo(0, 6)
    expect(beyond.z).toBeCloseTo(200 / Math.PI + 50, 4)
  })

  it('centers the capture range when both directions is enabled', () => {
    const bend = {
      ...DEFAULT_BEND_DEFORMATION,
      angle: 90,
      bothDirections: true,
      captureLength: 100,
      resolvedLength: 100,
    }
    expect(bendPoint({ x: -50, y: 0, z: 0 }, bend)).toEqual({
      x: -50,
      y: 0,
      z: 0,
    })
  })

  it('blends continuously with the factor control', () => {
    const full = {
      ...DEFAULT_BEND_DEFORMATION,
      angle: 90,
      factor: 1,
      captureLength: 100,
      resolvedLength: 100,
    }
    const bent = bendPoint({ x: 100, y: 0, z: 0 }, full)
    const halfway = bendPoint(
      { x: 100, y: 0, z: 0 },
      { ...full, factor: 0.5 },
    )
    expect(halfway.x).toBeCloseTo((100 + bent.x) / 2, 5)
    expect(halfway.z).toBeCloseTo(bent.z / 2, 5)
  })

  it('keeps depth compositing stable when an animated Bend settles flat', () => {
    const restingBend = {
      ...DEFAULT_BEND_DEFORMATION,
      angle: 0,
      factor: 0,
      depthAware: true,
    }

    expect(bendUsesDepthCompositing([restingBend])).toBe(true)
    expect(
      bendUsesDepthCompositing([{ ...restingBend, enabled: false }]),
    ).toBe(false)
    expect(
      bendUsesDepthCompositing([{ ...restingBend, depthAware: false }]),
    ).toBe(false)
  })

  it('resolves automatic length and live keyframe overrides', () => {
    const bend = resolveBendDeformation(
      DEFAULT_BEND_DEFORMATION,
      {
        bendAngle: -45,
        bendFactor: 0.4,
        bendCaptureLength: 240,
        bendLightAzimuth: 20,
        bendAmbient: 1.2,
        bendRoughness: 0.25,
      },
      320,
      180,
    )
    expect(bend).toMatchObject({
      angle: -45,
      factor: 0.4,
      captureLength: 240,
      resolvedLength: 240,
      lightAzimuth: 20,
      ambient: 1.2,
      roughness: 0.25,
    })
  })

  it('keeps an extracted child on the same continuous ancestor curve', () => {
    const sourceRect = { x: 100, y: 80, width: 400, height: 240 }
    const childRect = { x: 180, y: 120, width: 120, height: 64 }
    const sourceBend = {
      ...DEFAULT_BEND_DEFORMATION,
      angle: 80,
      captureLength: 400,
      resolvedLength: 400,
      captureOrigin: { x: 12, y: -8, z: 0 },
    }
    const childBend = bendDeformationInTargetSpace(
      sourceBend,
      sourceRect,
      childRect,
    )
    const childPoint = { x: 35, y: 14, z: 0 }
    const childCenterOffset = {
      x:
        childRect.x + childRect.width / 2 -
        (sourceRect.x + sourceRect.width / 2),
      y:
        childRect.y + childRect.height / 2 -
        (sourceRect.y + sourceRect.height / 2),
      z: 0,
    }
    const sourcePoint = {
      x: childPoint.x + childCenterOffset.x,
      y: childPoint.y + childCenterOffset.y,
      z: 0,
    }
    const bentInSource = bendPoint(sourcePoint, sourceBend)
    const bentInChild = bendPoint(childPoint, childBend)

    expect(bentInChild.x + childCenterOffset.x).toBeCloseTo(
      bentInSource.x,
      5,
    )
    expect(bentInChild.y + childCenterOffset.y).toBeCloseTo(
      bentInSource.y,
      5,
    )
    expect(bentInChild.z).toBeCloseTo(bentInSource.z, 5)
  })

  it('applies a child Bend before carrying it through the parent Bend', () => {
    const parent = {
      ...DEFAULT_BEND_DEFORMATION,
      angle: 70,
      captureLength: 480,
      resolvedLength: 480,
    }
    const child = {
      ...DEFAULT_BEND_DEFORMATION,
      angle: -35,
      captureLength: 240,
      resolvedLength: 240,
      captureDirection: { x: 0, y: 1, z: 0 },
    }
    const point = { x: 90, y: 30, z: 0 }

    const stacked = bendPointStack(point, [child, parent])
    const manuallyStacked = bendPoint(bendPoint(point, child), parent)

    expect(stacked.x).toBeCloseTo(manuallyStacked.x, 6)
    expect(stacked.y).toBeCloseTo(manuallyStacked.y, 6)
    expect(stacked.z).toBeCloseTo(manuallyStacked.z, 6)
    expect(stacked).not.toEqual(bendPoint(point, child))
    expect(stacked).not.toEqual(bendPoint(point, parent))
  })

  it('resolves nested animated Bend values in child-to-parent order', () => {
    const parentRect = { x: 100, y: 80, width: 480, height: 320 }
    const childRect = { x: 200, y: 140, width: 240, height: 160 }
    const stack = resolveBendStackInTargetSpace(
      [
        {
          deformation: DEFAULT_BEND_DEFORMATION,
          animated: { bendAngle: -70 },
          rect: parentRect,
        },
        {
          deformation: DEFAULT_BEND_DEFORMATION,
          animated: { bendAngle: 25 },
          rect: childRect,
        },
      ],
      childRect,
    )

    expect(stack.map((bend) => bend.angle)).toEqual([25, -70])
    expect(stack[0]?.captureOrigin).toEqual({ x: 0, y: 0, z: 0 })
    expect(stack[1]?.captureOrigin).toEqual({ x: 20, y: 20, z: 0 })
  })
})

describe('localized sine-wave deformation', () => {
  const wave = { ...DEFAULT_BEND_DEFORMATION, mode: 'wave' as const, angle: 0, waveAmplitude: 20, waveFrequency: 2, waveFalloff: 0, resolvedLength: 200 }
  it('controls amplitude, frequency, phase, and blend independently of arc angle', () => {
    expect(bendPoint({ x: -75, y: 0, z: 0 }, wave).z).toBeCloseTo(20)
    expect(bendPoint({ x: -25, y: 0, z: 0 }, wave).z).toBeCloseTo(-20)
    expect(bendPoint({ x: -75, y: 0, z: 0 }, { ...wave, waveAmplitude: 40, factor: .5 }).z).toBeCloseTo(20)
    expect(bendPoint({ x: -75, y: 0, z: 0 }, { ...wave, waveFrequency: 4 }).z).toBeCloseTo(0)
    expect(bendPoint({ x: 0, y: 0, z: 0 }, { ...wave, wavePhase: 90 }).z).toBeCloseTo(20)
    const point = { x: -75, y: 3, z: 8 }
    expect(bendPoint(point, { ...wave, waveAmplitude: 0 })).toEqual(point)
    expect(bendPoint(point, { ...wave, enabled: false })).toEqual(point)
  })
  it('keeps both boundaries and the exterior fixed, with a smooth adjustable falloff', () => {
    const region = { ...wave, waveStart: .25, waveEnd: .75, wavePhase: 90, waveFrequency: 0, waveFalloff: .2 }
    for (const x of [-100, -51, -50, 50, 51, 100]) {
      const point = { x, y: 5, z: 3 }
      expect(bendPoint(point, region)).toEqual(point)
    }
    expect(bendPoint({ x: -40, y: 0, z: 0 }, region).z).toBeCloseTo(10)
    expect(bendPoint({ x: 0, y: 0, z: 0 }, region).z).toBeCloseTo(20)
    expect(bendPoint({ x: -49.999, y: 0, z: 0 }, region).z).toBeLessThan(.00001)
    expect(bendPoint({ x: 0, y: 0, z: 0 }, { ...region, waveEnd: .25 }).z).toBe(0)
  })
  it('fits rotated rectangular layers and keeps canvas waves in the canvas plane', () => {
    const bend = resolveBendDeformation({ ...wave, captureLength: 0, captureRotation: 90, upDirection: { x: 0, y: 1, z: 0 } }, undefined, 400, 100)!
    expect(bend.resolvedLength).toBeCloseTo(100)
    const point = bendPoint({ x: 0, y: -37.5, z: 0 }, bend)
    expect(point.x).toBeCloseTo(-20)
    expect(point.y).toBeCloseTo(-37.5)
    expect(point.z).toBeCloseTo(0)
  })
  it('increases mesh detail for repeated waves and resolves animated region controls', () => {
    const bend = resolveBendDeformation(wave, { bendWaveAmplitude: 80, bendWaveFrequency: 8, bendWaveStart: .25, bendWaveEnd: .75, bendWavePhase: 720, bendWaveFalloff: .3 }, 400, 200)!
    expect(bend).toMatchObject({ waveAmplitude: 80, waveFrequency: 8, waveStart: .25, waveEnd: .75, wavePhase: 720, waveFalloff: .3, geometryDetail: 512 })
    const target = bendDeformationInTargetSpace(bend, { x: 0, y: 0, width: 400, height: 200 }, { x: 100, y: 0, width: 100, height: 200 })
    const parentPoint = bendPoint({ x: -30, y: 0, z: 0 }, bend)
    const childPoint = bendPoint({ x: 20, y: 0, z: 0 }, target)
    expect(childPoint.z).toBeCloseTo(parentPoint.z)
  })
})

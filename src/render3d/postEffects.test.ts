// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { resolveCamera3D } from './scene3d'
import {
  CHROMATIC_ABERRATION_SHADER,
  PostEffectsIdleQualityController,
  ScenePostEffectsRenderer,
  cameraPostEffectsActive,
  cameraPostEffectsEnabled,
  cameraPostEffectsInteractionChanged,
  cameraPostEffectsPixelRatio,
  chromaticAberrationUvOffset,
  normalizeCameraPostEffects,
} from './postEffects'

afterEach(() => vi.useRealTimers())

describe('camera post effects', () => {
  it('normalizes missing, malformed, and out-of-range values', () => {
    expect(normalizeCameraPostEffects({})).toEqual({
      chromaticAberrationEnabled: false,
      chromaticAberrationAmount: 4,
      chromaticAberrationAngle: 0,
      bloomEnabled: false,
      bloomStrength: 0.8,
      bloomRadius: 0.35,
      bloomThreshold: 0.75,
    })

    expect(
      normalizeCameraPostEffects({
        chromaticAberrationEnabled: true,
        chromaticAberrationAmount: Number.POSITIVE_INFINITY,
        chromaticAberrationAngle: 240,
        bloomEnabled: true,
        bloomStrength: 12,
        bloomRadius: -1,
        bloomThreshold: 2,
      }),
    ).toEqual({
      chromaticAberrationEnabled: true,
      // Non-finite values use the authored default instead of poisoning GLSL.
      chromaticAberrationAmount: 4,
      chromaticAberrationAngle: 180,
      bloomEnabled: true,
      bloomStrength: 4,
      bloomRadius: 0,
      bloomThreshold: 1,
    })
  })

  it('keeps the direct-render path for disabled or zero-strength effects', () => {
    const disabled = normalizeCameraPostEffects({})
    expect(cameraPostEffectsActive(disabled)).toBe(false)
    expect(
      cameraPostEffectsActive({
        ...disabled,
        chromaticAberrationEnabled: true,
        chromaticAberrationAmount: 0,
        bloomEnabled: true,
        bloomStrength: 0,
      }),
    ).toBe(false)
    expect(
      cameraPostEffectsActive({
        ...disabled,
        chromaticAberrationEnabled: true,
      }),
    ).toBe(true)
    expect(
      cameraPostEffectsActive({
        ...disabled,
        bloomEnabled: true,
      }),
    ).toBe(true)
  })

  it('ties resource lifetime to authored toggles, not animated zeroes', () => {
    const disabled = normalizeCameraPostEffects({})
    const zeroChromatic = normalizeCameraPostEffects({
      chromaticAberrationEnabled: true,
      chromaticAberrationAmount: 0,
    })
    const zeroBloom = normalizeCameraPostEffects({
      bloomEnabled: true,
      bloomStrength: 0,
    })

    expect(cameraPostEffectsEnabled(disabled)).toBe(false)
    expect(cameraPostEffectsEnabled(zeroChromatic)).toBe(true)
    expect(cameraPostEffectsEnabled(zeroBloom)).toBe(true)
    expect(cameraPostEffectsActive(zeroChromatic)).toBe(false)
    expect(cameraPostEffectsActive(zeroBloom)).toBe(false)
  })

  it('converts composition-pixel separation into aspect-correct UV offsets', () => {
    const horizontal = chromaticAberrationUvOffset(4, 0, 1920, 1080)
    expect(horizontal.x).toBeCloseTo(4 / 1920)
    expect(horizontal.y).toBeCloseTo(0)

    const vertical = chromaticAberrationUvOffset(4, 90, 1920, 1080)
    expect(vertical.x).toBeCloseTo(0)
    expect(vertical.y).toBeCloseTo(4 / 1080)
  })

  it('uses effect-aware realtime pixel budgets without lowering final output', () => {
    const chromatic = normalizeCameraPostEffects({
      chromaticAberrationEnabled: true,
    })
    const bloom = normalizeCameraPostEffects({ bloomEnabled: true })
    const base = {
      width: 1920,
      height: 1080,
      rendererPixelRatio: 1,
      realtime: true,
      finalRender: false,
    }
    const chromaticRatio = cameraPostEffectsPixelRatio({
      ...base,
      effects: chromatic,
    })
    const bloomRatio = cameraPostEffectsPixelRatio({
      ...base,
      effects: bloom,
    })

    expect(1920 * 1080 * chromaticRatio ** 2).toBeCloseTo(2_000_000)
    expect(1920 * 1080 * bloomRatio ** 2).toBeCloseTo(1_250_000)
    expect(bloomRatio).toBeLessThan(chromaticRatio)
    expect(
      cameraPostEffectsPixelRatio({
        ...base,
        rendererPixelRatio: 2,
        effects: bloom,
        finalRender: true,
      }),
    ).toBe(2)
    expect(
      cameraPostEffectsPixelRatio({
        ...base,
        rendererPixelRatio: 2,
        effects: bloom,
        realtime: false,
      }),
    ).toBe(2)
  })

  it('does not upscale inexpensive or already-small post-effect targets', () => {
    const effects = normalizeCameraPostEffects({
      chromaticAberrationEnabled: true,
    })
    expect(
      cameraPostEffectsPixelRatio({
        width: 960,
        height: 540,
        rendererPixelRatio: 1,
        effects,
        realtime: true,
        finalRender: false,
      }),
    ).toBe(1)
    expect(
      cameraPostEffectsPixelRatio({
        width: 3840,
        height: 2160,
        rendererPixelRatio: 0.25,
        effects,
        realtime: true,
        finalRender: false,
      }),
    ).toBe(0.25)
  })

  it('detects paused effect edits and timeline seeks', () => {
    const before = normalizeCameraPostEffects({
      chromaticAberrationEnabled: true,
    })
    const after = { ...before, chromaticAberrationAmount: 12 }

    expect(cameraPostEffectsInteractionChanged(before, before, 1, 1)).toBe(
      false,
    )
    expect(cameraPostEffectsInteractionChanged(before, after, 1, 1)).toBe(
      true,
    )
    expect(cameraPostEffectsInteractionChanged(before, before, 1, 1.25)).toBe(
      true,
    )
  })

  it('restores full quality once an interaction has been idle for 200ms', () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()
    const quality = new PostEffectsIdleQualityController(onIdle)

    quality.noteInteraction()
    expect(quality.isRealtime()).toBe(true)
    vi.advanceTimersByTime(150)
    quality.noteInteraction()
    vi.advanceTimersByTime(199)
    expect(quality.isRealtime()).toBe(true)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(quality.isRealtime()).toBe(false)
    expect(onIdle).toHaveBeenCalledTimes(1)

    quality.noteInteraction()
    quality.dispose()
    vi.runAllTimers()
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('allocates Bloom lazily, removes it when disabled, and omits depth buffers', () => {
    const renderer = {
      getPixelRatio: () => 1,
      getSize: (target: THREE.Vector2) => target.set(960, 540),
    } as unknown as THREE.WebGLRenderer
    const postEffects = new ScenePostEffectsRenderer(
      renderer,
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      960,
      540,
      1,
    )
    const chromatic = normalizeCameraPostEffects({
      chromaticAberrationEnabled: true,
    })
    postEffects.configure(chromatic, 960, 540, 1)
    expect(postEffects.getResourceProfile()).toMatchObject({
      disposed: false,
      bloomAllocated: false,
      bloomScratchTargets: 0,
    })

    postEffects.configure(
      { ...chromatic, bloomEnabled: true, bloomStrength: 0 },
      960,
      540,
      1,
    )
    expect(postEffects.getResourceProfile()).toEqual({
      disposed: false,
      bloomAllocated: true,
      bloomScratchTargets: 11,
      bloomDepthBufferedTargets: 0,
    })

    postEffects.configure(chromatic, 960, 540, 1)
    expect(postEffects.getResourceProfile().bloomAllocated).toBe(false)
    postEffects.dispose()
    postEffects.dispose()
    expect(postEffects.getResourceProfile().disposed).toBe(true)
  })

  it('resolves animated numeric parameters while keeping static enable flags', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    api.setNodeProperty(camera.id, 'chromaticAberrationEnabled', true)
    api.setNodeProperty(camera.id, 'chromaticAberrationAmount', 6)
    api.setNodeProperty(camera.id, 'chromaticAberrationAngle', 15)
    api.setNodeProperty(camera.id, 'bloomEnabled', true)
    api.setNodeProperty(camera.id, 'bloomStrength', 1.1)
    api.setNodeProperty(camera.id, 'bloomRadius', 0.4)
    api.setNodeProperty(camera.id, 'bloomThreshold', 0.7)
    const authored = api.getActiveCamera()
    if (!authored) throw new Error('Expected the updated camera')

    const resolved = resolveCamera3D(
      authored,
      {
        chromaticAberrationAmount: 10,
        chromaticAberrationAngle: -45,
        bloomStrength: 2,
        bloomRadius: 0.6,
        bloomThreshold: 0.25,
      },
      { width: 960, height: 540 },
    )
    expect(resolved).toMatchObject({
      chromaticAberrationEnabled: true,
      chromaticAberrationAmount: 10,
      chromaticAberrationAngle: -45,
      bloomEnabled: true,
      bloomStrength: 2,
      bloomRadius: 0.6,
      bloomThreshold: 0.25,
    })
  })

  it('uses separate red, centered green, and blue samples in the shader', () => {
    expect(CHROMATIC_ABERRATION_SHADER.fragmentShader).toContain(
      'vUv + offsetUv',
    )
    expect(CHROMATIC_ABERRATION_SHADER.fragmentShader).toContain(
      'vUv - offsetUv',
    )
    expect(CHROMATIC_ABERRATION_SHADER.fragmentShader).toContain(
      'redSample.r',
    )
    expect(CHROMATIC_ABERRATION_SHADER.fragmentShader).toContain(
      'centerSample.g',
    )
    expect(CHROMATIC_ABERRATION_SHADER.fragmentShader).toContain(
      'blueSample.b',
    )
    expect(CHROMATIC_ABERRATION_SHADER.fragmentShader).toContain(
      'sampleWithinFrame',
    )
    expect(CHROMATIC_ABERRATION_SHADER.fragmentShader).toContain(
      'lowerBound.x * lowerBound.y * upperBound.x * upperBound.y',
    )
    expect(CHROMATIC_ABERRATION_SHADER.fragmentShader).toContain(
      '#include <tonemapping_fragment>',
    )
    expect(CHROMATIC_ABERRATION_SHADER.fragmentShader).toContain(
      '#include <colorspace_fragment>',
    )
  })
})

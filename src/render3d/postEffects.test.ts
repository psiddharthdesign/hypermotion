// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { resolveCamera3D } from './scene3d'
import { bloomReferenceSize, SceneBloomPass } from './SceneBloomPass'
import {
  CHROMATIC_ABERRATION_SHADER,
  PostEffectsIdleQualityController,
  ScenePostEffectsRenderer,
  VHS_SHADER,
  VIGNETTE_SHADER,
  cameraPostEffectsActive,
  cameraPostEffectsEnabled,
  cameraPostEffectsInteractionChanged,
  cameraPostEffectsPixelRatio,
  cameraVignetteMultiplier,
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
      vhsEnabled: false,
      vhsIntensity: 0.65,
      vhsNoise: 0.35,
      vhsScanlines: 0.5,
      vhsColorBleed: 3,
      vignetteEnabled: false,
      vignetteAmount: 0.35,
      vignetteSize: 0.5,
      vignetteFeather: 0.5,
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
        vhsEnabled: true,
        vhsIntensity: 9,
        vhsNoise: -2,
        vhsScanlines: Number.NaN,
        vhsColorBleed: 80,
        vignetteEnabled: true,
        vignetteAmount: 2,
        vignetteSize: -1,
        vignetteFeather: Number.NaN,
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
      vhsEnabled: true,
      vhsIntensity: 1,
      vhsNoise: 0,
      vhsScanlines: 0.5,
      vhsColorBleed: 32,
      vignetteEnabled: true,
      vignetteAmount: 1,
      vignetteSize: 0,
      vignetteFeather: 0.5,
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
        vhsEnabled: true,
        vhsIntensity: 0,
        vignetteEnabled: true,
        vignetteAmount: 0,
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
    expect(
      cameraPostEffectsActive({
        ...disabled,
        vhsEnabled: true,
      }),
    ).toBe(true)
    expect(cameraPostEffectsActive({ ...disabled, vignetteEnabled: true })).toBe(true)
    expect(cameraPostEffectsActive({
      ...disabled,
      vignetteEnabled: true,
      vignetteSize: 1,
    })).toBe(false)
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
    const zeroVhs = normalizeCameraPostEffects({
      vhsEnabled: true,
      vhsIntensity: 0,
    })
    const zeroVignette = normalizeCameraPostEffects({
      vignetteEnabled: true,
      vignetteAmount: 0,
    })

    expect(cameraPostEffectsEnabled(disabled)).toBe(false)
    expect(cameraPostEffectsEnabled(zeroChromatic)).toBe(true)
    expect(cameraPostEffectsEnabled(zeroBloom)).toBe(true)
    expect(cameraPostEffectsEnabled(zeroVhs)).toBe(true)
    expect(cameraPostEffectsEnabled(zeroVignette)).toBe(true)
    expect(cameraPostEffectsActive(zeroChromatic)).toBe(false)
    expect(cameraPostEffectsActive(zeroBloom)).toBe(false)
    expect(cameraPostEffectsActive(zeroVhs)).toBe(false)
    expect(cameraPostEffectsActive(zeroVignette)).toBe(false)
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
    const vhsAfter = { ...before, vhsNoise: 0.8 }

    expect(cameraPostEffectsInteractionChanged(before, before, 1, 1)).toBe(
      false,
    )
    expect(cameraPostEffectsInteractionChanged(before, after, 1, 1)).toBe(
      true,
    )
    expect(
      cameraPostEffectsInteractionChanged(before, vhsAfter, 1, 1),
    ).toBe(true)
    for (const vignetteChange of [
      { vignetteEnabled: true },
      { vignetteAmount: 0.8 },
      { vignetteSize: 0.8 },
      { vignetteFeather: 0.8 },
    ]) {
      expect(cameraPostEffectsInteractionChanged(
        before, { ...before, ...vignetteChange }, 1, 1,
      )).toBe(true)
    }
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

  it('keeps the bloom footprint stable from fitted preview through 4K and 2x stills', () => {
    const bloom = new SceneBloomPass(960, 540, () => undefined)
    const blurSizes = () => bloom.renderTargetsHorizontal.map((target) => [target.width, target.height])
    const previewSizes = blurSizes()
    expect(previewSizes).toEqual([[480, 270], [240, 135], [120, 68], [60, 34], [30, 17]])

    for (const [width, height] of [[3840, 2160], [7680, 4320], [1920, 1080], [480, 270]]) {
      bloom.setSize(width, height)
      expect(blurSizes()).toEqual(previewSizes)
      expect(bloom.renderTargetBright.width).toBe(480)
      expect(bloom.renderTargetBright.height).toBe(270)
      expect(bloom.getScratchTargets().every((target) => !target.depthBuffer)).toBe(true)
    }
    bloom.dispose()
  })

  it('normalizes bloom resolution by frame aspect rather than output size', () => {
    expect(bloomReferenceSize(7680, 4320)).toEqual({ width: 960, height: 540 })
    expect(bloomReferenceSize(960, 540)).toEqual({ width: 960, height: 540 })
    expect(bloomReferenceSize(540, 960)).toEqual({ width: 540, height: 960 })
    expect(bloomReferenceSize(1080, 1920)).toEqual({ width: 540, height: 960 })
    expect(bloomReferenceSize(4001, 2251)).toEqual({ width: 960, height: 540 })
  })

  it('extracts a canonical scene render but adds bloom onto the untouched full-resolution scene', () => {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    const renderSource = vi.fn((renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) => {
      renderer.setRenderTarget(target)
      renderer.clear()
      renderer.render(scene, camera)
    })
    const bloom = new SceneBloomPass(7680, 4320, renderSource)
    const source = new THREE.WebGLRenderTarget(7680, 4320)
    const output = source.clone()
    let target: THREE.WebGLRenderTarget | null = null
    const draws: {
      material: THREE.ShaderMaterial
      target: THREE.WebGLRenderTarget | null
      source: THREE.Texture | null
    }[] = []
    const renderer = {
      autoClear: true,
      getRenderTarget: () => target,
      setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { target = next },
      getClearColor: (color: THREE.Color) => color.set('#000'),
      getClearAlpha: () => 1,
      setClearColor: () => undefined,
      clear: () => undefined,
      render: (object: THREE.Object3D) => {
        if (!(object instanceof THREE.Mesh)) return
        const material = object.material as THREE.ShaderMaterial
        draws.push({
          material,
          target,
          source: material.uniforms.hmBloomSource?.value ?? material.uniforms.tDiffuse?.value ?? null,
        })
      },
    } as unknown as THREE.WebGLRenderer
    bloom.render(renderer, output, source, 0, false)

    expect(renderSource).toHaveBeenCalledOnce()
    const canonical = renderSource.mock.calls[0][1]
    expect([canonical.width, canonical.height]).toEqual([960, 540])
    expect(canonical.depthBuffer).toBe(true)
    expect(canonical.texture.type).toBe(THREE.HalfFloatType)
    expect(canonical.texture.colorSpace).toBe(THREE.NoColorSpace)
    expect(canonical.texture.userData.hyperMotionBloomSource).toBe(true)
    const highPass = draws.find((draw) => draw.material === bloom.materialHighPassFilter)!
    expect(highPass.source).toBe(canonical.texture)
    expect(highPass.target).toBe(bloom.renderTargetBright)
    expect(bloom.materialHighPassFilter.fragmentShader).toContain('texture2D( hmBloomSource, vUv )')
    expect(draws.at(-1)?.material).toBe(bloom.blendMaterial)
    expect(draws.at(-1)?.target).toBe(source)
    expect([source.width, source.height]).toEqual([7680, 4320])

    bloom.render(renderer, output, source, 0, false)
    expect(renderSource.mock.calls[1][1]).toBe(canonical)
    const disposeCanonical = vi.spyOn(canonical, 'dispose')
    const disposeHighPass = vi.spyOn(bloom.materialHighPassFilter, 'dispose')
    bloom.setSize(960, 540)
    expect(disposeCanonical).not.toHaveBeenCalled()
    expect(bloom.getScratchTargets()).toHaveLength(12)

    source.setSize(960, 540)
    renderSource.mockClear()
    draws.length = 0
    bloom.render(renderer, output, source, 0, false)
    expect(renderSource).toHaveBeenCalledOnce()
    expect(renderSource.mock.calls[0][1]).toBe(canonical)
    expect(draws.find((draw) => draw.material === bloom.materialHighPassFilter)?.source).toBe(canonical.texture)
    bloom.dispose()
    expect(disposeCanonical).toHaveBeenCalledOnce()
    expect(disposeHighPass).toHaveBeenCalledOnce()
    source.dispose()
    output.dispose()
  })

  it('restores the current render target and clear policy when the canonical draw fails', () => {
    const source = new THREE.WebGLRenderTarget(3840, 2160)
    let target: THREE.WebGLRenderTarget | null = source
    const renderer = {
      autoClear: true,
      getRenderTarget: () => target,
      setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { target = next },
    } as unknown as THREE.WebGLRenderer
    const bloom = new SceneBloomPass(3840, 2160, (activeRenderer, canonical) => {
      activeRenderer.setRenderTarget(canonical)
      activeRenderer.autoClear = false
      throw new Error('Interrupted canonical draw')
    })
    expect(() => bloom.render(renderer, source, source, 0, false)).toThrow('Interrupted canonical draw')
    expect(target).toBe(source)
    expect(renderer.autoClear).toBe(true)
    bloom.dispose()
    source.dispose()
  })

  it('applies canonical texture swaps only around the bloom source scene render', () => {
    const scene = new THREE.Scene()
    let target: THREE.WebGLRenderTarget | null = null
    let canonicalTextures = false
    const sceneDraws: { width: number; canonicalTextures: boolean }[] = []
    const renderer = {
      autoClear: true,
      getPixelRatio: () => 1,
      getSize: (size: THREE.Vector2) => size.set(3840, 2160),
      getRenderTarget: () => target,
      setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { target = next },
      getClearColor: (color: THREE.Color) => color.set('#000'),
      getClearAlpha: () => 1,
      setClearColor: () => undefined,
      clear: () => undefined,
      render: (object: THREE.Object3D) => {
        if (object === scene) sceneDraws.push({ width: target!.width, canonicalTextures })
      },
    } as unknown as THREE.WebGLRenderer
    const withBloomSource = vi.fn((draw: () => void) => {
      canonicalTextures = true
      try { draw() } finally { canonicalTextures = false }
    })
    const postEffects = new ScenePostEffectsRenderer(
      renderer, scene, new THREE.PerspectiveCamera(), 3840, 2160, 1, withBloomSource,
    )
    postEffects.configure(normalizeCameraPostEffects({
      bloomEnabled: true,
      chromaticAberrationEnabled: true,
    }), 3840, 2160, 1)
    postEffects.render()
    expect(withBloomSource).toHaveBeenCalledOnce()
    expect(sceneDraws).toEqual([
      { width: 3840, canonicalTextures: false },
      { width: 960, canonicalTextures: true },
    ])
    expect(canonicalTextures).toBe(false)
    postEffects.dispose()
  })

  it('renders vignette last and updates its uniforms without replacing the pass', () => {
    let target: THREE.WebGLRenderTarget | null = null
    const draws: { material: THREE.ShaderMaterial; toScreen: boolean }[] = []
    const renderer = {
      getPixelRatio: () => 1,
      getSize: (size: THREE.Vector2) => size.set(960, 540),
      getRenderTarget: () => target,
      setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { target = next },
      clear: () => undefined,
      render: (object: THREE.Object3D) => {
        if (object instanceof THREE.Mesh) {
          draws.push({ material: object.material, toScreen: target === null })
        }
      },
    } as unknown as THREE.WebGLRenderer
    const postEffects = new ScenePostEffectsRenderer(
      renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), 960, 540, 1,
    )
    const effects = normalizeCameraPostEffects({
      chromaticAberrationEnabled: true,
      vhsEnabled: true,
      vignetteEnabled: true,
    })
    postEffects.configure(effects, 960, 540, 1)
    postEffects.render()
    expect(draws.map(draw => [draw.material.name, draw.toScreen])).toEqual([
      ['HyperMotionVHS', false],
      ['HyperMotionChromaticAberration', false],
      ['HyperMotionVignette', true],
    ])
    const vignetteMaterial = draws[2].material
    const dispose = vi.spyOn(vignetteMaterial, 'dispose')
    draws.length = 0
    postEffects.configure({
      ...effects, vignetteAmount: 0.8, vignetteSize: 0.2, vignetteFeather: 0.1,
    }, 960, 540, 2)
    postEffects.render()
    expect(draws[2].material).toBe(vignetteMaterial)
    expect(vignetteMaterial.uniforms.hmAmount.value).toBe(0.8)
    expect(vignetteMaterial.uniforms.hmSize.value).toBe(0.2)
    expect(vignetteMaterial.uniforms.hmFeather.value).toBe(0.1)
    draws.length = 0
    postEffects.configure({ ...effects, vignetteAmount: 0 }, 960, 540, 1)
    postEffects.render()
    expect(draws.map(draw => [draw.material.name, draw.toScreen])).toEqual([
      ['HyperMotionVHS', false],
      ['HyperMotionChromaticAberration', true],
    ])
    postEffects.dispose()
    expect(dispose).toHaveBeenCalledOnce()
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
    api.setNodeProperty(camera.id, 'vhsEnabled', true)
    api.setNodeProperty(camera.id, 'vhsIntensity', 0.6)
    api.setNodeProperty(camera.id, 'vhsNoise', 0.3)
    api.setNodeProperty(camera.id, 'vhsScanlines', 0.4)
    api.setNodeProperty(camera.id, 'vhsColorBleed', 4)
    api.setNodeProperty(camera.id, 'vignetteEnabled', true)
    api.setNodeProperty(camera.id, 'vignetteAmount', 0.2)
    api.setNodeProperty(camera.id, 'vignetteSize', 0.3)
    api.setNodeProperty(camera.id, 'vignetteFeather', 0.4)
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
        vhsIntensity: 0.9,
        vhsNoise: 0.7,
        vhsScanlines: 0.8,
        vhsColorBleed: 7,
        vignetteAmount: 0.7,
        vignetteSize: 0.6,
        vignetteFeather: 0.2,
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
      vhsEnabled: true,
      vhsIntensity: 0.9,
      vhsNoise: 0.7,
      vhsScanlines: 0.8,
      vhsColorBleed: 7,
      vignetteEnabled: true,
      vignetteAmount: 0.7,
      vignetteSize: 0.6,
      vignetteFeather: 0.2,
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
      'texture2D(tDiffuse, clamp(uv, vec2(0.0), vec2(1.0)))',
    )
    expect(CHROMATIC_ABERRATION_SHADER.fragmentShader).not.toContain('coverage')
    expect(CHROMATIC_ABERRATION_SHADER.fragmentShader).toContain(
      'max(centerSample.a, max(redSample.a, blueSample.a))',
    )
    expect(CHROMATIC_ABERRATION_SHADER.fragmentShader).toContain(
      '#include <tonemapping_fragment>',
    )
    expect(CHROMATIC_ABERRATION_SHADER.fragmentShader).toContain(
      '#include <colorspace_fragment>',
    )
  })

  it('builds VHS variation only from scene time and composition pixels', () => {
    expect(VHS_SHADER.uniforms).toHaveProperty('hmTime')
    expect(VHS_SHADER.uniforms).toHaveProperty('hmResolution')
    expect(VHS_SHADER.fragmentShader).toContain(
      'floor(sceneTime * 60.0 + 0.0001)',
    )
    expect(VHS_SHADER.fragmentShader).toContain('floor(vUv * resolution)')
    expect(VHS_SHADER.fragmentShader).toContain(
      'hmColorBleedPx * amount / resolution.x',
    )
    expect(VHS_SHADER.fragmentShader).toContain('hash21')
    expect(VHS_SHADER.fragmentShader).not.toContain('random(')
    expect(VHS_SHADER.fragmentShader).not.toContain('tonemapping_fragment')
    expect(VHS_SHADER.fragmentShader).not.toContain('colorspace_fragment')
  })

  it('keeps the vignette center clear and applies a smooth darkening at corners', () => {
    const effects = normalizeCameraPostEffects({ vignetteEnabled: true })
    expect(cameraVignetteMultiplier(0, effects)).toBe(1)
    expect(cameraVignetteMultiplier(0.5, effects)).toBe(1)
    expect(cameraVignetteMultiplier(0.75, effects)).toBeCloseTo(0.825)
    expect(cameraVignetteMultiplier(1, effects)).toBeCloseTo(0.65)
    expect(cameraVignetteMultiplier(1, { ...effects, vignetteAmount: 0 })).toBe(1)
    expect(cameraVignetteMultiplier(1, { ...effects, vignetteSize: 1 })).toBe(1)
    expect(cameraVignetteMultiplier(0.5, { ...effects, vignetteFeather: 0 })).toBe(1)
    expect(cameraVignetteMultiplier(0.501, { ...effects, vignetteFeather: 0 })).toBeCloseTo(0.65)
    expect(VIGNETTE_SHADER.fragmentShader).toContain('source.a')
    expect(VIGNETTE_SHADER.fragmentShader).toContain('length((vUv - 0.5) * 2.0) / sqrt(2.0)')
    expect(VIGNETTE_SHADER.fragmentShader).toContain('source.rgb * (1.0 - hmAmount * mask)')
  })
})

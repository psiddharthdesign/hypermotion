// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { installDepthOfFieldRenderTargetScale } from './depthOfFieldRenderTarget'
import {
  createApertureKernel,
  updateDepthOfFieldShader,
  type PlaneDepthOfFieldShaderState,
} from './depthOfFieldShader'
import { updateTextSegmentMaterialShader } from './textSegmentMaterial'
import {
  cameraPostEffectsPixelRatio,
  normalizeCameraPostEffects,
} from './postEffects'

const state: PlaneDepthOfFieldShaderState = {
  enabled: true,
  blurPx: 24,
  minimumBlurPx: 0,
  planeWidth: 400,
  planeHeight: 240,
  focusMask: true,
  focusX: 480,
  focusY: 270,
  focusRadius: 64,
  focusFalloff: 80,
  screenPixelRatio: 2,
  sampleCount: 24,
  bladeCount: 7,
  bladeRotation: 0,
  bokehRatio: 1,
}

function rendererFixture() {
  const logicalSize = new THREE.Vector2(1920, 1080)
  const viewport = new THREE.Vector4(0, 0, 3840, 2160)
  return {
    logicalSize,
    viewport,
    renderer: {
      getSize: (target: THREE.Vector2) => target.copy(logicalSize),
      getCurrentViewport: (target: THREE.Vector4) => target.copy(viewport),
      getPixelRatio: () => 2,
      getRenderTarget: () => null,
    } as THREE.WebGLRenderer,
  }
}

function draw(material: THREE.MeshBasicMaterial, renderer: THREE.WebGLRenderer) {
  material.onBeforeRender(
    renderer,
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    new THREE.BufferGeometry(),
    new THREE.Mesh(),
    null as never,
  )
}

describe('depth-of-field render-target density', () => {
  it.each([
    ['canvas and video planes', updateDepthOfFieldShader],
    ['segmented text', updateTextSegmentMaterialShader],
  ] as const)('keeps Point focus and lens radius stable in a reduced bloom target for %s', (_name, update) => {
    const material = new THREE.MeshBasicMaterial()
    update(material, state)
    installDepthOfFieldRenderTargetScale(material)
    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    }
    material.onBeforeCompile(shader as never, {} as never)
    const { renderer, logicalSize, viewport } = rendererFixture()
    const targetRatio = cameraPostEffectsPixelRatio({
      width: logicalSize.x,
      height: logicalSize.y,
      rendererPixelRatio: renderer.getPixelRatio(),
      effects: normalizeCameraPostEffects({ bloomEnabled: true }),
      realtime: true,
      finalRender: false,
    })
    expect(targetRatio).toBeLessThan(renderer.getPixelRatio())
    viewport.set(0, 0, logicalSize.x * targetRatio, logicalSize.y * targetRatio)
    draw(material, renderer)

    // Check the uniform object handed to the compiled shader, not a copied
    // policy value. Fragment coordinates and tap offsets share this density.
    const shaderRatio = shader.uniforms.hmScreenPixelRatio!.value
    expect(state.focusX * targetRatio / shaderRatio).toBeCloseTo(state.focusX)
    expect(state.focusY * targetRatio / shaderRatio).toBeCloseTo(state.focusY)
    expect(state.blurPx * shaderRatio / targetRatio).toBeCloseTo(state.blurPx)
  })

  it('follows idle, direct, outgoing-camera, and export targets without rebuilding planes', () => {
    const material = new THREE.MeshBasicMaterial()
    updateDepthOfFieldShader(material, state)
    installDepthOfFieldRenderTargetScale(material)
    const { renderer, logicalSize, viewport } = rendererFixture()
    const version = material.version
    const uniforms = material.userData.hyperMotionDofUniforms
    for (const ratio of [0.5, 2, 1, 4]) {
      viewport.set(0, 0, logicalSize.x * ratio, logicalSize.y * ratio)
      draw(material, renderer)
      expect(uniforms.hmScreenPixelRatio.value).toBe(ratio)
      expect(material.version).toBe(version)
      expect(material.userData.hyperMotionDofUniforms).toBe(uniforms)
    }
  })

  it('restores the actual target density after a normal plane synchronization', () => {
    const material = new THREE.MeshBasicMaterial()
    updateTextSegmentMaterialShader(material, state)
    const previousDraw = vi.fn()
    material.onBeforeRender = previousDraw
    installDepthOfFieldRenderTargetScale(material)
    const { renderer, viewport } = rendererFixture()
    viewport.set(0, 0, 960, 540)
    draw(material, renderer)
    expect(material.userData.hyperMotionDofUniforms.hmScreenPixelRatio.value).toBe(0.5)

    updateTextSegmentMaterialShader(material, { ...state, blurPx: 32 })
    expect(material.userData.hyperMotionDofUniforms.hmScreenPixelRatio.value).toBe(2)
    draw(material, renderer)
    expect(material.userData.hyperMotionDofUniforms.hmScreenPixelRatio.value).toBe(0.5)
    expect(material.userData.hyperMotionDofUniforms.hmDofBlur.value).toBe(32)
    expect(previousDraw).toHaveBeenCalledTimes(2)
    expect(previousDraw.mock.calls[1]![0]).toBe(renderer)
  })

  it.each([
    ['canvas and video planes', updateDepthOfFieldShader],
    ['segmented text', updateTextSegmentMaterialShader],
  ] as const)('uses the same canonical aperture across normal sample budgets for %s', (_name, update) => {
    const material = new THREE.MeshBasicMaterial()
    installDepthOfFieldRenderTargetScale(material)
    const { renderer } = rendererFixture()
    const sourceTarget = new THREE.WebGLRenderTarget(960, 540)
    sourceTarget.texture.userData.hyperMotionBloomSource = true
    let target: THREE.WebGLRenderTarget | null = null
    renderer.getRenderTarget = () => target
    let canonicalKernel: THREE.Vector2[] | undefined
    for (const sampleCount of [3, 4, 6, 8, 12, 24, 48]) {
      update(material, { ...state, sampleCount })
      const uniforms = material.userData.hyperMotionDofUniforms
      const normalKernel = uniforms.hmDofKernel.value
      const version = material.version
      target = sourceTarget
      draw(material, renderer)
      expect(uniforms.hmSampleCount.value).toBe(48)
      canonicalKernel ??= uniforms.hmDofKernel.value
      expect(uniforms.hmDofKernel.value).toBe(canonicalKernel)
      expect(canonicalKernel!.map(point => ({ x: point.x, y: point.y })))
        .toEqual(createApertureKernel(48, state.bladeCount, state.bladeRotation, state.bokehRatio))
      target = null
      draw(material, renderer)
      expect(uniforms.hmSampleCount.value).toBe(sampleCount)
      expect(uniforms.hmDofKernel.value).toBe(normalKernel)
      expect(material.version).toBe(version)
    }
    sourceTarget.dispose()
  })

  it('restores newly synchronized lens settings instead of a stale pre-bloom snapshot', () => {
    const material = new THREE.MeshBasicMaterial()
    updateDepthOfFieldShader(material, { ...state, sampleCount: 6 })
    installDepthOfFieldRenderTargetScale(material)
    const { renderer } = rendererFixture()
    const sourceTarget = new THREE.WebGLRenderTarget(960, 540)
    sourceTarget.texture.userData.hyperMotionBloomSource = true
    let target: THREE.WebGLRenderTarget | null = sourceTarget
    renderer.getRenderTarget = () => target
    draw(material, renderer)
    const uniforms = material.userData.hyperMotionDofUniforms
    const firstBloomKernel = uniforms.hmDofKernel.value

    updateDepthOfFieldShader(material, {
      ...state, sampleCount: 24, bladeCount: 5, bladeRotation: 45, bokehRatio: 2,
    })
    const updatedKernel = uniforms.hmDofKernel.value
    target = null
    draw(material, renderer)
    expect(uniforms.hmSampleCount.value).toBe(24)
    expect(uniforms.hmDofKernel.value).toBe(updatedKernel)
    target = sourceTarget
    draw(material, renderer)
    expect(uniforms.hmSampleCount.value).toBe(48)
    expect(uniforms.hmDofKernel.value).not.toBe(firstBloomKernel)
    expect(uniforms.hmDofKernel.value.map((point: THREE.Vector2) => ({ x: point.x, y: point.y })))
      .toEqual(createApertureKernel(48, 5, 45, 2))
    sourceTarget.dispose()
  })
})

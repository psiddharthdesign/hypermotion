// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  createApertureKernel,
  depthOfFieldSampleCount,
  installDepthOfFieldShader,
  MAX_DOF_KERNEL_SAMPLES,
  updateDepthOfFieldShader,
} from './depthOfFieldShader'

describe('GPU depth-of-field policy', () => {
  it('caps timeline and camera interaction at the realtime sample budget', () => {
    expect(
      depthOfFieldSampleCount('high', 32, {
        playing: true,
        interactive: false,
        finalRender: false,
      }),
    ).toBe(6)
    expect(
      depthOfFieldSampleCount('high', 32, {
        playing: false,
        interactive: true,
        finalRender: false,
      }),
    ).toBe(6)
  })

  it('uses progressively larger paused-preview and bounded export budgets', () => {
    const still = { playing: false, interactive: false, finalRender: false }
    expect(depthOfFieldSampleCount('draft', 8, still)).toBe(6)
    expect(depthOfFieldSampleCount('balanced', 8, still)).toBe(24)
    expect(depthOfFieldSampleCount('high', 8, still)).toBe(48)
    expect(
      depthOfFieldSampleCount('high', 8, {
        ...still,
        finalRender: true,
      }),
    ).toBe(24)
    expect(
      depthOfFieldSampleCount('high', 32, {
        ...still,
        finalRender: true,
      }),
    ).toBe(32)
    expect(
      depthOfFieldSampleCount('high', 100, {
        ...still,
        finalRender: true,
      }),
    ).toBe(MAX_DOF_KERNEL_SAMPLES)
  })

  it('builds a stable polygonal/anamorphic aperture kernel', () => {
    const circle = createApertureKernel(24, 16, 0, 1)
    const anamorphic = createApertureKernel(24, 6, 0, 4)
    const rotated = createApertureKernel(24, 6, 90, 1)
    const unrotated = createApertureKernel(24, 6, 0, 1)
    const extent = (points: Array<{ x: number; y: number }>) => ({
      x: Math.max(...points.map((point) => Math.abs(point.x))),
      y: Math.max(...points.map((point) => Math.abs(point.y))),
    })

    expect(circle).toHaveLength(24)
    expect(extent(anamorphic).x).toBeGreaterThan(extent(anamorphic).y * 2)
    expect(rotated[0]!.x).not.toBeCloseTo(unrotated[0]!.x, 3)
    expect(rotated[0]!.y).not.toBeCloseTo(unrotated[0]!.y, 3)
  })

  it('keeps blur radius stable when the realtime sample budget is smaller', () => {
    const radius = (point: { x: number; y: number }) =>
      Math.hypot(point.x, point.y)
    const realtime = createApertureKernel(6, 7, 0, 1)
    const high = createApertureKernel(16, 7, 0, 1)

    expect(Math.max(...realtime.map(radius))).toBeGreaterThan(0.8)
    expect(Math.max(...high.map(radius))).toBeGreaterThan(0.8)
  })

  it('centres every sample budget so playback does not shift the image', () => {
    for (const sampleCount of [6, 16, 24]) {
      const kernel = createApertureKernel(sampleCount, 3, 0, 4)
      const centroid = kernel.reduce(
        (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
        { x: 0, y: 0 },
      )
      expect(centroid.x / kernel.length).toBeCloseTo(0, 12)
      expect(centroid.y / kernel.length).toBeCloseTo(0, 12)
    }
  })

  it('injects the cached-texture bokeh sampler into MeshBasicMaterial', () => {
    const material = new THREE.MeshBasicMaterial()
    installDepthOfFieldShader(material)
    updateDepthOfFieldShader(material, {
      enabled: true,
      blurPx: 12,
      minimumBlurPx: 3,
      planeWidth: 400,
      planeHeight: 240,
      focusMask: true,
      focusX: 200,
      focusY: 120,
      focusRadius: 40,
      focusFalloff: 80,
      sampleCount: 10,
      bladeCount: 7,
      bladeRotation: 15,
      bokehRatio: 1.2,
    })
    const shader = {
      uniforms: {},
      vertexShader: '',
      fragmentShader:
        '#include <map_pars_fragment>\nvoid main(){\n#include <map_fragment>\n}',
    }

    material.onBeforeCompile(shader as never, {} as never)

    expect(shader.fragmentShader).toContain('uniform vec2 hmDofKernel[48]')
    expect(shader.fragmentShader).toContain('hmPremultiplied')
    expect(shader.fragmentShader).toContain('float hmWeight = 0.0')
    expect(shader.fragmentShader).toContain('float hmMipBias')
    expect(shader.fragmentShader).toContain('hmApertureStretch')
    expect(shader.fragmentShader).toContain('/ sqrt(24.0)')
    expect(shader.fragmentShader).not.toContain('sqrt(max(hmSampleCount')
    expect(shader.fragmentShader).toContain('float hmInside')
    expect(shader.fragmentShader).toContain('hmTap *= hmInside')
    expect(shader.fragmentShader).toContain('texture2D( map, hmUv, hmMipBias )')
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>')
    expect(Object.keys(shader.uniforms)).toContain('hmDofBlur')
  })

  it('reinstalls uniforms after Fast Refresh leaves an older shader schema', () => {
    const material = new THREE.MeshBasicMaterial()
    material.userData.hyperMotionDofShaderKey = 'hypermotion-gpu-dof-v2'
    material.userData.hyperMotionDofUniforms = {
      hmDofEnabled: { value: 1 },
      hmDofBlur: { value: 8 },
    }
    const versionBefore = material.version

    expect(() =>
      updateDepthOfFieldShader(material, {
        enabled: true,
        blurPx: 8,
        minimumBlurPx: 2,
        planeWidth: 320,
        planeHeight: 180,
        focusMask: false,
        focusX: 0,
        focusY: 0,
        focusRadius: 0,
        focusFalloff: 1,
        sampleCount: 6,
        bladeCount: 7,
        bladeRotation: 0,
        bokehRatio: 1,
      }),
    ).not.toThrow()
    expect(material.userData.hyperMotionDofUniforms.hmDofMinBlur.value).toBe(2)
    expect(material.version).toBeGreaterThan(versionBefore)
  })
})

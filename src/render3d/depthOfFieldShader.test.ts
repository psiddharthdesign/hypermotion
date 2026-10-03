// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  bendLightDirection,
  createApertureKernel,
  depthOfFieldSampleCount,
  installDepthOfFieldShader,
  MAX_BEND_DEFORMERS,
  MAX_DOF_KERNEL_SAMPLES,
  updateDepthOfFieldShader,
  updateDepthFocusPlane,
  type PlaneDepthOfFieldShaderState,
} from './depthOfFieldShader'

const depthFocusState: PlaneDepthOfFieldShaderState = {
  enabled: true, blurPx: 0, minimumBlurPx: 0,
  planeWidth: 400, planeHeight: 240,
  focusMask: false, focusX: 0, focusY: 0, focusRadius: 0, focusFalloff: 1,
  screenPixelRatio: 1, sampleCount: 24, bladeCount: 7, bladeRotation: 0, bokehRatio: 1,
  depthFocus: { normal: { x: 0, y: 0, z: 1 }, constant: 1000, depthScale: 350, aperture: 1, maxBlurPx: 24 },
}

describe('GPU depth-of-field policy', () => {
  it('keeps depth blur active when the card centre lies exactly on the focus plane', () => {
    const material = new THREE.MeshBasicMaterial()
    updateDepthOfFieldShader(material, depthFocusState)
    const uniforms = material.userData.hyperMotionDofUniforms
    expect(uniforms.hmDofEnabled.value).toBe(1)
    expect(uniforms.hmDofBlur.value).toBe(0)
    expect(uniforms.hmDepthFocusEnabled.value).toBe(1)
    expect(uniforms.hmDepthFocusPlane.value.toArray()).toEqual([0, 0, 1, 1000])
    expect(uniforms.hmDepthFocusMaxBlur.value).toBe(24)
  })

  it('uses final projected vertex depth after Bend, batching and instancing', () => {
    const material = new THREE.MeshBasicMaterial()
    updateDepthOfFieldShader(material, { ...depthFocusState, blurPx: 18, minimumBlurPx: 18 })
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    }
    material.onBeforeCompile(shader as never, {} as never)
    const vertex = shader.vertexShader.replace('#include <project_vertex>', THREE.ShaderChunk.project_vertex)
    const capture = vertex.indexOf('hmBentViewPosition = mvPosition.xyz;')
    expect(capture).toBeGreaterThan(vertex.indexOf('transformed = hmApplyBendStack(transformed);'))
    expect(capture).toBeGreaterThan(vertex.indexOf('mvPosition = batchingMatrix * mvPosition;'))
    expect(capture).toBeGreaterThan(vertex.indexOf('mvPosition = instanceMatrix * mvPosition;'))
    expect(capture).toBeGreaterThan(vertex.indexOf('mvPosition = modelViewMatrix * mvPosition;'))
    const depthBranch = shader.fragmentShader.slice(
      shader.fragmentShader.indexOf('if ( hmDepthFocusEnabled'),
      shader.fragmentShader.indexOf('float hmLocalBlur = hmLensBlur;'),
    )
    expect(depthBranch).toContain('dot( hmDepthFocusPlane.xyz, hmBentViewPosition ) + hmDepthFocusPlane.w')
    expect(depthBranch).toContain('hmLensBlur = hmDepthFocusMaxBlur * (')
    expect(depthBranch).not.toContain('hmDofMinBlur')
    expect(depthBranch).not.toContain('hmDofBlur')
  })

  it('updates and normalizes focus planes without rebuilding the shader', () => {
    const material = new THREE.MeshBasicMaterial()
    updateDepthOfFieldShader(material, depthFocusState)
    const version = material.version
    const compile = material.onBeforeCompile
    const uniforms = material.userData.hyperMotionDofUniforms
    updateDepthOfFieldShader(material, {
      ...depthFocusState,
      depthFocus: { normal: { x: 0, y: 3, z: 4 }, constant: 500, depthScale: 30, aperture: 2, maxBlurPx: 36 },
    })
    expect(material.version).toBe(version)
    expect(material.onBeforeCompile).toBe(compile)
    expect(material.userData.hyperMotionDofUniforms).toBe(uniforms)
    expect(uniforms.hmDepthFocusPlane.value.toArray()).toEqual([0, 0.6, 0.8, 100])
    expect(uniforms.hmDepthFocusScale.value).toBe(80)
    expect(uniforms.hmDepthFocusAperture.value).toBe(2)
    expect(uniforms.hmDepthFocusMaxBlur.value).toBe(36)
  })

  it('updates just the moving focus plane while preserving masks, bends and the aperture kernel', () => {
    const material = new THREE.MeshBasicMaterial()
    updateDepthOfFieldShader(material, {
      ...depthFocusState, clipMap: true, screenPixelRatio: 2, bladeCount: 5, bladeRotation: 35, bokehRatio: 1.7,
      bends: [{
        enabled: true, mode: 'wave', waveAmplitude: 30, wavePhase: 65,
        angle: 45, factor: 0.8, bothDirections: true, limitToRegion: false,
        captureDirection: { x: 1, y: 0, z: 0 }, captureRotation: 10,
        upDirection: { x: 0, y: 0, z: 1 }, upRotation: 15, bendRotation: 20,
        captureOrigin: { x: 10, y: 20, z: 30 }, resolvedLength: 350,
        surfaceShading: true, lightAzimuth: 90, lightElevation: 50,
        ambient: 0.7, diffuse: 0.3, specular: 0.2, roughness: 0.5,
      }],
    })
    const uniforms = material.userData.hyperMotionDofUniforms
    const untouched = () => Object.fromEntries(Object.entries(uniforms).filter(([key]) =>
      !['hmDepthFocusPlane', 'hmDepthFocusScale', 'hmDepthFocusAperture', 'hmDepthFocusMaxBlur', 'hmDofEnabled'].includes(key),
    ))
    const before = JSON.stringify(untouched())
    const kernel = uniforms.hmDofKernel.value
    const bends = uniforms.hmBendAngle.value
    const plane = uniforms.hmDepthFocusPlane.value
    const compile = material.onBeforeCompile
    const version = material.version
    expect(updateDepthFocusPlane(material, {
      normal: { x: 0, y: 3, z: 4 }, constant: 500, depthScale: 30, aperture: 2, maxBlurPx: 36,
    })).toBe(true)
    expect(uniforms.hmDepthFocusPlane.value.toArray()).toEqual([0, 0.6, 0.8, 100])
    expect(uniforms.hmDepthFocusScale.value).toBe(80)
    expect(uniforms.hmDepthFocusAperture.value).toBe(2)
    expect(uniforms.hmDepthFocusMaxBlur.value).toBe(36)
    expect(JSON.stringify(untouched())).toBe(before)
    expect(uniforms.hmDofKernel.value).toBe(kernel)
    expect(uniforms.hmBendAngle.value).toBe(bends)
    expect(uniforms.hmDepthFocusPlane.value).toBe(plane)
    expect(material.onBeforeCompile).toBe(compile)
    expect(material.version).toBe(version)
  })

  it.each([
    { normal: { x: 2, y: -3, z: 4 }, constant: -200, depthScale: 10, aperture: 3, maxBlurPx: 30 },
    { normal: { x: 0, y: 0, z: 1 }, constant: 400, depthScale: 350, aperture: 0, maxBlurPx: 24 },
    { normal: { x: 0, y: 0, z: 1 }, constant: 500, depthScale: NaN, aperture: NaN, maxBlurPx: -8 },
  ])('matches a full shader update for normalized plane values %#', (depthFocus) => {
    const fast = new THREE.MeshBasicMaterial()
    const full = new THREE.MeshBasicMaterial()
    updateDepthOfFieldShader(fast, depthFocusState)
    updateDepthOfFieldShader(full, { ...depthFocusState, depthFocus })
    expect(updateDepthFocusPlane(fast, depthFocus)).toBe(true)
    expect(fast.userData.hyperMotionDofUniforms).toEqual(full.userData.hyperMotionDofUniforms)
    // Closing the aperture disables blur without disabling the depth-focus mode.
    // Reopening must remain eligible for this same fast path.
    expect(updateDepthFocusPlane(fast, depthFocusState.depthFocus!)).toBe(true)
    expect(fast.userData.hyperMotionDofUniforms.hmDofEnabled.value).toBe(1)
  })

  it('refuses absent or stale shader installations without installing or changing them', () => {
    const absent = new THREE.MeshBasicMaterial()
    const absentVersion = absent.version
    expect(updateDepthFocusPlane(absent, depthFocusState.depthFocus!)).toBe(false)
    expect(absent.userData.hyperMotionDofUniforms).toBeUndefined()
    expect(absent.version).toBe(absentVersion)
    for (const staleKind of ['key', 'schema'] as const) {
      const material = new THREE.MeshBasicMaterial()
      updateDepthOfFieldShader(material, depthFocusState)
      if (staleKind === 'key') material.userData.hyperMotionDofShaderKey = 'retired-before-depth-focus'
      else delete material.userData.hyperMotionDofUniforms.hmBendWavePhase
      const before = JSON.stringify(material.userData)
      const version = material.version
      expect(updateDepthFocusPlane(material, depthFocusState.depthFocus!)).toBe(false)
      expect(JSON.stringify(material.userData)).toBe(before)
      expect(material.version).toBe(version)
    }
  })

  it('refuses Point focus, disabled depth focus and invalid equations without changing other state', () => {
    for (const patch of [{ focusMask: true }, { enabled: false }, { depthFocus: undefined }]) {
      const material = new THREE.MeshBasicMaterial()
      updateDepthOfFieldShader(material, { ...depthFocusState, ...patch })
      const before = JSON.stringify(material.userData)
      expect(updateDepthFocusPlane(material, depthFocusState.depthFocus!)).toBe(false)
      expect(JSON.stringify(material.userData)).toBe(before)
    }
    const material = new THREE.MeshBasicMaterial()
    updateDepthOfFieldShader(material, depthFocusState)
    const before = JSON.stringify(material.userData)
    expect(updateDepthFocusPlane(material, {
      ...depthFocusState.depthFocus!, normal: { x: 0, y: 0, z: 0 },
    })).toBe(false)
    expect(JSON.stringify(material.userData)).toBe(before)
  })

  it('clears depth uniforms when switching to Point focus or disabling the lens', () => {
    const material = new THREE.MeshBasicMaterial()
    for (const patch of [{ focusMask: true }, { enabled: false }, { depthFocus: undefined }]) {
      updateDepthOfFieldShader(material, depthFocusState)
      updateDepthOfFieldShader(material, { ...depthFocusState, blurPx: 12, ...patch })
      const uniforms = material.userData.hyperMotionDofUniforms
      expect(uniforms.hmDepthFocusEnabled.value).toBe(0)
      expect(uniforms.hmDepthFocusAperture.value).toBe(0)
      expect(uniforms.hmDepthFocusMaxBlur.value).toBe(0)
      expect(uniforms.hmDofEnabled.value).toBe(patch.enabled === false ? 0 : 1)
    }
  })

  it('disables a closed depth lens and rejects invalid plane equations', () => {
    const material = new THREE.MeshBasicMaterial()
    updateDepthOfFieldShader(material, {
      ...depthFocusState, blurPx: 18,
      depthFocus: { ...depthFocusState.depthFocus!, aperture: 0 },
    })
    expect(material.userData.hyperMotionDofUniforms.hmDofEnabled.value).toBe(0)
    updateDepthOfFieldShader(material, {
      ...depthFocusState,
      depthFocus: { ...depthFocusState.depthFocus!, normal: { x: 0, y: 0, z: 0 } },
    })
    expect(material.userData.hyperMotionDofUniforms.hmDepthFocusEnabled.value).toBe(0)
    expect(material.userData.hyperMotionDofUniforms.hmDepthFocusPlane.value.toArray().every(Number.isFinite)).toBe(true)
  })

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
    ).toBe(12)
    expect(
      depthOfFieldSampleCount('balanced', 32, {
        playing: true,
        interactive: false,
        finalRender: false,
      }),
    ).toBe(4)
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
      screenPixelRatio: 2,
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
    expect(shader.fragmentShader).toContain(
      'sqrt(max(hmSampleCount, 1.0))',
    )
    expect(shader.fragmentShader).toContain('gl_FragCoord.xy')
    expect(shader.fragmentShader).toContain('vec2 hmUvDx = dFdx(vMapUv)')
    expect(shader.fragmentShader).toContain('vec2 hmUvDy = dFdy(vMapUv)')
    expect(shader.fragmentShader).toContain('float hmKernelBlur = hmLocalBlur')
    expect(shader.fragmentShader).toContain('texture2DGradEXT')
    expect(shader.fragmentShader).not.toContain(
      'hmLocalBlur / max( hmPlaneSize',
    )
    expect(shader.fragmentShader).toContain('float hmInside')
    expect(shader.fragmentShader).toContain('hmTap *= hmInside')
    expect(shader.fragmentShader).not.toContain(
      'texture2D( map, hmUv, hmMipBias )',
    )
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>')
    expect(Object.keys(shader.uniforms)).toContain('hmDofBlur')
  })

  it('keeps point-focus uniforms in composition screen pixels', () => {
    const material = new THREE.MeshBasicMaterial()
    updateDepthOfFieldShader(material, {
      enabled: true,
      blurPx: 12,
      minimumBlurPx: 0,
      planeWidth: 400,
      planeHeight: 240,
      focusMask: true,
      focusX: 200,
      focusY: 120,
      focusRadius: 40,
      focusFalloff: 80,
      screenPixelRatio: 2,
      sampleCount: 10,
      bladeCount: 7,
      bladeRotation: 0,
      bokehRatio: 1,
    })

    const uniforms = material.userData.hyperMotionDofUniforms
    expect(uniforms.hmFocusCenter.value.toArray()).toEqual([200, 120])
    expect(uniforms.hmFocusRadius.value).toBe(40)
    expect(uniforms.hmFocusFalloff.value).toBe(80)
    expect(uniforms.hmScreenPixelRatio.value).toBe(2)
  })

  it('injects and updates the shared GPU bend vertex deformation', () => {
    const material = new THREE.MeshBasicMaterial()
    updateDepthOfFieldShader(material, {
      enabled: false,
      blurPx: 0,
      minimumBlurPx: 0,
      planeWidth: 400,
      planeHeight: 240,
      focusMask: false,
      focusX: 0,
      focusY: 0,
      focusRadius: 0,
      focusFalloff: 1,
      screenPixelRatio: 1,
      sampleCount: 6,
      bladeCount: 7,
      bladeRotation: 0,
      bokehRatio: 1,
      bend: {
        enabled: true,
        angle: 90,
        factor: 0.75,
        bothDirections: true,
        limitToRegion: true,
        captureDirection: { x: 1, y: 0, z: 0 },
        captureRotation: 15,
        upDirection: { x: 0, y: 1, z: 0 },
        upRotation: 5,
        bendRotation: 20,
        captureOrigin: { x: 12, y: 24, z: 0 },
        resolvedLength: 320,
        surfaceShading: true,
        lightAzimuth: 135,
        lightElevation: 55,
        ambient: 0.8,
        diffuse: 0.3,
        specular: 0.15,
        roughness: 0.6,
      },
    })
    const shader = {
      uniforms: {},
      vertexShader: 'void main() {\n#include <begin_vertex>\n}',
      fragmentShader:
        '#include <map_pars_fragment>\nvoid main(){\n#include <map_fragment>\n}',
    }
    material.onBeforeCompile(shader as never, {} as never)

    expect(shader.vertexShader).toContain('vec3 hmApplyBendStack')
    expect(shader.vertexShader).toContain('float hmSinc')
    expect(shader.vertexShader).toContain('float hmCosc')
    expect(shader.vertexShader).not.toContain('1.0 / curvature')
    expect(shader.vertexShader).toContain(
      'transformed = hmApplyBendStack(transformed)',
    )
    expect(shader.fragmentShader).toContain('vec3 hmSurfaceNormal')
    expect(shader.fragmentShader).toContain('hmBendSurfaceShading')
    const uniforms = material.userData.hyperMotionDofUniforms
    expect(uniforms.hmBendCount.value).toBe(1)
    expect(uniforms.hmBendEnabled.value).toHaveLength(MAX_BEND_DEFORMERS)
    expect(uniforms.hmBendEnabled.value[0]).toBe(1)
    expect(uniforms.hmBendAngle.value[0]).toBeCloseTo(Math.PI / 2)
    expect(uniforms.hmBendFactor.value[0]).toBe(0.75)
    expect(uniforms.hmBendCaptureLength.value[0]).toBe(320)
    expect(uniforms.hmBendSurfaceShading.value).toBe(1)
    expect(uniforms.hmBendAmbient.value).toBe(0.8)
    expect(uniforms.hmBendRoughness.value).toBe(0.6)
  })

  it('uploads child and parent Bend modifiers in their execution order', () => {
    const material = new THREE.MeshBasicMaterial()
    const bend = {
      enabled: true,
      factor: 1,
      bothDirections: false,
      limitToRegion: true,
      captureDirection: { x: 1, y: 0, z: 0 },
      captureRotation: 0,
      upDirection: { x: 0, y: 0, z: 1 },
      upRotation: 0,
      bendRotation: 0,
      surfaceShading: true,
      lightAzimuth: 135,
      lightElevation: 55,
      ambient: 0.82,
      diffuse: 0.28,
      specular: 0.12,
      roughness: 0.62,
    }
    updateDepthOfFieldShader(material, {
      enabled: false,
      blurPx: 0,
      minimumBlurPx: 0,
      planeWidth: 240,
      planeHeight: 160,
      focusMask: false,
      focusX: 0,
      focusY: 0,
      focusRadius: 0,
      focusFalloff: 1,
      screenPixelRatio: 1,
      sampleCount: 6,
      bladeCount: 7,
      bladeRotation: 0,
      bokehRatio: 1,
      bends: [
        {
          ...bend,
          angle: 25,
          captureOrigin: { x: 0, y: 0, z: 0 },
          resolvedLength: 240,
        },
        {
          ...bend,
          angle: -70,
          captureOrigin: { x: 20, y: 20, z: 0 },
          resolvedLength: 480,
        },
      ],
    })

    const uniforms = material.userData.hyperMotionDofUniforms
    expect(uniforms.hmBendCount.value).toBe(2)
    expect(uniforms.hmBendAngle.value[0]).toBeCloseTo(
      THREE.MathUtils.degToRad(25),
    )
    expect(uniforms.hmBendAngle.value[1]).toBeCloseTo(
      THREE.MathUtils.degToRad(-70),
    )
    expect(uniforms.hmBendCaptureOrigin.value[0].toArray()).toEqual([0, 0, 0])
    expect(uniforms.hmBendCaptureOrigin.value[1].toArray()).toEqual([20, 20, 0])
  })

  it('orbits the bend studio light with normalized camera-space angles', () => {
    expect(bendLightDirection(0, 0).toArray()).toEqual([1, 0, 0])
    const overhead = bendLightDirection(20, 90)
    expect(overhead.x).toBeCloseTo(0, 6)
    expect(overhead.y).toBeCloseTo(0, 6)
    expect(overhead.z).toBeCloseTo(1, 6)
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
        screenPixelRatio: 1,
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

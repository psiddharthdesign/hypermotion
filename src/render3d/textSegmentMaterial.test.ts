// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  installTextSegmentMaterialShader,
  updateTextSegmentMaterialShader,
} from './textSegmentMaterial'

const dofState = {
  enabled: true,
  blurPx: 18,
  minimumBlurPx: 2,
  planeWidth: 640,
  planeHeight: 360,
  focusMask: true,
  focusX: 320,
  focusY: 180,
  focusRadius: 48,
  focusFalloff: 72,
  screenPixelRatio: 2,
  sampleCount: 12,
  bladeCount: 7,
  bladeRotation: 15,
  bokehRatio: 1.2,
} as const

function compile(material: THREE.MeshBasicMaterial) {
  const shader = {
    uniforms: {},
    vertexShader: `#include <common>
void main() {
  #include <begin_vertex>
}`,
    fragmentShader: `#include <common>
#include <map_pars_fragment>
void main() {
  vec4 diffuseColor = vec4( 1.0 );
  #include <map_fragment>
}`,
  }
  material.onBeforeCompile(shader as never, {} as never)
  return shader
}

describe('batched text-segment material shader', () => {
  it('composes the existing DOF shader with per-vertex segment attributes', () => {
    const material = new THREE.MeshBasicMaterial()
    updateTextSegmentMaterialShader(material, dofState)
    const shader = compile(material)

    expect(shader.vertexShader).toContain('attribute float hmOpacity')
    expect(shader.vertexShader).toContain('attribute float hmEffectBlur')
    expect(shader.vertexShader).toContain('attribute float hmDofBlur')
    expect(shader.vertexShader).toContain('attribute vec4 hmUvBounds')
    expect(shader.vertexShader).toContain('vHmOpacity = hmOpacity')
    expect(shader.vertexShader).toContain('vHmUvBounds = hmUvBounds')
    expect(shader.fragmentShader).toContain('varying float vHmOpacity')
    expect(shader.fragmentShader).toContain(
      'diffuseColor.a *= clamp( vHmOpacity, 0.0, 1.0 )',
    )
    expect(Object.keys(shader.uniforms)).toContain('hmDofKernel')
  })

  it('combines segment effect and camera blur without losing point focus', () => {
    const material = new THREE.MeshBasicMaterial()
    updateTextSegmentMaterialShader(material, dofState)
    const shader = compile(material)

    expect(shader.fragmentShader).toContain('gl_FragCoord.xy')
    expect(shader.fragmentShader).toContain(
      'float hmLocalBlur = max( hmEffectBlur, hmLensBlur )',
    )
    expect(shader.fragmentShader).toContain('float hmActiveSampleCount')
    expect(shader.fragmentShader).toContain('float hmCombinedSampleCount')
    expect(shader.fragmentShader).toContain('hmEffectOffset')
    expect(shader.fragmentShader).toContain(
      'hmDofKernel[hmLensIndex] * hmLensRadiusPx',
    )
    expect(shader.fragmentShader).toContain('max( vHmDofBlur, hmDofMinBlur )')
    expect(shader.fragmentShader).not.toContain(
      'float hmLocalBlur = mix( hmDofMinBlur, hmDofBlur, hmFocusBlend )',
    )
    expect(shader.fragmentShader).toContain(
      'if ( hmLocalBlur > 0.05 && hmActiveSampleCount > 0.5 )',
    )
  })

  it('clips every aperture tap to its own atlas cell', () => {
    const material = new THREE.MeshBasicMaterial()
    installTextSegmentMaterialShader(material)
    const shader = compile(material)

    expect(shader.fragmentShader).toContain(
      'step(vHmUvBounds.x, hmRawUv.x)',
    )
    expect(shader.fragmentShader).toContain(
      'step(hmRawUv.x, vHmUvBounds.z)',
    )
    expect(shader.fragmentShader).toContain('vHmUvBounds.xy')
    expect(shader.fragmentShader).toContain('vHmUvBounds.zw')
    expect(shader.fragmentShader).toContain(
      'hmTap = texture2D( map, hmUv ) * hmInside',
    )
    expect(shader.fragmentShader).not.toContain(
      'vec2 hmUv = clamp(hmRawUv, vec2( 0.0 ), vec2( 1.0 ))',
    )
  })

  it('retains the existing bounded aperture sampler and shared uniforms', () => {
    const material = new THREE.MeshBasicMaterial()
    updateTextSegmentMaterialShader(material, dofState)
    const shader = compile(material)
    const uniforms = material.userData.hyperMotionDofUniforms

    expect(shader.fragmentShader).toContain(
      'for ( int hmIndex = 0; hmIndex < 48; hmIndex ++ )',
    )
    expect(shader.fragmentShader).toContain(
      'if ( float( hmIndex ) < hmActiveSampleCount )',
    )
    expect(shader.fragmentShader).toContain('hmPrefilterRadiusPx')
    expect(shader.fragmentShader).toContain('hmActiveSampleCount < 16.0')
    expect(shader.fragmentShader).toContain(
      'hmEffectRadiusPx / sqrt(12.0)',
    )
    expect(shader.fragmentShader).toContain(
      'hmEffectRadiusPx * 0.2',
    )
    expect(shader.fragmentShader).toContain(
      'clamp(hmRawA, vHmUvBounds.xy, vHmUvBounds.zw)',
    )
    expect(shader.fragmentShader).toContain('hmPrefilterPremultiplied')
    expect(shader.fragmentShader).toContain(
      'hmPrefilterAlpha * 0.25',
    )
    expect(shader.fragmentShader).not.toContain('texture2DGradEXT')
    expect(uniforms.hmSampleCount.value).toBe(12)
    expect(uniforms.hmFocusCenter.value.toArray()).toEqual([320, 180])
  })

  it('installs idempotently and keeps a distinct program cache key', () => {
    const material = new THREE.MeshBasicMaterial()
    installTextSegmentMaterialShader(material)
    const compileOnce = material.onBeforeCompile
    const versionOnce = material.version
    const cacheKey = material.customProgramCacheKey()

    installTextSegmentMaterialShader(material)

    expect(material.onBeforeCompile).toBe(compileOnce)
    expect(material.version).toBe(versionOnce)
    expect(cacheKey).toContain('hypermotion-gpu-dof-v10')
    expect(cacheKey).toContain('hypermotion-text-segment-v3')
  })

  it('replaces a stale HMR wrapper without duplicating shader declarations', () => {
    const material = new THREE.MeshBasicMaterial()
    installTextSegmentMaterialShader(material)
    material.userData.hyperMotionTextSegmentShader.key = 'stale-version'

    updateTextSegmentMaterialShader(material, dofState)
    const shader = compile(material)

    expect(shader.vertexShader.match(/attribute float hmOpacity;/g)).toHaveLength(
      1,
    )
    expect(shader.fragmentShader.match(/varying float vHmOpacity;/g)).toHaveLength(
      1,
    )
    expect(
      material.userData.hyperMotionDofUniforms.hmSampleCount.value,
    ).toBe(12)
  })
})

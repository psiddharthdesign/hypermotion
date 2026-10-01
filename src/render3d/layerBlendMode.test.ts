// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { installDepthOfFieldShader } from '@/render3d/depthOfFieldShader'
import {
  BACKDROP_BLEND_MODES,
  backdropBlendModeIndex,
  captureBackdropForMaterial,
  disposeBackdropBlendMode,
  injectBackdropBlendShader,
  setBackdropBlendMode,
} from '@/render3d/layerBlendMode'

describe('backdrop-aware layer blending', () => {
  it('assigns every authored blend mode a stable shader index', () => {
    expect(BACKDROP_BLEND_MODES).toEqual([
      'normal',
      'multiply',
      'screen',
      'overlay',
      'darken',
      'lighten',
      'color-dodge',
      'color-burn',
      'hard-light',
      'soft-light',
      'difference',
      'exclusion',
      'hue',
      'saturation',
      'color',
      'luminosity',
    ])
    BACKDROP_BLEND_MODES.forEach((mode, index) => {
      expect(backdropBlendModeIndex(mode)).toBe(index)
    })
  })

  it('injects destination sampling and the complete CSS blend family', () => {
    const fragmentShader = injectBackdropBlendShader(`
#include <common>
void main() {
  gl_FragColor = vec4(1.0);
  #include <dithering_fragment>
}
`)

    expect(fragmentShader).toContain('uniform sampler2D hmBlendBackdrop')
    expect(fragmentShader).toContain('texture2D(hmBlendBackdrop, hmBlendUv)')
    expect(fragmentShader).toContain('hmBlendOverlayChannel')
    expect(fragmentShader).toContain('hmBlendHardLightChannel')
    expect(fragmentShader).toContain('hmBlendSoftLightChannel')
    expect(fragmentShader).toContain('hmBlendSetSat')
    expect(fragmentShader).toContain('hmBlendSetLum')
    expect(fragmentShader).toContain('hmCompositeAlpha')
  })

  it('composes with the existing depth-of-field shader hook', () => {
    const material = new THREE.MeshBasicMaterial()
    installDepthOfFieldShader(material)
    setBackdropBlendMode(material, 'overlay')

    const shader = {
      uniforms: {},
      vertexShader: '',
      fragmentShader: `
#include <common>
#include <map_pars_fragment>
void main() {
  #include <map_fragment>
  gl_FragColor = vec4(1.0);
  #include <dithering_fragment>
}
`,
    } as unknown as Parameters<typeof material.onBeforeCompile>[0]
    material.onBeforeCompile(
      shader,
      {} as Parameters<typeof material.onBeforeCompile>[1],
    )

    expect(shader.uniforms).toHaveProperty('hmDofEnabled')
    expect(shader.uniforms).toHaveProperty('hmBlendBackdrop')
    expect(shader.uniforms).toHaveProperty('hmBlendViewport')
    expect(shader.uniforms).toHaveProperty('hmBlendMode')
    expect(shader.uniforms).toHaveProperty('hmBlendTargetIsLinear')
    expect(shader.fragmentShader).toContain('hmDofEnabled')
    expect(shader.fragmentShader).toContain('hmBlendCss')
    expect(shader.fragmentShader).toContain('sRGBTransferOETF')
    expect(shader.fragmentShader).toContain('sRGBTransferEOTF')
    expect(material.blending).toBe(THREE.NoBlending)

    setBackdropBlendMode(material, 'normal')
    expect(material.blending).toBe(THREE.NormalBlending)
    disposeBackdropBlendMode(material)
    expect(material.userData.hyperMotionBackdropBlend).toBeUndefined()
  })

  it('copies the active framebuffer at its physical render size', () => {
    const material = new THREE.MeshBasicMaterial()
    setBackdropBlendMode(material, 'difference')
    const copyFramebufferToTexture = vi.fn()
    const renderer = {
      getRenderTarget: () => ({
        width: 640,
        height: 360,
        texture: {
          type: THREE.HalfFloatType,
          colorSpace: THREE.NoColorSpace,
        },
      }),
      getDrawingBufferSize: vi.fn(),
      copyFramebufferToTexture,
    } as unknown as THREE.WebGLRenderer

    captureBackdropForMaterial(renderer, material)

    expect(copyFramebufferToTexture).toHaveBeenCalledOnce()
    const texture = copyFramebufferToTexture.mock.calls[0]?.[0] as
      | THREE.FramebufferTexture
      | undefined
    expect(texture?.image).toMatchObject({ width: 640, height: 360 })
    expect(texture?.type).toBe(THREE.HalfFloatType)

    const shader = {
      uniforms: {},
      vertexShader: '',
      fragmentShader:
        '#include <common>\nvoid main(){#include <dithering_fragment>}',
    } as unknown as Parameters<typeof material.onBeforeCompile>[0]
    material.onBeforeCompile(
      shader,
      {} as Parameters<typeof material.onBeforeCompile>[1],
    )
    expect(
      (shader.uniforms.hmBlendTargetIsLinear as { value: number }).value,
    ).toBe(1)
  })

  it('keeps the direct drawing buffer in the display-sRGB blend space', () => {
    const material = new THREE.MeshBasicMaterial()
    setBackdropBlendMode(material, 'soft-light')
    const copyFramebufferToTexture = vi.fn()
    const renderer = {
      outputColorSpace: THREE.SRGBColorSpace,
      getRenderTarget: () => null,
      getDrawingBufferSize: (size: THREE.Vector2) => size.set(960, 540),
      copyFramebufferToTexture,
    } as unknown as THREE.WebGLRenderer

    captureBackdropForMaterial(renderer, material)

    const texture = copyFramebufferToTexture.mock.calls[0]?.[0] as
      | THREE.FramebufferTexture
      | undefined
    expect(texture?.image).toMatchObject({ width: 960, height: 540 })
    const shader = {
      uniforms: {},
      vertexShader: '',
      fragmentShader:
        '#include <common>\nvoid main(){#include <dithering_fragment>}',
    } as unknown as Parameters<typeof material.onBeforeCompile>[0]
    material.onBeforeCompile(
      shader,
      {} as Parameters<typeof material.onBeforeCompile>[1],
    )
    expect(
      (shader.uniforms.hmBlendTargetIsLinear as { value: number }).value,
    ).toBe(0)
  })

  it('reuses output and canonical bloom backdrops without reallocating on every draw', () => {
    const material = new THREE.MeshBasicMaterial()
    setBackdropBlendMode(material, 'overlay')
    const target = {
      width: 3840, height: 2160,
      texture: { type: THREE.HalfFloatType, colorSpace: THREE.NoColorSpace },
    }
    const copyFramebufferToTexture = vi.fn()
    const renderer = {
      getRenderTarget: () => target,
      copyFramebufferToTexture,
    } as unknown as THREE.WebGLRenderer
    captureBackdropForMaterial(renderer, material)
    const output = copyFramebufferToTexture.mock.lastCall![0] as THREE.FramebufferTexture
    target.width = 960
    target.height = 540
    captureBackdropForMaterial(renderer, material)
    const canonical = copyFramebufferToTexture.mock.lastCall![0] as THREE.FramebufferTexture
    const disposeOutput = vi.spyOn(output, 'dispose')
    const disposeCanonical = vi.spyOn(canonical, 'dispose')
    const versions = [output.version, canonical.version]

    for (let frame = 0; frame < 3; frame++) {
      for (const texture of [output, canonical]) {
        target.width = texture.image.width
        target.height = texture.image.height
        captureBackdropForMaterial(renderer, material)
        expect(copyFramebufferToTexture.mock.lastCall![0]).toBe(texture)
        expect(material.userData.hyperMotionBackdropBlend.uniforms.hmBlendBackdrop.value).toBe(texture)
      }
    }
    expect([output.version, canonical.version]).toEqual(versions)
    expect(disposeOutput).not.toHaveBeenCalled()
    expect(disposeCanonical).not.toHaveBeenCalled()
    disposeBackdropBlendMode(material)
    expect(disposeOutput).toHaveBeenCalledOnce()
    expect(disposeCanonical).toHaveBeenCalledOnce()
  })

  it('bounds cached backdrops and evicts a retired output size before the active bloom source', () => {
    const material = new THREE.MeshBasicMaterial()
    setBackdropBlendMode(material, 'difference')
    const target = {
      width: 1920, height: 1080,
      texture: { type: THREE.HalfFloatType, colorSpace: THREE.NoColorSpace },
    }
    const copyFramebufferToTexture = vi.fn()
    const renderer = { getRenderTarget: () => target, copyFramebufferToTexture } as unknown as THREE.WebGLRenderer
    captureBackdropForMaterial(renderer, material)
    const oldOutput = copyFramebufferToTexture.mock.lastCall![0] as THREE.FramebufferTexture
    const disposeOldOutput = vi.spyOn(oldOutput, 'dispose')
    target.width = 960
    target.height = 540
    captureBackdropForMaterial(renderer, material)
    const canonical = copyFramebufferToTexture.mock.lastCall![0] as THREE.FramebufferTexture
    const disposeCanonical = vi.spyOn(canonical, 'dispose')

    target.width = 3840
    target.height = 2160
    captureBackdropForMaterial(renderer, material)
    expect(disposeOldOutput).toHaveBeenCalledOnce()
    expect(disposeCanonical).not.toHaveBeenCalled()
    expect(material.userData.hyperMotionBackdropBlend.textures.size).toBe(2)
    target.width = 960
    target.height = 540
    captureBackdropForMaterial(renderer, material)
    expect(copyFramebufferToTexture.mock.lastCall![0]).toBe(canonical)
    disposeBackdropBlendMode(material)
    expect(disposeOldOutput).toHaveBeenCalledOnce()
    expect(disposeCanonical).toHaveBeenCalledOnce()
  })

  it('keeps distinct framebuffer formats at the same size', () => {
    const material = new THREE.MeshBasicMaterial()
    setBackdropBlendMode(material, 'screen')
    let target: THREE.WebGLRenderTarget | null = null
    const copyFramebufferToTexture = vi.fn()
    const renderer = {
      outputColorSpace: THREE.SRGBColorSpace,
      getRenderTarget: () => target,
      getDrawingBufferSize: (size: THREE.Vector2) => size.set(960, 540),
      copyFramebufferToTexture,
    } as unknown as THREE.WebGLRenderer
    captureBackdropForMaterial(renderer, material)
    const display = copyFramebufferToTexture.mock.lastCall![0] as THREE.FramebufferTexture
    target = new THREE.WebGLRenderTarget(960, 540, { type: THREE.HalfFloatType })
    captureBackdropForMaterial(renderer, material)
    const linear = copyFramebufferToTexture.mock.lastCall![0] as THREE.FramebufferTexture
    expect(display).not.toBe(linear)
    expect(display.type).toBe(THREE.UnsignedByteType)
    expect(linear.type).toBe(THREE.HalfFloatType)
    target.dispose()
    target = null
    captureBackdropForMaterial(renderer, material)
    expect(copyFramebufferToTexture.mock.lastCall![0]).toBe(display)
    disposeBackdropBlendMode(material)
  })
})

// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { installDepthOfFieldShader } from './depthOfFieldShader'
import { installTextSegmentMaterialShader } from './textSegmentMaterial'
import { syncAlphaMasks } from './alphaMaskShader'

describe('alpha mask materials', () => {
  it('composes texture alpha after content sampling without blurring its color', () => {
    const material = new THREE.MeshBasicMaterial()
    installDepthOfFieldShader(material)
    const texture = new THREE.Texture()
    syncAlphaMasks(material, [{ texture, matrix: new THREE.Matrix4(), opacity: 0.4 }])
    const shader = { uniforms: {}, vertexShader: 'void main() {\n#include <project_vertex>\n}', fragmentShader: 'void main() {\n#include <map_fragment>\n#include <alphatest_fragment>\n}' }
    material.onBeforeCompile(shader as never, {} as never)
    expect(shader.fragmentShader).toContain('diffuseColor.a *= texture2D(hmMaskTexture0')
    expect(shader.fragmentShader).toContain('1.0 - hmMaskUv0.y')
    expect(shader.uniforms).toMatchObject({ hmMaskTexture0: { value: texture }, hmMaskOpacity0: { value: 0.4 } })
    expect(shader.vertexShader).toContain('modelMatrix * vec4(transformed, 1.0)')
  })
  it('updates opacity without compiling again and clears masks when released', () => {
    const material = new THREE.MeshBasicMaterial()
    installTextSegmentMaterialShader(material)
    const sample = { texture: new THREE.Texture(), matrix: new THREE.Matrix4(), opacity: 1 }
    syncAlphaMasks(material, [sample])
    const version = material.version
    const key = material.customProgramCacheKey()
    syncAlphaMasks(material, [{ ...sample, opacity: 0.2 }])
    expect(material.version).toBe(version)
    expect(material.customProgramCacheKey()).toBe(key)
    syncAlphaMasks(material, [])
    expect(material.version).toBeGreaterThan(version)
    expect(material.customProgramCacheKey()).not.toBe(key)
  })
})

// SPDX-License-Identifier: Apache-2.0
import * as THREE from 'three'

export interface AlphaMaskSample {
  texture: THREE.Texture
  matrix: THREE.Matrix4
  opacity: number
}
interface MaskState {
  samples: AlphaMaskSample[]
  uniforms: Record<string, THREE.IUniform>
}
export function syncAlphaMasks(material: THREE.MeshBasicMaterial, samples: AlphaMaskSample[]) {
  let state = material.userData.hyperMotionAlphaMasks as MaskState | undefined
  if (!state) {
    state = { samples: [], uniforms: {} }
    material.userData.hyperMotionAlphaMasks = state
  }
  if (state.samples.length !== samples.length) material.needsUpdate = true
  state.samples = samples
  samples.forEach((sample, i) => {
    for (const [name, value] of Object.entries({ [`hmMaskTexture${i}`]: sample.texture, [`hmMaskMatrix${i}`]: sample.matrix, [`hmMaskOpacity${i}`]: sample.opacity })) {
      if (state.uniforms[name]) state.uniforms[name]!.value = value
      else state.uniforms[name] = { value }
    }
  })
}
export function copyAlphaMasks(source: THREE.MeshBasicMaterial, target: THREE.MeshBasicMaterial) {
  syncAlphaMasks(target, (source.userData.hyperMotionAlphaMasks as MaskState | undefined)?.samples ?? [])
}
export function alphaMaskProgramKey(material: THREE.Material): string {
  return `alpha-masks-${(material.userData.hyperMotionAlphaMasks as MaskState | undefined)?.samples.length ?? 0}`
}
/** Integrated into the base material hook so text, bend and blend hooks compose. */
export function injectAlphaMasks(material: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms) {
  const state = material.userData.hyperMotionAlphaMasks as MaskState | undefined
  if (!state?.samples.length) return
  Object.assign(shader.uniforms, state.uniforms)
  shader.vertexShader = `varying vec3 hmMaskWorld;\n${shader.vertexShader}`.replace(
    '#include <project_vertex>', '#include <project_vertex>\nhmMaskWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
  )
  const declarations = state.samples.map((_, i) => `uniform sampler2D hmMaskTexture${i};\nuniform mat4 hmMaskMatrix${i};\nuniform float hmMaskOpacity${i};`).join('\n')
  const apply = state.samples.map((_, i) => `
    vec2 hmMaskUv${i} = (hmMaskMatrix${i} * vec4(hmMaskWorld, 1.0)).xy;
    if (any(lessThan(hmMaskUv${i}, vec2(0.0))) || any(greaterThan(hmMaskUv${i}, vec2(1.0)))) discard;
    diffuseColor.a *= texture2D(hmMaskTexture${i}, vec2(hmMaskUv${i}.x, 1.0 - hmMaskUv${i}.y)).a * hmMaskOpacity${i};
  `).join('\n')
  shader.fragmentShader = `varying vec3 hmMaskWorld;\n${declarations}\n${shader.fragmentShader}`.replace('#include <alphatest_fragment>', `${apply}\n#include <alphatest_fragment>`)
}

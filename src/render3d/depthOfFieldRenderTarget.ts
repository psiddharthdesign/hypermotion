// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'
import type { DepthOfFieldSamplingState } from './depthOfFieldShader'

/**
 * Resolve screen-space lens coordinates at draw time. A post-processing
 * composer may use fewer pixels than the renderer's drawing buffer, and its
 * idle-quality resize can happen without resynchronizing the scene planes.
 * Texture resolution still follows the renderer; only lens sampling follows
 * the framebuffer that actually receives this material.
 */
export function installDepthOfFieldRenderTargetScale(
  material: THREE.MeshBasicMaterial,
): void {
  const previous = material.onBeforeRender
  const viewport = new THREE.Vector4()
  const logicalSize = new THREE.Vector2()
  material.onBeforeRender = function (...args) {
    previous.apply(this, args)
    const uniforms = material.userData.hyperMotionDofUniforms
    if (!uniforms?.hmScreenPixelRatio) return
    const renderer = args[0]
    renderer.getCurrentViewport(viewport)
    renderer.getSize(logicalSize)
    uniforms.hmScreenPixelRatio.value = Math.max(0.001, viewport.w / Math.max(1, logicalSize.y))
    const sampling = material.userData.hyperMotionDofSampling as DepthOfFieldSamplingState | undefined
    if (sampling) {
      const bloomSource = renderer.getRenderTarget()?.texture.userData.hyperMotionBloomSource === true
      uniforms.hmSampleCount.value = bloomSource ? sampling.bloomSampleCount : sampling.sampleCount
      uniforms.hmDofKernel.value = bloomSource ? sampling.bloomKernel : sampling.kernel
    }
  }
}

// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

// Match the working size of a fitted 4K composition in the editor. Unreal's
// fixed texel kernels must not shrink when the output grows to 4K or 8K.
const BLOOM_REFERENCE_LONG_EDGE = 960

interface BloomSize {
  width: number
  height: number
}

export function bloomReferenceSize(width: number, height: number): BloomSize {
  const sourceWidth = Math.max(1, Math.round(Number.isFinite(width) ? width : 1))
  const sourceHeight = Math.max(1, Math.round(Number.isFinite(height) ? height : 1))
  const scale = BLOOM_REFERENCE_LONG_EDGE / Math.max(sourceWidth, sourceHeight)
  return {
    // Five blur mips require at least one texel in the narrowest dimension.
    width: Math.max(32, Math.round(sourceWidth * scale)),
    height: Math.max(32, Math.round(sourceHeight * scale)),
  }
}

type BloomSourceRenderer = (
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  deltaTime: number,
) => void

/**
 * Render bloom's source and blur pyramid at one reference resolution. Merely
 * downsampling a final-resolution scene retains resolution-dependent glyph
 * coverage and DOF peaks, which then cross the nonlinear bright threshold.
 * The additive blend still targets the original full-resolution scene.
 */
export class SceneBloomPass extends UnrealBloomPass {
  private sourceTarget: THREE.WebGLRenderTarget | null = null
  private readonly bloomSource = { value: null as THREE.Texture | null }
  private readonly renderSource: BloomSourceRenderer

  constructor(width: number, height: number, renderSource: BloomSourceRenderer) {
    const reference = bloomReferenceSize(width, height)
    super(new THREE.Vector2(reference.width, reference.height), 0, 0.35, 0.75)
    this.renderSource = renderSource

    // Unreal assigns tDiffuse to the original read buffer immediately before
    // bright extraction. A separate sampler lets that pass read the reference
    // image while preserving the original buffer for the final additive blend.
    this.materialHighPassFilter.uniforms.hmBloomSource = this.bloomSource
    this.materialHighPassFilter.fragmentShader =
      this.materialHighPassFilter.fragmentShader.replace(/\btDiffuse\b/g, 'hmBloomSource')

    for (const target of this.getScratchTargets()) target.depthBuffer = false
    this.setSize(width, height)
  }

  override setSize(width: number, height: number): void {
    const reference = bloomReferenceSize(width, height)
    this.resolution.set(reference.width, reference.height)
    super.setSize(reference.width, reference.height)
    this.sourceTarget?.setSize(reference.width, reference.height)
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    if (!this.sourceTarget) {
      // This target receives scene geometry, so it needs depth. The eleven
      // fullscreen blur scratch targets remain depth-free.
      this.sourceTarget = new THREE.WebGLRenderTarget(this.resolution.x, this.resolution.y, {
        type: THREE.HalfFloatType,
        depthBuffer: true,
        stencilBuffer: false,
      })
      this.sourceTarget.texture.name = 'HyperMotionBloom.source'
      this.sourceTarget.texture.userData.hyperMotionBloomSource = true
      this.sourceTarget.texture.generateMipmaps = false
    }
    // A same-sized preview buffer can still have a lower DOF sample budget.
    // Always use the tagged source target so bloom receives the same stable
    // lens sampling during playback, draft previews, and final output.
    const previousTarget = renderer.getRenderTarget()
    const previousAutoClear = renderer.autoClear
    try {
      this.renderSource(renderer, this.sourceTarget, deltaTime)
    } finally {
      renderer.autoClear = previousAutoClear
      renderer.setRenderTarget(previousTarget)
    }
    this.bloomSource.value = this.sourceTarget.texture
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
  }

  getScratchTargets(): THREE.WebGLRenderTarget[] {
    return [
      this.renderTargetBright,
      ...this.renderTargetsHorizontal,
      ...this.renderTargetsVertical,
      ...(this.sourceTarget ? [this.sourceTarget] : []),
    ]
  }

  override dispose(): void {
    this.sourceTarget?.dispose()
    this.sourceTarget = null
    // UnrealBloomPass disposes its blur/composite materials but omits this
    // bright-extraction material. Release its program with the rest of graph.
    this.materialHighPassFilter.dispose()
    super.dispose()
  }
}

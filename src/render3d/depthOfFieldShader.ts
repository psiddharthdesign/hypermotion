// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'

export const MAX_DOF_KERNEL_SAMPLES = 48

export type DofPreviewQuality = 'draft' | 'balanced' | 'high'

export interface DofSampleBudgetContext {
  playing: boolean
  interactive: boolean
  finalRender: boolean
}

export interface PlaneDepthOfFieldShaderState {
  enabled: boolean
  blurPx: number
  minimumBlurPx: number
  planeWidth: number
  planeHeight: number
  focusMask: boolean
  focusX: number
  focusY: number
  focusRadius: number
  focusFalloff: number
  sampleCount: number
  bladeCount: number
  bladeRotation: number
  bokehRatio: number
}

interface DofShaderUniforms {
  hmDofEnabled: { value: number }
  hmDofBlur: { value: number }
  hmDofMinBlur: { value: number }
  hmPlaneSize: { value: THREE.Vector2 }
  hmFocusMask: { value: number }
  hmFocusCenter: { value: THREE.Vector2 }
  hmFocusRadius: { value: number }
  hmFocusFalloff: { value: number }
  hmSampleCount: { value: number }
  hmApertureStretch: { value: number }
  hmDofKernel: { value: THREE.Vector2[] }
}

const DOF_SHADER_KEY = 'hypermotion-gpu-dof-v7'
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const kernelCache = new Map<string, THREE.Vector2[]>()

/**
 * Bound interactive work independently of the authored/final quality.
 * Timeline and camera gestures always use the realtime budget; paused preview
 * and export can spend progressively more samples without changing the scene.
 */
export function depthOfFieldSampleCount(
  previewQuality: DofPreviewQuality,
  blurQuality: number,
  context: DofSampleBudgetContext,
): number {
  if (context.playing || context.interactive) return 6
  if (context.finalRender) {
    // Final output must never fall below the Balanced paused-preview budget.
    // Older scenes may still carry the legacy default (8), so enforce the
    // effective floor here instead of relying only on newly-authored values.
    return clampInt(Math.round(blurQuality), 24, MAX_DOF_KERNEL_SAMPLES)
  }
  switch (previewQuality) {
    case 'draft':
      return 6
    case 'high':
      return 48
    default:
      return 24
  }
}

/**
 * Deterministic Vogel-disc samples shaped by a regular aperture polygon.
 * Kernel generation happens on the CPU only when lens-shape controls change;
 * the fragment shader receives ready-to-use offsets and avoids per-pixel trig.
 */
export function createApertureKernel(
  sampleCount: number,
  bladeCount: number,
  rotationDegrees: number,
  bokehRatio: number,
): Array<{ x: number; y: number }> {
  const count = clampInt(sampleCount, 1, MAX_DOF_KERNEL_SAMPLES)
  const blades = clampInt(bladeCount, 3, 16)
  const ratio = clamp(bokehRatio, 0.25, 4)
  const ratioX = Math.sqrt(ratio)
  const ratioY = 1 / ratioX
  const rotation = THREE.MathUtils.degToRad(rotationDegrees)
  const sector = (Math.PI * 2) / blades
  const polygonNumerator = Math.cos(Math.PI / blades)

  const samples = Array.from({ length: count }, (_, index) => {
    const angle = index * GOLDEN_ANGLE + rotation
    const radius = Math.sqrt((index + 0.5) / count)
    const wrapped = positiveModulo(angle + sector / 2, sector) - sector / 2
    const polygonRadius = polygonNumerator / Math.max(0.001, Math.cos(wrapped))
    const shapedRadius = radius * polygonRadius
    return {
      x: Math.cos(angle) * shapedRadius * ratioX,
      y: Math.sin(angle) * shapedRadius * ratioY,
    }
  })
  // Sample budgets change between playback and paused preview. Recenter every
  // budget so the convolution never nudges the image when that switch occurs.
  const centroid = samples.reduce(
    (sum, sample) => ({ x: sum.x + sample.x, y: sum.y + sample.y }),
    { x: 0, y: 0 },
  )
  centroid.x /= samples.length
  centroid.y /= samples.length
  return samples.map((sample) => ({
    x: sample.x - centroid.x,
    y: sample.y - centroid.y,
  }))
}

export function installDepthOfFieldShader(material: THREE.MeshBasicMaterial) {
  const installedUniforms = material.userData.hyperMotionDofUniforms
  if (
    material.userData.hyperMotionDofShaderKey === DOF_SHADER_KEY &&
    hasCurrentUniformSchema(installedUniforms)
  ) {
    return
  }
  const uniforms: DofShaderUniforms = {
    hmDofEnabled: { value: 0 },
    hmDofBlur: { value: 0 },
    hmDofMinBlur: { value: 0 },
    hmPlaneSize: { value: new THREE.Vector2(1, 1) },
    hmFocusMask: { value: 0 },
    hmFocusCenter: { value: new THREE.Vector2(0.5, 0.5) },
    hmFocusRadius: { value: 0 },
    hmFocusFalloff: { value: 1 },
    hmSampleCount: { value: 1 },
    hmApertureStretch: { value: 1 },
    hmDofKernel: {
      value: apertureKernelVectors(7, 0, 1, 1),
    },
  }
  material.userData.hyperMotionDofShaderKey = DOF_SHADER_KEY
  material.userData.hyperMotionDofUniforms = uniforms
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_pars_fragment>',
        `#include <map_pars_fragment>

uniform float hmDofEnabled;
uniform float hmDofBlur;
uniform float hmDofMinBlur;
uniform vec2 hmPlaneSize;
uniform float hmFocusMask;
uniform vec2 hmFocusCenter;
uniform float hmFocusRadius;
uniform float hmFocusFalloff;
uniform float hmSampleCount;
uniform float hmApertureStretch;
uniform vec2 hmDofKernel[${MAX_DOF_KERNEL_SAMPLES}];`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP

  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  float hmFocusBlend = 1.0;
  if ( hmFocusMask > 0.5 ) {
    vec2 hmFocusDelta = ( vMapUv - hmFocusCenter ) * hmPlaneSize;
    hmFocusBlend = smoothstep(
      hmFocusRadius,
      hmFocusRadius + max( hmFocusFalloff, 0.001 ),
      length( hmFocusDelta )
    );
  }

  float hmLocalBlur = mix( hmDofMinBlur, hmDofBlur, hmFocusBlend );
  if ( hmDofEnabled > 0.5 && hmLocalBlur > 0.05 && hmSampleCount > 0.5 ) {
    // The authored sample count is the whole aperture kernel. Keeping an
    // additional unblurred texel here left a visible sharp copy in the middle
    // of defocused text, particularly in the six-sample playback budget.
    vec3 hmPremultiplied = vec3( 0.0 );
    float hmAlpha = 0.0;
    float hmWeight = 0.0;
    vec2 hmUvRadius = vec2(
      hmLocalBlur / max( hmPlaneSize.x, 1.0 ),
      hmLocalBlur / max( hmPlaneSize.y, 1.0 )
    );
    // Large bokeh radii can place sparse taps many texels apart. Select a
    // progressively softer mip for each tap so those gaps blend into a
    // continuous aperture convolution without adding more texture reads.
    // Use the Balanced preview density as a fixed reference: sample-count
    // changes should alter aperture smoothness, not the perceived blur radius.
    // Small blur radii stay on mip zero and retain crisp focus transitions.
    float hmMipBias = clamp(
      log2(max(
        1.0,
        hmLocalBlur * hmApertureStretch / sqrt(24.0)
      )) + 0.5,
      0.0,
      6.0
    );
    for ( int hmIndex = 0; hmIndex < ${MAX_DOF_KERNEL_SAMPLES}; hmIndex ++ ) {
      if ( float( hmIndex ) < hmSampleCount ) {
        vec2 hmRawUv = vMapUv + hmDofKernel[hmIndex] * hmUvRadius;
        float hmInside =
          step(0.0, hmRawUv.x) * step(hmRawUv.x, 1.0) *
          step(0.0, hmRawUv.y) * step(hmRawUv.y, 1.0);
        vec2 hmUv = clamp(hmRawUv, vec2( 0.0 ), vec2( 1.0 ));
        vec4 hmTap = texture2D( map, hmUv, hmMipBias );
        hmTap *= hmInside;
        hmPremultiplied += hmTap.rgb * hmTap.a;
        hmAlpha += hmTap.a;
        hmWeight += 1.0;
      }
    }
    sampledDiffuseColor = vec4(
      hmPremultiplied / max( hmAlpha, 0.00001 ),
      hmAlpha / hmWeight
    );
  }

  #ifdef DECODE_VIDEO_TEXTURE
    sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
  #endif

  diffuseColor *= sampledDiffuseColor;

#endif`,
      )
  }
  material.customProgramCacheKey = () => DOF_SHADER_KEY
  material.needsUpdate = true
}

function hasCurrentUniformSchema(value: unknown): value is DofShaderUniforms {
  if (!value || typeof value !== 'object') return false
  const uniforms = value as Partial<Record<keyof DofShaderUniforms, unknown>>
  return [
    'hmDofEnabled',
    'hmDofBlur',
    'hmDofMinBlur',
    'hmPlaneSize',
    'hmFocusMask',
    'hmFocusCenter',
    'hmFocusRadius',
    'hmFocusFalloff',
    'hmSampleCount',
    'hmApertureStretch',
    'hmDofKernel',
  ].every((key) => uniforms[key as keyof DofShaderUniforms] != null)
}

export function updateDepthOfFieldShader(
  material: THREE.MeshBasicMaterial,
  state: PlaneDepthOfFieldShaderState,
) {
  installDepthOfFieldShader(material)
  const uniforms = material.userData.hyperMotionDofUniforms as DofShaderUniforms
  uniforms.hmDofEnabled.value = state.enabled && state.blurPx > 0.05 ? 1 : 0
  uniforms.hmDofBlur.value = Math.max(0, state.blurPx)
  uniforms.hmDofMinBlur.value = Math.max(
    0,
    Math.min(state.blurPx, state.minimumBlurPx),
  )
  uniforms.hmPlaneSize.value.set(
    Math.max(1, state.planeWidth),
    Math.max(1, state.planeHeight),
  )
  uniforms.hmFocusMask.value = state.focusMask ? 1 : 0
  uniforms.hmFocusCenter.value.set(
    state.focusX / Math.max(1, state.planeWidth),
    state.focusY / Math.max(1, state.planeHeight),
  )
  uniforms.hmFocusRadius.value = Math.max(0, state.focusRadius)
  uniforms.hmFocusFalloff.value = Math.max(0.001, state.focusFalloff)
  const sampleCount = clampInt(
    state.sampleCount,
    1,
    MAX_DOF_KERNEL_SAMPLES,
  )
  uniforms.hmSampleCount.value = sampleCount
  const safeBokehRatio = clamp(state.bokehRatio, 0.25, 4)
  uniforms.hmApertureStretch.value = Math.max(
    Math.sqrt(safeBokehRatio),
    1 / Math.sqrt(safeBokehRatio),
  )
  uniforms.hmDofKernel.value = apertureKernelVectors(
    state.bladeCount,
    state.bladeRotation,
    state.bokehRatio,
    sampleCount,
  )
}

function apertureKernelVectors(
  bladeCount: number,
  rotationDegrees: number,
  bokehRatio: number,
  sampleCount: number,
): THREE.Vector2[] {
  const blades = clampInt(bladeCount, 3, 16)
  const rotation = Number(rotationDegrees.toFixed(3))
  const ratio = Number(clamp(bokehRatio, 0.25, 4).toFixed(3))
  const count = clampInt(sampleCount, 1, MAX_DOF_KERNEL_SAMPLES)
  const key = `${blades}:${rotation}:${ratio}:${count}`
  const cached = kernelCache.get(key)
  if (cached) return cached
  const vectors = createApertureKernel(
    count,
    blades,
    rotation,
    ratio,
  ).map(({ x, y }) => new THREE.Vector2(x, y))
  while (vectors.length < MAX_DOF_KERNEL_SAMPLES) {
    vectors.push(new THREE.Vector2())
  }
  kernelCache.set(key, vectors)
  return vectors
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max))
}

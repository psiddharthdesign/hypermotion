// SPDX-License-Identifier: Apache-2.0

import type { AnimatedValue } from '@/anim'
import type { CameraNode } from '@/scene'
import {
  cameraVignetteMultiplier,
  normalizeCameraPostEffects,
  type CameraPostEffectsState,
} from '@/render3d/postEffects'

const BLOOM_MIN_SIGMA = 2
const BLOOM_RADIUS_SIGMA = 18

/** Resolve authored enable flags and live numeric animation for the fallback. */
export function resolveFallbackCameraPostEffects(
  camera: CameraNode | null | undefined,
  animated: AnimatedValue | null | undefined,
): CameraPostEffectsState | null {
  if (!camera) return null
  return normalizeCameraPostEffects({
    chromaticAberrationEnabled: camera.chromaticAberrationEnabled,
    chromaticAberrationAmount:
      animated?.chromaticAberrationAmount ?? camera.chromaticAberrationAmount,
    chromaticAberrationAngle:
      animated?.chromaticAberrationAngle ?? camera.chromaticAberrationAngle,
    bloomEnabled: camera.bloomEnabled,
    bloomStrength: animated?.bloomStrength ?? camera.bloomStrength,
    bloomRadius: animated?.bloomRadius ?? camera.bloomRadius,
    bloomThreshold: animated?.bloomThreshold ?? camera.bloomThreshold,
    vhsEnabled: camera.vhsEnabled,
    vhsIntensity: animated?.vhsIntensity ?? camera.vhsIntensity,
    vhsNoise: animated?.vhsNoise ?? camera.vhsNoise,
    vhsScanlines: animated?.vhsScanlines ?? camera.vhsScanlines,
    vhsColorBleed: animated?.vhsColorBleed ?? camera.vhsColorBleed,
    vignetteEnabled: camera.vignetteEnabled,
    vignetteAmount: animated?.vignetteAmount ?? camera.vignetteAmount,
    vignetteSize: animated?.vignetteSize ?? camera.vignetteSize,
    vignetteFeather: animated?.vignetteFeather ?? camera.vignetteFeather,
  })
}

/**
 * Opaque linear-RGB attenuation image for an SVG arithmetic multiply. The
 * normalized viewBox stretches with the viewport, matching the shader's UV
 * ellipse. Sampling the transition itself keeps even a zero-feather edge
 * smooth without requiring a large raster texture.
 */
export function fallbackVignetteImage(
  effects: CameraPostEffectsState,
): string {
  const start = effects.vignetteSize
  const end = Math.min(1, start + Math.max(effects.vignetteFeather, 0.001))
  const stops = ['<stop offset="0" stop-color="white"/>']
  const samples = 64
  for (let index = 0; index <= samples; index++) {
    const radius = start + (end - start) * index / samples
    const linear = cameraVignetteMultiplier(radius, effects)
    // feImage decodes SVG pixels into the filter's linearRGB working space.
    const encoded = linear <= 0.0031308
      ? linear * 12.92
      : 1.055 * linear ** (1 / 2.4) - 0.055
    const channel = (encoded * 100).toFixed(6)
    stops.push(`<stop offset="${radius}" stop-color="rgb(${channel}%,${channel}%,${channel}%)"/>`)
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 2 2"><defs><radialGradient id="v" gradientUnits="userSpaceOnUse" cx="1" cy="1" r="${Math.SQRT2}" color-interpolation="linearRGB">${stops.join('')}</radialGradient></defs><rect width="2" height="2" fill="url(#v)"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** Map UnrealBloomPass's 0...1 radius onto an SVG Gaussian sigma. */
export function fallbackBloomSigma(radius: number): number {
  const normalized = Math.max(
    0,
    Math.min(1, finiteFallbackNumber(radius, 0.35)),
  )
  return BLOOM_MIN_SIGMA + normalized * BLOOM_RADIUS_SIGMA
}

/** Reserve enough filter space for Gaussian tails and displaced channels. */
export function fallbackPostEffectPadding(
  effects: CameraPostEffectsState,
): number {
  const bloomPadding =
    effects.bloomEnabled && effects.bloomStrength > 0.001
      ? fallbackBloomSigma(effects.bloomRadius) * 3
      : 0
  const chromaticPadding =
    effects.chromaticAberrationEnabled
      ? effects.chromaticAberrationAmount
      : 0
  return Math.ceil(bloomPadding + chromaticPadding + 2)
}

export function finiteFallbackNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

// SPDX-License-Identifier: Apache-2.0

import type { AnimatedValue } from '@/anim'
import type { CameraNode } from '@/scene'
import {
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
  })
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

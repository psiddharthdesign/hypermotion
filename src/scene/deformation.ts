// SPDX-License-Identifier: Apache-2.0

import type {
  BendDeformation,
  DeformationVector3,
  LayerDeformation,
} from './types'

export const MIN_BEND_GEOMETRY_DETAIL = 4
export const MAX_BEND_GEOMETRY_DETAIL = 128

export const DEFAULT_BEND_DEFORMATION: BendDeformation = Object.freeze({
  kind: 'bend',
  mode: 'arc',
  waveAmplitude: 40,
  waveFrequency: 2,
  wavePhase: 0,
  waveStart: 0,
  waveEnd: 1,
  waveFalloff: 0.1,

  enabled: true,
  angle: 0,
  factor: 1,
  bothDirections: false,
  limitToRegion: true,
  showOriginalGeometry: false,
  captureDirection: Object.freeze({ x: 1, y: 0, z: 0 }),
  captureRotation: 0,
  // A new bend should read as a surface folding through camera depth. The
  // previous Y-up default only curved the pixels inside the canvas plane.
  upDirection: Object.freeze({ x: 0, y: 0, z: 1 }),
  upRotation: 0,
  bendRotation: 0,
  captureOrigin: Object.freeze({ x: 0, y: 0, z: 0 }),
  captureLength: 0,
  surfaceShading: true,
  depthAware: true,
  lightAzimuth: 135,
  lightElevation: 55,
  ambient: 0.82,
  diffuse: 0.28,
  specular: 0.12,
  roughness: 0.62,
  geometryDetail: 32,
})

export function normalizeLayerDeformation(
  value: unknown,
): LayerDeformation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Partial<BendDeformation> & { kind?: unknown }
  if (source.kind !== 'bend') return null
  return {
    kind: 'bend',
    mode: source.mode === 'wave' ? 'wave' : 'arc',
    waveAmplitude: finite(source.waveAmplitude, 40),
    waveFrequency: clamp(finite(source.waveFrequency, 2), 0, 32),
    wavePhase: finite(source.wavePhase, 0),
    waveStart: clamp(finite(source.waveStart, 0), 0, 1),
    waveEnd: clamp(finite(source.waveEnd, 1), 0, 1),
    waveFalloff: clamp(finite(source.waveFalloff, .1), 0, .5),
    enabled: booleanValue(source.enabled, true),
    angle: finite(source.angle, 0),
    factor: clamp(finite(source.factor, 1), 0, 1),
    bothDirections: booleanValue(source.bothDirections, false),
    limitToRegion: booleanValue(source.limitToRegion, true),
    showOriginalGeometry: booleanValue(source.showOriginalGeometry, false),
    captureDirection: vector(source.captureDirection, { x: 1, y: 0, z: 0 }),
    captureRotation: finite(source.captureRotation, 0),
    upDirection: vector(
      source.upDirection,
      DEFAULT_BEND_DEFORMATION.upDirection,
    ),
    upRotation: finite(source.upRotation, 0),
    bendRotation: finite(source.bendRotation, 0),
    captureOrigin: vector(source.captureOrigin, { x: 0, y: 0, z: 0 }),
    captureLength: Math.max(0, finite(source.captureLength, 0)),
    surfaceShading: booleanValue(source.surfaceShading, true),
    depthAware: booleanValue(source.depthAware, true),
    lightAzimuth: finite(source.lightAzimuth, 135),
    lightElevation: clamp(finite(source.lightElevation, 55), -90, 90),
    ambient: clamp(finite(source.ambient, 0.82), 0, 2),
    diffuse: clamp(finite(source.diffuse, 0.28), 0, 2),
    specular: clamp(finite(source.specular, 0.12), 0, 2),
    roughness: clamp(finite(source.roughness, 0.62), 0, 1),
    geometryDetail: Math.round(
      clamp(
        finite(source.geometryDetail, DEFAULT_BEND_DEFORMATION.geometryDetail),
        MIN_BEND_GEOMETRY_DETAIL,
        MAX_BEND_GEOMETRY_DETAIL,
      ),
    ),
  }
}

function vector(
  value: unknown,
  fallback: DeformationVector3,
): DeformationVector3 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...fallback }
  }
  const source = value as Partial<DeformationVector3>
  return {
    x: finite(source.x, fallback.x),
    y: finite(source.y, fallback.y),
    z: finite(source.z, fallback.z),
  }
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

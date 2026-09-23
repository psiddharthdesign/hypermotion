// SPDX-License-Identifier: Apache-2.0

import type { AnimatedValue } from '@/anim'
import type { Rect } from '@/layout'
import {
  DEFAULT_BEND_DEFORMATION,
  normalizeLayerDeformation,
} from '@/scene/deformation'
import type {
  BendDeformation,
  DeformationVector3,
} from '@/scene/types'

export interface ResolvedBendDeformation extends BendDeformation {
  /** Capture length after resolving the layer-bounds-aware automatic value. */
  resolvedLength: number
}

export interface BendDeformationSource {
  deformation: unknown
  animated?: AnimatedValue
  rect: Rect
}

/**
 * Depth compositing is a property of the authored Bend surface, not its
 * current animated amount. Keeping it active at zero angle/factor prevents a
 * material-program switch on the exact frame an animation settles flat.
 */
export function bendUsesDepthCompositing(
  deformations: readonly (ResolvedBendDeformation | BendDeformation)[],
): boolean {
  return deformations.some(
    (deformation) => deformation.enabled && deformation.depthAware,
  )
}

export function resolveBendDeformation(
  deformation: unknown,
  animated: AnimatedValue | undefined,
  layerWidth: number,
  layerHeight: number,
): ResolvedBendDeformation | null {
  const normalized = normalizeLayerDeformation(deformation)
  if (!normalized || normalized.kind !== 'bend') return null
  const captureDirection = {
    x: animated?.bendCaptureDirectionX ?? normalized.captureDirection.x,
    y: animated?.bendCaptureDirectionY ?? normalized.captureDirection.y,
    z: animated?.bendCaptureDirectionZ ?? normalized.captureDirection.z,
  }
  const captureLength = Math.max(
    0,
    animated?.bendCaptureLength ?? normalized.captureLength,
  )
  const captureRotation = animated?.bendCaptureRotation ?? normalized.captureRotation
  const waveFrequency = clamp(animated?.bendWaveFrequency ?? normalized.waveFrequency, 0, 32)
  const waveSpan = Math.max(.01, (animated?.bendWaveEnd ?? normalized.waveEnd) - (animated?.bendWaveStart ?? normalized.waveStart))
  return {
    ...normalized,
    geometryDetail: normalized.mode === 'wave'
      ? Math.max(normalized.geometryDetail, Math.min(512, Math.ceil(waveFrequency * 32 / waveSpan)))
      : normalized.geometryDetail,
    waveFalloff: clamp(animated?.bendWaveFalloff ?? normalized.waveFalloff, 0, .5),
    waveEnd: clamp(animated?.bendWaveEnd ?? normalized.waveEnd, 0, 1),
    waveStart: clamp(animated?.bendWaveStart ?? normalized.waveStart, 0, 1),
    wavePhase: animated?.bendWavePhase ?? normalized.wavePhase,
    waveFrequency: clamp(animated?.bendWaveFrequency ?? normalized.waveFrequency, 0, 32),
    waveAmplitude: animated?.bendWaveAmplitude ?? normalized.waveAmplitude,
    angle: animated?.bendAngle ?? normalized.angle,
    factor: clamp(animated?.bendFactor ?? normalized.factor, 0, 1),
    captureDirection,
    captureRotation:
      animated?.bendCaptureRotation ?? normalized.captureRotation,
    upDirection: {
      x: animated?.bendUpDirectionX ?? normalized.upDirection.x,
      y: animated?.bendUpDirectionY ?? normalized.upDirection.y,
      z: animated?.bendUpDirectionZ ?? normalized.upDirection.z,
    },
    upRotation: animated?.bendUpRotation ?? normalized.upRotation,
    bendRotation: animated?.bendRotation ?? normalized.bendRotation,
    captureOrigin: {
      x: animated?.bendCaptureOriginX ?? normalized.captureOrigin.x,
      y: animated?.bendCaptureOriginY ?? normalized.captureOrigin.y,
      z: animated?.bendCaptureOriginZ ?? normalized.captureOrigin.z,
    },
    captureLength,
    lightAzimuth:
      animated?.bendLightAzimuth ?? normalized.lightAzimuth,
    lightElevation:
      animated?.bendLightElevation ?? normalized.lightElevation,
    ambient: clamp(animated?.bendAmbient ?? normalized.ambient, 0, 2),
    diffuse: clamp(animated?.bendDiffuse ?? normalized.diffuse, 0, 2),
    specular: clamp(animated?.bendSpecular ?? normalized.specular, 0, 2),
    roughness: clamp(animated?.bendRoughness ?? normalized.roughness, 0, 1),
    resolvedLength: Math.max(
      1,
      captureLength > 0
        ? captureLength
        : automaticCaptureLength(rotateAroundAxis(captureDirection, { x: 0, y: 0, z: 1 }, degreesToRadians(captureRotation)), layerWidth, layerHeight),
    ),
  }
}

/**
 * Express a Bend field authored around one layer in another plane's local
 * coordinates. The curve itself is unchanged; only its capture origin moves.
 * This is what lets independently transformed 3D descendants remain pieces
 * of one continuous bent ancestor surface.
 */
export function bendDeformationInTargetSpace(
  deformation: ResolvedBendDeformation,
  sourceRect: Rect,
  targetRect: Rect,
): ResolvedBendDeformation {
  return {
    ...deformation,
    captureOrigin: {
      x:
        deformation.captureOrigin.x +
        sourceRect.x + sourceRect.width / 2 -
        (targetRect.x + targetRect.width / 2),
      y:
        deformation.captureOrigin.y +
        sourceRect.y + sourceRect.height / 2 -
        (targetRect.y + targetRect.height / 2),
      z: deformation.captureOrigin.z,
    },
  }
}

/**
 * Resolve a root-to-leaf Bend owner chain into the target plane's coordinates.
 *
 * The returned modifier order is leaf-to-root: a child first shapes its own
 * local geometry, then that result is carried by each enclosing bent surface.
 * This matches the editor's "Bend on top of Bend" model and keeps the outer
 * surface continuous across independently rasterized 3D descendants.
 */
export function resolveBendStackInTargetSpace(
  sources: readonly BendDeformationSource[],
  targetRect: Rect,
): ResolvedBendDeformation[] {
  const resolved = sources.flatMap((source) => {
    const bend = resolveBendDeformation(
      source.deformation,
      source.animated,
      source.rect.width,
      source.rect.height,
    )
    return bend
      ? [bendDeformationInTargetSpace(bend, source.rect, targetRect)]
      : []
  })
  return resolved.reverse()
}

/** Apply an already ordered Bend modifier stack. Used by CPU geometry chrome. */
export function bendPointStack(
  point: DeformationVector3,
  deformations: readonly (ResolvedBendDeformation | BendDeformation)[],
): DeformationVector3 {
  return deformations.reduce(
    (current, deformation) => bendPoint(current, deformation),
    { ...point },
  )
}

/** CPU mirror of the vertex shader, used by selection/reference outlines. */
export function bendPoint(
  point: DeformationVector3,
  deformation: ResolvedBendDeformation | BendDeformation,
  automaticLength = 1,
): DeformationVector3 {
  if (!deformation.enabled || (deformation.mode !== 'wave' && Math.abs(deformation.angle) < 0.0001)) {
    return { ...point }
  }
  const factor = clamp(deformation.factor, 0, 1)
  if (factor <= 0) return { ...point }
  const length = Math.max(
    1e-4,
    'resolvedLength' in deformation
      ? deformation.resolvedLength
      : deformation.captureLength > 0
        ? deformation.captureLength
        : automaticLength,
  )
  const basis = bendBasis(deformation)
  const relative = subtract(point, deformation.captureOrigin)
  const s = dot(relative, basis.capture)
  if (deformation.mode === 'wave') {
    const position = s / length + .5
    const span = deformation.waveEnd - deformation.waveStart
    if (span <= 0 || position < deformation.waveStart || position >= deformation.waveEnd) return { ...point }
    const t = (position - deformation.waveStart) / span
    const smooth = (v: number) => { const x = clamp(v, 0, 1); return x * x * (3 - 2 * x) }
    const fade = deformation.waveFalloff
    const envelope = fade > 0 ? smooth(t / fade) * smooth((1 - t) / fade) : 1
    const displacement = deformation.waveAmplitude * Math.sin(2 * Math.PI * deformation.waveFrequency * t + degreesToRadians(deformation.wavePhase)) * envelope * factor
    return add(point, scale(basis.up, displacement))
  }
  const h = dot(relative, basis.up)
  const across = dot(relative, basis.across)
  const start = deformation.bothDirections ? -length / 2 : 0
  const q = s - start
  const curvature = degreesToRadians(deformation.angle) / length
  const bent = bendCoordinates(
    q,
    h,
    start,
    length,
    curvature,
    deformation.limitToRegion,
  )
  let displaced = add(
    deformation.captureOrigin,
    add(
      scale(basis.capture, bent.along),
      add(scale(basis.up, bent.up), scale(basis.across, across)),
    ),
  )
  if (Math.abs(deformation.bendRotation) > 0.0001) {
    displaced = add(
      deformation.captureOrigin,
      rotateAroundAxis(
        subtract(displaced, deformation.captureOrigin),
        basis.capture,
        degreesToRadians(deformation.bendRotation),
      ),
    )
  }
  return mix(point, displaced, factor)
}

export function bendBasis(deformation: BendDeformation): {
  capture: DeformationVector3
  up: DeformationVector3
  across: DeformationVector3
} {
  const zAxis = { x: 0, y: 0, z: 1 }
  let capture = normalizeOr(
    deformation.captureDirection,
    DEFAULT_BEND_DEFORMATION.captureDirection,
  )
  capture = rotateAroundAxis(
    capture,
    zAxis,
    degreesToRadians(deformation.captureRotation),
  )
  let up = rotateAroundAxis(
    deformation.upDirection,
    zAxis,
    degreesToRadians(deformation.upRotation + (deformation.mode === 'wave' ? deformation.captureRotation : 0)),
  )
  up = subtract(up, scale(capture, dot(up, capture)))
  if (lengthSquared(up) < 1e-8) {
    const fallback = Math.abs(capture.z) < 0.9 ? zAxis : { x: 0, y: 1, z: 0 }
    up = subtract(fallback, scale(capture, dot(fallback, capture)))
  }
  up = normalizeOr(up, DEFAULT_BEND_DEFORMATION.upDirection)
  const across = normalizeOr(cross(capture, up), { x: 0, y: 0, z: 1 })
  // Re-orthogonalize so malformed authored vectors cannot shear the mesh.
  up = normalizeOr(cross(across, capture), up)
  return { capture, up, across }
}

function bendCoordinates(
  q: number,
  h: number,
  start: number,
  length: number,
  curvature: number,
  limitToRegion: boolean,
): { along: number; up: number } {
  if (Math.abs(curvature) < 1e-8) return { along: start + q, up: h }
  if (!limitToRegion || (q >= 0 && q <= length)) {
    return arcCoordinates(q, h, start, curvature)
  }
  const endpointQ = q < 0 ? 0 : length
  const endpoint = arcCoordinates(endpointQ, 0, start, curvature)
  const theta = curvature * endpointQ
  const tangent = { x: Math.cos(theta), y: Math.sin(theta) }
  const normal = { x: -Math.sin(theta), y: Math.cos(theta) }
  const extension = q - endpointQ
  return {
    along: endpoint.along + tangent.x * extension + normal.x * h,
    up: endpoint.up + tangent.y * extension + normal.y * h,
  }
}

function arcCoordinates(
  q: number,
  h: number,
  start: number,
  curvature: number,
): { along: number; up: number } {
  const theta = curvature * q
  const radius = 1 / curvature
  return {
    along: start + Math.sin(theta) * (radius - h),
    up: (1 - Math.cos(theta)) * radius + Math.cos(theta) * h,
  }
}

function automaticCaptureLength(
  direction: DeformationVector3,
  width: number,
  height: number,
): number {
  const normalized = normalizeOr(
    direction,
    DEFAULT_BEND_DEFORMATION.captureDirection,
  )
  return Math.max(
    1,
    Math.abs(normalized.x) * Math.max(1, width) +
      Math.abs(normalized.y) * Math.max(1, height),
  )
}

function rotateAroundAxis(
  value: DeformationVector3,
  axisValue: DeformationVector3,
  radians: number,
): DeformationVector3 {
  const axis = normalizeOr(axisValue, { x: 0, y: 0, z: 1 })
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return add(
    add(scale(value, cosine), scale(cross(axis, value), sine)),
    scale(axis, dot(axis, value) * (1 - cosine)),
  )
}

function normalizeOr(
  value: DeformationVector3,
  fallback: DeformationVector3,
): DeformationVector3 {
  const magnitude = Math.sqrt(lengthSquared(value))
  return magnitude > 1e-8 ? scale(value, 1 / magnitude) : { ...fallback }
}

function lengthSquared(value: DeformationVector3): number {
  return dot(value, value)
}

function dot(a: DeformationVector3, b: DeformationVector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: DeformationVector3, b: DeformationVector3): DeformationVector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function add(a: DeformationVector3, b: DeformationVector3): DeformationVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function subtract(a: DeformationVector3, b: DeformationVector3): DeformationVector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function scale(value: DeformationVector3, amount: number): DeformationVector3 {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount }
}

function mix(a: DeformationVector3, b: DeformationVector3, amount: number): DeformationVector3 {
  return {
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
    z: a.z + (b.z - a.z) * amount,
  }
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

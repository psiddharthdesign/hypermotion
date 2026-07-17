// SPDX-License-Identifier: Apache-2.0

// Import the side-effect-free type module directly: importing the aggregate
// scene barrel would initialize IndexedDB in pure unit-test/headless contexts.
import { normalizeCameraScrollSensitivity } from '@/scene/types'

const LINE_HEIGHT_PX = 16
const MAX_WHEEL_PACKET_PX = 48
const DOLLY_SENSITIVITY = 0.00125
const FINE_DOLLY_FACTOR = 0.25

// Match the hard safety envelope used by the WebGL camera. A distance of one
// world unit is the nearest useful point before the perspective projection's
// singularity. The far bound is intentionally broad: scroll sensitivity
// controls how quickly the camera travels, while this range only prevents
// runaway/invalid values.
const MIN_CAMERA_DISTANCE = 1
const MAX_CAMERA_DISTANCE_IN_FOCAL_LENGTHS = 1000

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Convert DOM_DELTA_PIXEL / LINE / PAGE packets to a bounded pixel delta. */
export function normalizedWheelDeltaY(
  deltaY: number,
  deltaMode: number,
  pageHeight: number,
): number {
  if (!Number.isFinite(deltaY)) return 0
  const unit =
    deltaMode === 1
      ? LINE_HEIGHT_PX
      : deltaMode === 2
        ? Math.max(1, Number.isFinite(pageHeight) ? pageHeight : 1)
        : 1
  return clamp(deltaY * unit, -MAX_WHEEL_PACKET_PX, MAX_WHEEL_PACKET_PX)
}

export interface CameraWheelDollyInput {
  currentZ: number
  focalLength: number
  deltaY: number
  deltaMode: number
  pageHeight: number
  /** Per-camera multiplier. 1 = the deliberately gentle default response. */
  scrollSensitivity?: number
  /** Option/Alt follows the editor's number-field convention: fine motion. */
  fine?: boolean
}

export interface CameraWheelStartZInput {
  /** Accumulated Z from this still-active wheel burst. */
  pendingZ?: number
  /** Transient Z that is still visible during the durable-data handoff. */
  previewZ?: number
  /** Latest animation-engine value at the current playhead. */
  animatedZ?: number
  /** Persisted camera transform fallback. */
  staticZ: number
}

/** Resolve wheel input from exactly the same precedence as the visible camera. */
export function cameraWheelStartZ(input: CameraWheelStartZInput): number {
  for (const value of [
    input.pendingZ,
    input.previewZ,
    input.animatedZ,
    input.staticZ,
  ]) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return 0
}

/**
 * Move a perspective camera along Z using a proportional distance change.
 *
 * Working in lens distance rather than adding a fixed Z amount makes the
 * visible zoom response consistent at every focal length and existing zoom.
 */
export function cameraZFromWheel(input: CameraWheelDollyInput): number {
  const focalLength = Math.max(
    1,
    Number.isFinite(input.focalLength) ? input.focalLength : 1000,
  )
  const minDistance = MIN_CAMERA_DISTANCE
  const maxDistance = focalLength * MAX_CAMERA_DISTANCE_IN_FOCAL_LENGTHS
  // Three's camera resolver also clamps its lens-to-plane distance to one.
  // Preserve the authored distance above that floor, even when an older scene
  // starts beyond today's broad far safety bound. Clamping the *input* first
  // made the first wheel packet jump directly to the boundary. Expanding the
  // one-gesture bounds to include the current pose lets the user travel back
  // toward safety smoothly while still preventing movement farther outward.
  const authoredDistance =
    focalLength - (Number.isFinite(input.currentZ) ? input.currentZ : 0)
  const currentDistance = Math.max(
    minDistance,
    Number.isFinite(authoredDistance) ? authoredDistance : focalLength,
  )
  const delta = normalizedWheelDeltaY(
    input.deltaY,
    input.deltaMode,
    input.pageHeight,
  )
  const scrollSensitivity = normalizeCameraScrollSensitivity(
    input.scrollSensitivity,
  )
  const sensitivity =
    DOLLY_SENSITIVITY *
    scrollSensitivity *
    (input.fine ? FINE_DOLLY_FACTOR : 1)
  const requestedDistance = currentDistance * Math.exp(delta * sensitivity)
  const gestureMinDistance = Math.min(minDistance, currentDistance)
  const gestureMaxDistance = Math.max(maxDistance, currentDistance)
  const nextDistance = clamp(
    requestedDistance,
    gestureMinDistance,
    gestureMaxDistance,
  )
  return focalLength - nextDistance
}

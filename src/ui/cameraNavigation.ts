// SPDX-License-Identifier: Apache-2.0

import {
  normalizeCameraScrollSensitivity,
  type Transform,
} from '@/scene/types'
import {
  cameraZFromWheel,
  normalizedWheelDeltaY,
  type CameraWheelDollyInput,
} from '@/ui/cameraWheel'

export type CameraNavigationMode = 'orbit' | 'pan' | 'dolly'

export type CameraOrbitPatch = Pick<Transform, 'rotationX' | 'rotationY'>
export type CameraPanPatch = Pick<Transform, 'x' | 'y'>
export type CameraDollyPatch = Pick<Transform, 'z'>

export interface CameraPointerNavigationInput {
  button: number
  altKey?: boolean
  shiftKey?: boolean
  ctrlKey?: boolean
}

export interface CameraWheelNavigationInput {
  altKey?: boolean
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
}

/**
 * Blender-style pointer navigation.
 *
 * Middle-mouse is the primary chord. Option/Alt + primary click mirrors it
 * for trackpads and two-button mice. Ctrl deliberately wins over Shift when
 * both are held, matching the more-specific dolly gesture.
 */
export function resolveCameraPointerNavigation(
  input: CameraPointerNavigationInput,
): CameraNavigationMode | null {
  const isMiddleMouse = input.button === 1
  const isEmulatedMiddleMouse = input.button === 0 && input.altKey === true
  if (!isMiddleMouse && !isEmulatedMiddleMouse) return null
  if (input.ctrlKey) return 'dolly'
  if (input.shiftKey) return 'pan'
  return 'orbit'
}

/**
 * Resolve wheel/trackpad navigation after the editor has had first refusal
 * for its Ctrl/Cmd zoom gesture.
 */
export function resolveCameraWheelNavigation(
  input: CameraWheelNavigationInput,
): CameraNavigationMode | null {
  if (input.ctrlKey || input.metaKey) return null
  if (input.shiftKey) return 'pan'
  if (input.altKey) return 'orbit'
  return 'dolly'
}

export interface NormalizedWheelDeltasInput {
  deltaX: number
  deltaY: number
  deltaMode: number
  pageWidth: number
  pageHeight: number
}

/** Normalize both wheel axes with the same bounded packet policy as dolly. */
export function normalizedWheelDeltas(
  input: NormalizedWheelDeltasInput,
): { x: number; y: number } {
  return {
    x: normalizedWheelDeltaY(
      input.deltaX,
      input.deltaMode,
      input.pageWidth,
    ),
    y: normalizedWheelDeltaY(
      input.deltaY,
      input.deltaMode,
      input.pageHeight,
    ),
  }
}

const POINTER_ORBIT_DEGREES_PER_PIXEL = 0.16
const WHEEL_ORBIT_DEGREES_PER_PIXEL = 0.08
const POINTER_DOLLY_SENSITIVITY = 0.005
const MIN_CAMERA_DISTANCE = 1
const MAX_CAMERA_DISTANCE_IN_FOCAL_LENGTHS = 1000

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function cameraPanDivisor(
  workspaceZoom: number,
  cameraApparentScale: number,
): number {
  const zoom = Math.abs(finiteOr(workspaceZoom, 1))
  const cameraScale = Math.abs(finiteOr(cameraApparentScale, 1))
  return Math.max(0.1, zoom * cameraScale)
}

export interface CameraOrbitFromPointerInput {
  startRotationX: number
  startRotationY: number
  deltaX: number
  deltaY: number
  degreesPerPixel?: number
}

export function cameraOrbitFromPointer(
  input: CameraOrbitFromPointerInput,
): CameraOrbitPatch {
  const sensitivity = Math.max(
    0,
    finiteOr(input.degreesPerPixel ?? POINTER_ORBIT_DEGREES_PER_PIXEL, 0),
  )
  const deltaX = finiteOr(input.deltaX, 0)
  const deltaY = finiteOr(input.deltaY, 0)
  return {
    rotationX: clamp(
      finiteOr(input.startRotationX, 0) - deltaY * sensitivity,
      -89,
      89,
    ),
    rotationY: finiteOr(input.startRotationY, 0) + deltaX * sensitivity,
  }
}

export interface CameraOrbitFromWheelInput {
  currentRotationX: number
  currentRotationY: number
  deltaX: number
  deltaY: number
  deltaMode: number
  pageWidth: number
  pageHeight: number
  degreesPerPixel?: number
}

export function cameraOrbitFromWheel(
  input: CameraOrbitFromWheelInput,
): CameraOrbitPatch {
  const delta = normalizedWheelDeltas(input)
  const sensitivity = Math.max(
    0,
    finiteOr(input.degreesPerPixel ?? WHEEL_ORBIT_DEGREES_PER_PIXEL, 0),
  )
  return {
    rotationX: clamp(
      finiteOr(input.currentRotationX, 0) - delta.y * sensitivity,
      -89,
      89,
    ),
    rotationY:
      finiteOr(input.currentRotationY, 0) + delta.x * sensitivity,
  }
}

export interface CameraPanFromPointerInput {
  startX: number
  startY: number
  deltaX: number
  deltaY: number
  workspaceZoom: number
  cameraApparentScale: number
}

export function cameraPanFromPointer(
  input: CameraPanFromPointerInput,
): CameraPanPatch {
  const divisor = cameraPanDivisor(
    input.workspaceZoom,
    input.cameraApparentScale,
  )
  return {
    x: finiteOr(input.startX, 0) - finiteOr(input.deltaX, 0) / divisor,
    y: finiteOr(input.startY, 0) - finiteOr(input.deltaY, 0) / divisor,
  }
}

export interface CameraPanFromWheelInput {
  currentX: number
  currentY: number
  deltaX: number
  deltaY: number
  deltaMode: number
  pageWidth: number
  pageHeight: number
  workspaceZoom: number
  cameraApparentScale: number
}

export function cameraPanFromWheel(
  input: CameraPanFromWheelInput,
): CameraPanPatch {
  const delta = normalizedWheelDeltas(input)
  const divisor = cameraPanDivisor(
    input.workspaceZoom,
    input.cameraApparentScale,
  )
  // Wheel deltas describe the direction content should scroll. Since the
  // renderer applies the inverse camera transform, advancing the camera in
  // the same direction produces that familiar scroll response.
  return {
    x: finiteOr(input.currentX, 0) + delta.x / divisor,
    y: finiteOr(input.currentY, 0) + delta.y / divisor,
  }
}

export interface CameraZFromPointerDragInput {
  startZ: number
  focalLength: number
  deltaY: number
  scrollSensitivity?: number
}

/**
 * Dolly from a pointer drag in lens-distance space.
 *
 * Unlike a wheel packet, a drag is measured from its start pose and must not
 * be packet-capped. The exponential response stays proportional at every
 * focal length while preserving the renderer's near/far safety envelope.
 */
export function cameraZFromPointerDrag(
  input: CameraZFromPointerDragInput,
): number {
  const focalLength = Math.max(1, finiteOr(input.focalLength, 1000))
  const authoredDistance = focalLength - finiteOr(input.startZ, 0)
  const currentDistance = Math.max(
    MIN_CAMERA_DISTANCE,
    finiteOr(authoredDistance, focalLength),
  )
  const sensitivity =
    POINTER_DOLLY_SENSITIVITY *
    normalizeCameraScrollSensitivity(input.scrollSensitivity)
  const exponent = clamp(finiteOr(input.deltaY, 0) * sensitivity, -20, 20)
  const requestedDistance = currentDistance * Math.exp(exponent)
  const nominalMaxDistance =
    focalLength * MAX_CAMERA_DISTANCE_IN_FOCAL_LENGTHS
  const gestureMinDistance = Math.min(MIN_CAMERA_DISTANCE, currentDistance)
  const gestureMaxDistance = Math.max(nominalMaxDistance, currentDistance)
  const nextDistance = clamp(
    requestedDistance,
    gestureMinDistance,
    gestureMaxDistance,
  )
  return focalLength - nextDistance
}

/** Return the Z-only patch used by a wheel/trackpad dolly gesture. */
export function cameraDollyFromWheel(
  input: CameraWheelDollyInput,
): CameraDollyPatch {
  return { z: cameraZFromWheel(input) }
}

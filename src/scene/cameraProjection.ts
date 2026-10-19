// SPDX-License-Identifier: Apache-2.0

export type CameraProjection = '2d' | 'perspective' | 'orthographic'

export function normalizeCameraProjection(value: unknown): CameraProjection {
  return value === 'perspective' || value === 'orthographic' ? value : '2d'
}

/** Equal axis foreshortening, with the XY artboard forming a 30° diamond. */
export const ISOMETRIC_CAMERA_ROTATION = {
  rotationX: Math.asin(1 / Math.sqrt(3)) * 180 / Math.PI,
  rotationY: 45,
  rotation: 120,
} as const

/** Four views above the XY ground plane; negative Z is height, positive Z is depth. */
export const ISOMETRIC_CAMERA_VIEWS = [
  {
    id: 'back-left', label: 'Back left',
    rotation: { rotationX: -ISOMETRIC_CAMERA_ROTATION.rotationX, rotationY: 45, rotation: 60 },
  },
  {
    id: 'back-right', label: 'Back right',
    rotation: { rotationX: -ISOMETRIC_CAMERA_ROTATION.rotationX, rotationY: -45, rotation: -60 },
  },
  { id: 'front-left', label: 'Front left', rotation: ISOMETRIC_CAMERA_ROTATION },
  {
    id: 'front-right', label: 'Front right',
    rotation: { rotationX: ISOMETRIC_CAMERA_ROTATION.rotationX, rotationY: -45, rotation: -120 },
  },
] as const

/** Four isometric views above the XY composition plane. */
export const CAMERA_VIEW_PRESETS = ISOMETRIC_CAMERA_VIEWS

export type CameraViewPresetId = typeof CAMERA_VIEW_PRESETS[number]['id']

export function cameraViewPresetForRotation(rotation: {
  rotationX: number
  rotationY: number
  rotation: number
}): CameraViewPresetId | 'custom' {
  const match = CAMERA_VIEW_PRESETS.find(view =>
    Math.abs(view.rotation.rotationX - rotation.rotationX) < 0.01 &&
    Math.abs(view.rotation.rotationY - rotation.rotationY) < 0.01 &&
    Math.abs(view.rotation.rotation - rotation.rotation) < 0.01,
  )
  return match?.id ?? 'custom'
}

export type IsometricCameraViewId = typeof ISOMETRIC_CAMERA_VIEWS[number]['id']
export const DEFAULT_ISOMETRIC_CAMERA_VIEW_ID: IsometricCameraViewId = 'back-left'

/** Camera scale describes visible world extent: smaller values zoom in. */
export function orthographicCameraZoom(scale: number): number {
  return 1 / Math.max(0.0001, Number.isFinite(scale) ? Math.abs(scale) : 1)
}

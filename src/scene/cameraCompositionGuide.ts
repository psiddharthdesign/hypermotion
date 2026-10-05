// SPDX-License-Identifier: Apache-2.0

/** Editor-only guides, saved with each camera and never painted into exports. */
export const CAMERA_COMPOSITION_GUIDE_OPTIONS = [
  { value: 'none', label: 'Off' },
  { value: 'thirds', label: 'Rule of thirds' },
  { value: 'center', label: 'Center cross' },
  { value: 'diagonals', label: 'Diagonals' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'diamond-grid', label: 'Diamond grid' },
  { value: 'isometric', label: 'Isometric grid' },
  { value: 'golden-ratio', label: 'Golden ratio' },
  { value: 'grid', label: 'Grid (6 × 6)' },
  { value: 'safe-areas', label: 'Safe areas' },
] as const

export type CameraCompositionGuide = typeof CAMERA_COMPOSITION_GUIDE_OPTIONS[number]['value']

export function normalizeCameraCompositionGuide(value: unknown): CameraCompositionGuide {
  return CAMERA_COMPOSITION_GUIDE_OPTIONS.find((option) => option.value === value)?.value ?? 'none'
}

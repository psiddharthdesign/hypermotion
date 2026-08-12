// SPDX-License-Identifier: Apache-2.0

/** Lowest supported sibling paint-order value. */
export const MIN_LAYER_Z_INDEX = -9_999

/** Highest supported sibling paint-order value. */
export const MAX_LAYER_Z_INDEX = 9_999

/**
 * Normalize a persisted or user-authored layer z-index.
 *
 * Layer z-index is deliberately a small signed integer. Missing and invalid
 * legacy values resolve to the normal stacking level (`0`); finite numbers
 * are rounded and clamped so every renderer sees the same deterministic
 * ordering contract.
 */
export function normalizeLayerZIndex(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(
    MIN_LAYER_Z_INDEX,
    Math.min(MAX_LAYER_Z_INDEX, Math.round(value)),
  )
}

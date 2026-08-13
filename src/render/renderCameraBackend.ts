// SPDX-License-Identifier: Apache-2.0

/**
 * Keep one WebGL viewport alive while cuts switch between cameras owned by the
 * same composition. Camera changes are ordinary prop updates; remounting the
 * renderer here destroys its context and exposes a transitional cut frame.
 */
export function renderCameraBackendKey(
  compositionId: string | null | undefined,
  cameraId: string | null,
): string {
  return `${compositionId ?? 'legacy'}:${cameraId ? 'camera' : 'none'}`
}

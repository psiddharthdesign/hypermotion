// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'

/** Check the whole export's cameras, including vignettes animated on later. */
export function exportUsesVignette(
  api: Pick<SceneAPI, 'getAllCameras'>,
  cameraIds?: readonly string[],
): boolean {
  const included = cameraIds ? new Set(cameraIds) : null
  return api.getAllCameras().some(camera =>
    (!included || included.has(camera.id)) &&
    camera.enabled !== false &&
    camera.vignetteEnabled === true,
  )
}

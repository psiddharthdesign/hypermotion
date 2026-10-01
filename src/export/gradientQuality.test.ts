// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { exportUsesVignette } from './gradientQuality'

describe('vignette export quality', () => {
  it('preserves gradients even when an enabled vignette starts at zero strength', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    api.setNodeProperty(camera.id, 'vignetteEnabled', true)
    api.setNodeProperty(camera.id, 'vignetteAmount', 0)
    expect(exportUsesVignette(api, [camera.id])).toBe(true)
  })

  it('does not change quality for cameras outside the exported compositions', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    api.setNodeProperty(camera.id, 'vignetteEnabled', true)
    expect(exportUsesVignette(api, ['other-composition-camera'])).toBe(false)
    expect(exportUsesVignette(api, [])).toBe(false)
    expect(exportUsesVignette(api, ['other-composition-camera', camera.id])).toBe(true)
  })

  it('skips disabled cameras and disabled vignettes, with legacy ownership fallback', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    expect(exportUsesVignette(api)).toBe(false)
    api.setNodeProperty(camera.id, 'vignetteEnabled', true)
    expect(exportUsesVignette(api)).toBe(true)
    expect(exportUsesVignette({
      getAllCameras: () => [{ ...api.getActiveCamera()!, enabled: false }],
    })).toBe(false)
  })
})

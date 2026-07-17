// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  shouldRasterizePlaneTexture,
  textureScaleForRect,
} from './texturePolicy'

describe('WebGL plane texture policy', () => {
  it('matches a Retina framebuffer without the previous 4x oversampling', () => {
    const scale = textureScaleForRect({ width: 1104, height: 908 }, 2)

    expect(scale).toBe(2)
    expect(Math.ceil(1104 * scale)).toBe(2208)
    expect(Math.ceil(908 * scale)).toBe(1816)
    expect(2208 * 1816 * 4).toBe(16_038_912)
  })

  it('reuses a canvas texture when only the workspace view changes', () => {
    const revision = {}
    const cached = {
      textureKind: 'canvas' as const,
      textureRevision: revision,
      textureSignature: 'subtree:1104:908:0:no-focus-mask',
    }

    expect(
      shouldRasterizePlaneTexture(
        false,
        cached,
        revision,
        cached.textureSignature,
      ),
    ).toBe(false)
    expect(
      shouldRasterizePlaneTexture(false, cached, {}, cached.textureSignature),
    ).toBe(true)
  })

  it('leaves video frames to VideoTexture instead of canvas rasterization', () => {
    expect(shouldRasterizePlaneTexture(true, undefined, {}, 'video')).toBe(
      false,
    )
  })
})

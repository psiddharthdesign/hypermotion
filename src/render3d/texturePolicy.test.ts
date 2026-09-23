// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  playbackPixelRatio,
  shouldRasterizePlaneTexture,
  textureScaleForRect,
  viewportPixelRatioForZoom,
} from './texturePolicy'

describe('WebGL plane texture policy', () => {
  it('quantizes the editor framebuffer to the visible zoom footprint', () => {
    expect(viewportPixelRatioForZoom(0.23, 2)).toBe(0.5)
    expect(viewportPixelRatioForZoom(0.5, 2)).toBe(1)
    expect(viewportPixelRatioForZoom(1, 2)).toBe(2)
    expect(viewportPixelRatioForZoom(0.05, 2)).toBe(0.25)
    expect(viewportPixelRatioForZoom(0.28, 2)).toBe(0.5)
  })

  it('keeps a 4K editor preview below a 4K-class framebuffer budget', () => {
    expect(viewportPixelRatioForZoom(0.71, 2, 3840, 2160)).toBe(1)
    expect(viewportPixelRatioForZoom(1, 2, 3840, 2160)).toBe(1)
    expect(viewportPixelRatioForZoom(1, 2, 1104, 908)).toBe(2)
  })

  it('sharpens past 100% zoom on a small viewport instead of clamping at the old flat 2x ceiling', () => {
    // A small canvas has huge framebuffer headroom (MAX_EDITOR_FRAMEBUFFER_*),
    // so zooming a Retina display in past 100% should keep gaining density
    // instead of going soft the moment zoom*dpr crosses 2.
    expect(viewportPixelRatioForZoom(1.5, 2, 800, 600)).toBe(3)
    expect(viewportPixelRatioForZoom(2, 2, 800, 600)).toBe(3)
    // A large artboard still stays bounded by the real pixel budget, not the
    // raised ceiling — the framebuffer-size safety net is unchanged.
    expect(viewportPixelRatioForZoom(2, 2, 3840, 2160)).toBe(1)
  })

  it('uses a bounded realtime framebuffer and restores preview density outside playback', () => {
    expect(playbackPixelRatio(1, 3840, 2160)).toBe(0.5)
    expect(playbackPixelRatio(2, 1920, 1080)).toBe(1)
    expect(playbackPixelRatio(2, 1104, 908)).toBe(1.5)
    expect(playbackPixelRatio(0.5, 3840, 2160)).toBe(0.5)
  })

  it('matches a Retina framebuffer without the previous 4x oversampling', () => {
    const scale = textureScaleForRect({ width: 1104, height: 908 }, 2)

    expect(scale).toBe(2)
    expect(Math.ceil(1104 * scale)).toBe(2208)
    expect(Math.ceil(908 * scale)).toBe(1816)
    expect(2208 * 1816 * 4).toBe(16_038_912)
  })

  it('lets final renders request native 4K texture density', () => {
    const scale = textureScaleForRect(
      { width: 960, height: 540 },
      3.15,
      { maximumScale: 8, bucketStep: 0.5 },
    )

    expect(scale).toBe(3.5)
    expect(Math.ceil(960 * scale)).toBe(3360)
    expect(Math.ceil(540 * scale)).toBe(1890)
  })

  it('keeps projection-aware export textures inside the dimension bound', () => {
    const scale = textureScaleForRect(
      { width: 1440, height: 1080 },
      6.2,
      { maximumScale: 8, bucketStep: 0.5 },
    )

    expect(scale).toBeCloseTo(4096 / 1440)
    expect(Math.ceil(1440 * scale)).toBe(4096)
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

  it('defers re-rasterizing an existing canvas texture during an active size-preview drag', () => {
    const revision = {}
    const cached = {
      textureKind: 'canvas' as const,
      textureRevision: revision,
      textureSignature: 'subtree:1104:908:0:no-focus-mask',
    }

    // A size-changing signature would normally force a re-raster...
    expect(
      shouldRasterizePlaneTexture(false, cached, revision, 'subtree:1200:908:0:no-focus-mask'),
    ).toBe(true)
    // ...but mid-drag, the stale bitmap is left to stretch across the
    // plane's new geometry extent instead of paying a full canvas
    // reallocation + re-raster on every frame.
    expect(
      shouldRasterizePlaneTexture(
        false,
        cached,
        revision,
        'subtree:1200:908:0:no-focus-mask',
        true,
      ),
    ).toBe(false)
    // A brand-new (never-rasterized) plane still gets its first paint even
    // mid-drag — there's no bitmap yet to stretch.
    expect(
      shouldRasterizePlaneTexture(false, undefined, revision, cached.textureSignature, true),
    ).toBe(true)
  })
})

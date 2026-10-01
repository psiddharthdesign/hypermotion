// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { normalizeCameraPostEffects } from '@/render3d/postEffects'
import {
  CameraPostEffectsFallback,
} from './CameraPostEffectsFallback'
import {
  fallbackBloomSigma,
  fallbackPostEffectPadding,
  fallbackVignetteImage,
  resolveFallbackCameraPostEffects,
} from './cameraPostEffectsFallbackState'

describe('DOM camera post-effects fallback', () => {
  it('resolves live numeric values over authored camera settings', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    api.setNodeProperty(camera.id, 'chromaticAberrationEnabled', true)
    api.setNodeProperty(camera.id, 'chromaticAberrationAmount', 4)
    api.setNodeProperty(camera.id, 'bloomEnabled', true)
    api.setNodeProperty(camera.id, 'bloomStrength', 0.8)
    api.setNodeProperty(camera.id, 'vhsEnabled', true)
    api.setNodeProperty(camera.id, 'vignetteEnabled', true)
    const authored = api.getActiveCamera()
    if (!authored) throw new Error('Expected the updated camera')

    expect(
      resolveFallbackCameraPostEffects(authored, {
        chromaticAberrationAmount: 11,
        chromaticAberrationAngle: -30,
        bloomStrength: 1.4,
        bloomRadius: 0.6,
        bloomThreshold: 0.25,
        vhsIntensity: 0.8,
        vhsNoise: 0.6,
        vhsScanlines: 0.7,
        vhsColorBleed: 5,
        vignetteAmount: 0.7,
        vignetteSize: 0.6,
        vignetteFeather: 0.2,
      }),
    ).toMatchObject({
      chromaticAberrationEnabled: true,
      chromaticAberrationAmount: 11,
      chromaticAberrationAngle: -30,
      bloomEnabled: true,
      bloomStrength: 1.4,
      bloomRadius: 0.6,
      bloomThreshold: 0.25,
      vhsEnabled: true,
      vhsIntensity: 0.8,
      vhsNoise: 0.6,
      vhsScanlines: 0.7,
      vhsColorBleed: 5,
      vignetteEnabled: true,
      vignetteAmount: 0.7,
      vignetteSize: 0.6,
      vignetteFeather: 0.2,
    })
  })

  it('returns the scene directly with no wrapper or filter when inert', () => {
    const markup = renderToStaticMarkup(
      <CameraPostEffectsFallback
        effects={normalizeCameraPostEffects({})}
        width={960}
        height={540}
      >
        <span data-scene="true">Scene</span>
      </CameraPostEffectsFallback>,
    )

    expect(markup).toBe('<span data-scene="true">Scene</span>')
    expect(markup).not.toContain('<filter')
  })

  it('splits red and blue by the full authored amount around green', () => {
    const markup = renderToStaticMarkup(
      <CameraPostEffectsFallback
        effects={normalizeCameraPostEffects({
          chromaticAberrationEnabled: true,
          chromaticAberrationAmount: 4,
          chromaticAberrationAngle: 0,
        })}
        width={960}
        height={540}
      >
        <span>Scene</span>
      </CameraPostEffectsFallback>,
    )

    expect(markup).toContain('data-camera-post-effects="chromatic"')
    expect(markup).toContain('in="hm-red" dx="4" dy="0"')
    expect(markup).toContain('in="hm-blue" dx="-4" dy="0"')
    expect(markup).toContain('result="hm-green"')
    expect(markup).not.toContain('luminanceToAlpha')
  })

  it('extends all frame edges and corners before shifting channels', () => {
    const markup = renderToStaticMarkup(
      <CameraPostEffectsFallback
        effects={normalizeCameraPostEffects({
          chromaticAberrationEnabled: true,
          chromaticAberrationAmount: 4,
          chromaticAberrationAngle: 45,
        })}
        width={320}
        height={180}
      >
        <span>Scene</span>
      </CameraPostEffectsFallback>,
    )

    expect(markup.match(/<feTile /g)).toHaveLength(8)
    expect(markup).toContain(
      'x="319" y="0" width="1" height="180" result="hm-chromatic-edge-middle-right-source"',
    )
    expect(markup).toContain(
      'in="hm-chromatic-edge-middle-right-source" x="320" y="0" width="6" height="180"',
    )
    expect(markup).toContain(
      'in="hm-chromatic-edge-top-left-source" x="-6" y="-6" width="6" height="6"',
    )
    expect(markup).toContain(
      'in="hm-chromatic-edge-bottom-right-source" x="320" y="180" width="6" height="6"',
    )
    expect(markup.match(/in="hm-chromatic-frame" type="matrix"/g)).toHaveLength(3)
    expect(markup).toContain('<feMergeNode in="hm-chromatic-frame-center"')
    expect(markup).not.toContain('<feFlood')
  })

  it('keeps edge source regions inside a one-pixel composition', () => {
    const markup = renderToStaticMarkup(
      <CameraPostEffectsFallback
        effects={normalizeCameraPostEffects({
          chromaticAberrationEnabled: true,
          chromaticAberrationAmount: 64,
        })}
        width={1}
        height={1}
      >
        <span>Scene</span>
      </CameraPostEffectsFallback>,
    )

    expect(markup.match(/x="0" y="0" width="1" height="1" result="hm-chromatic-edge-/g))
      .toHaveLength(8)
    expect(markup).toContain('width="133" height="133" result="hm-chromatic-frame"')
  })

  it('thresholds, blurs, and screen-blends highlights for bloom', () => {
    const effects = normalizeCameraPostEffects({
      bloomEnabled: true,
      bloomStrength: 0.8,
      bloomRadius: 0.35,
      bloomThreshold: 0.75,
    })
    const markup = renderToStaticMarkup(
      <CameraPostEffectsFallback effects={effects} width={960} height={540}>
        <span>Scene</span>
      </CameraPostEffectsFallback>,
    )

    expect(markup).toContain('data-camera-post-effects="bloom"')
    expect(markup).toContain('type="luminanceToAlpha"')
    expect(markup).toContain(
      `stdDeviation="${fallbackBloomSigma(effects.bloomRadius)}"`,
    )
    expect(markup).toContain('mode="screen" result="hm-bloom"')
    expect(markup).not.toContain('result="hm-red"')
    expect(markup).not.toContain('<feTile')
  })

  it('feeds bloom into chromatic aberration and reserves tail space', () => {
    const effects = normalizeCameraPostEffects({
      chromaticAberrationEnabled: true,
      chromaticAberrationAmount: 6,
      bloomEnabled: true,
      bloomStrength: 1,
      bloomRadius: 0.5,
      bloomThreshold: 0.6,
    })
    const markup = renderToStaticMarkup(
      <CameraPostEffectsFallback effects={effects} width={320} height={180}>
        <span>Scene</span>
      </CameraPostEffectsFallback>,
    )

    expect(markup).toContain(
      'data-camera-post-effects="bloom chromatic"',
    )
    expect(markup).toContain('in="hm-bloom" dx="0" dy="0"')
    expect(markup).toContain('in="hm-chromatic-frame" type="matrix"')
    expect(fallbackPostEffectPadding(effects)).toBe(
      Math.ceil(fallbackBloomSigma(0.5) * 3 + 6 + 2),
    )
  })

  it('provides a lightweight static VHS fallback without an empty SVG filter', () => {
    const markup = renderToStaticMarkup(
      <CameraPostEffectsFallback
        effects={normalizeCameraPostEffects({
          vhsEnabled: true,
          vhsIntensity: 0.8,
          vhsScanlines: 0.5,
        })}
        width={960}
        height={540}
      >
        <span>Scene</span>
      </CameraPostEffectsFallback>,
    )

    expect(markup).toContain('data-camera-post-effects="vhs"')
    expect(markup).toContain('data-vhs-fallback-scanlines="true"')
    expect(markup).toContain('saturate(')
    expect(markup).not.toContain('<filter')
    expect(markup).not.toContain('url(&quot;#hm-camera-post-')
  })

  it('multiplies a viewport-relative vignette into existing color and alpha', () => {
    const effects = normalizeCameraPostEffects({ vignetteEnabled: true })
    const markup = renderToStaticMarkup(
      <CameraPostEffectsFallback effects={effects} width={960} height={540}>
        <span>Scene</span>
      </CameraPostEffectsFallback>,
    )
    expect(markup).toContain('data-camera-post-effects="vignette"')
    expect(markup).toContain('-vignette&quot;)')
    expect(markup).toContain('width="960" height="540" preserveAspectRatio="none"')
    expect(markup).toContain('in="SourceGraphic" in2="hm-vignette-multiplier" operator="arithmetic" k1="1" k2="0" k3="0" k4="0"')
    expect(markup).not.toContain('mix-blend-mode')
    const multiplier = decodeURIComponent(fallbackVignetteImage(effects).split(',').slice(1).join(','))
    expect(multiplier).toContain(`r="${Math.SQRT2}"`)
    expect(multiplier).toContain('color-interpolation="linearRGB"')
    // All stops and the covering rectangle stay opaque: arithmetic alpha is
    // sourceAlpha * 1, including antialiased and fully transparent artwork.
    expect(multiplier).not.toContain('opacity')
    expect(multiplier).toContain('offset="0.5" stop-color="rgb(100.000000%')
    expect(multiplier).toContain('offset="1"')
  })

  it.each([{ vignetteAmount: 0 }, { vignetteSize: 1 }])(
    'skips the DOM wrapper for a neutral vignette %s',
    (neutral) => {
      const markup = renderToStaticMarkup(
        <CameraPostEffectsFallback
          effects={normalizeCameraPostEffects({ vignetteEnabled: true, ...neutral })}
          width={960}
          height={540}
        >
          <span>Scene</span>
        </CameraPostEffectsFallback>,
      )
      expect(markup).toBe('<span>Scene</span>')
    },
  )
})

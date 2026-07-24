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
    expect(markup).toContain('in="hm-bloom" type="matrix"')
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
})

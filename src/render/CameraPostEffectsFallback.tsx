// SPDX-License-Identifier: Apache-2.0

import { Fragment, useId, type ReactNode } from 'react'
import {
  cameraPostEffectsActive,
  type CameraPostEffectsState,
} from '@/render3d/postEffects'
import {
  fallbackBloomSigma,
  fallbackPostEffectPadding,
  finiteFallbackNumber,
} from './cameraPostEffectsFallbackState'

/**
 * DOM/WebGL-failure compositor for camera-wide post effects.
 *
 * The scene is rendered once. One SVG filter performs highlight extraction,
 * bloom, and RGB channel separation in the same optical order as the WebGL
 * graph (DOF is supplied by the child compositor, then Bloom, then Chromatic).
 * When both effects are inert this returns the children directly: no wrapper,
 * SVG definitions, CSS filter, or compositor layer is created.
 */
export function CameraPostEffectsFallback({
  effects,
  width,
  height,
  children,
}: {
  effects?: CameraPostEffectsState | null
  width: number
  height: number
  children: ReactNode
}) {
  const reactId = useId()
  if (!effects || !cameraPostEffectsActive(effects)) {
    return <Fragment>{children}</Fragment>
  }

  const chromaticActive =
    effects.chromaticAberrationEnabled &&
    effects.chromaticAberrationAmount > 0.001
  const bloomActive = effects.bloomEnabled && effects.bloomStrength > 0.001
  const vhsActive = effects.vhsEnabled && effects.vhsIntensity > 0.001
  const svgFilterActive = chromaticActive || bloomActive
  const filterId = `hm-camera-post-${reactId.replaceAll(':', '')}`
  const safeWidth = Math.max(1, finiteFallbackNumber(width, 1))
  const safeHeight = Math.max(1, finiteFallbackNumber(height, 1))
  const padding = fallbackPostEffectPadding(effects)
  const angle = (effects.chromaticAberrationAngle * Math.PI) / 180
  const channelDx = Math.cos(angle) * effects.chromaticAberrationAmount
  const channelDy = Math.sin(angle) * effects.chromaticAberrationAmount
  const bloomSigma = fallbackBloomSigma(effects.bloomRadius)
  const thresholdDenominator = Math.max(0.001, 1 - effects.bloomThreshold)
  const thresholdSlope = 1 / thresholdDenominator
  const thresholdIntercept = -effects.bloomThreshold / thresholdDenominator
  const bloomAlpha = Math.min(1, effects.bloomStrength)
  const bloomInput = 'SourceGraphic'
  const chromaticInput = bloomActive ? 'hm-bloom' : 'SourceGraphic'
  const activeNames = [
    bloomActive ? 'bloom' : null,
    chromaticActive ? 'chromatic' : null,
    vhsActive ? 'vhs' : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className="absolute inset-0"
      data-camera-post-effects={activeNames}
      style={{ isolation: 'isolate' }}
    >
      {svgFilterActive ? (
        <svg
          aria-hidden="true"
          focusable="false"
          width="0"
          height="0"
          className="pointer-events-none absolute"
        >
          <defs>
            <filter
              id={filterId}
              x={-padding}
              y={-padding}
              width={safeWidth + padding * 2}
              height={safeHeight + padding * 2}
              filterUnits="userSpaceOnUse"
              primitiveUnits="userSpaceOnUse"
              colorInterpolationFilters="linearRGB"
            >
            {bloomActive ? (
              <>
                <feColorMatrix
                  in={bloomInput}
                  type="luminanceToAlpha"
                  result="hm-bloom-luminance"
                />
                <feComponentTransfer
                  in="hm-bloom-luminance"
                  result="hm-bloom-threshold"
                >
                  <feFuncA
                    type="linear"
                    slope={thresholdSlope}
                    intercept={thresholdIntercept}
                  />
                </feComponentTransfer>
                <feComposite
                  in={bloomInput}
                  in2="hm-bloom-threshold"
                  operator="in"
                  result="hm-bloom-highlights"
                />
                <feGaussianBlur
                  in="hm-bloom-highlights"
                  stdDeviation={bloomSigma}
                  result="hm-bloom-blur"
                />
                <feComponentTransfer
                  in="hm-bloom-blur"
                  result="hm-bloom-boost"
                >
                  <feFuncR type="linear" slope={effects.bloomStrength} />
                  <feFuncG type="linear" slope={effects.bloomStrength} />
                  <feFuncB type="linear" slope={effects.bloomStrength} />
                  <feFuncA type="linear" slope={bloomAlpha} />
                </feComponentTransfer>
                <feBlend
                  in={bloomInput}
                  in2="hm-bloom-boost"
                  mode="screen"
                  result="hm-bloom"
                />
              </>
            ) : null}

            {chromaticActive ? (
              <>
                <feColorMatrix
                  in={chromaticInput}
                  type="matrix"
                  values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                  result="hm-red"
                />
                <feOffset
                  in="hm-red"
                  dx={channelDx}
                  dy={channelDy}
                  result="hm-red-shift"
                />
                <feColorMatrix
                  in={chromaticInput}
                  type="matrix"
                  values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                  result="hm-green"
                />
                <feColorMatrix
                  in={chromaticInput}
                  type="matrix"
                  values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                  result="hm-blue"
                />
                <feOffset
                  in="hm-blue"
                  dx={-channelDx}
                  dy={-channelDy}
                  result="hm-blue-shift"
                />
                <feBlend
                  in="hm-red-shift"
                  in2="hm-green"
                  mode="screen"
                  result="hm-red-green"
                />
                <feBlend
                  in="hm-red-green"
                  in2="hm-blue-shift"
                  mode="screen"
                  result="hm-chromatic"
                />
              </>
            ) : null}
            </filter>
          </defs>
        </svg>
      ) : null}
      <div
        className="absolute inset-0"
        style={{
          filter: [
            svgFilterActive ? `url("#${filterId}")` : null,
            vhsActive
              ? `saturate(${1 - effects.vhsIntensity * 0.14}) contrast(${
                  1 + effects.vhsIntensity * 0.08
                })`
              : null,
          ]
            .filter(Boolean)
            .join(' '),
          transformStyle: 'preserve-3d',
          willChange: 'filter',
        }}
      >
        {children}
      </div>
      {vhsActive ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          data-vhs-fallback-scanlines="true"
          style={{
            backgroundImage:
              'repeating-linear-gradient(to bottom, transparent 0, transparent 1px, rgba(0, 0, 0, 0.55) 1px, rgba(0, 0, 0, 0.55) 2px)',
            mixBlendMode: 'multiply',
            opacity:
              effects.vhsIntensity * effects.vhsScanlines * 0.18,
          }}
        />
      ) : null}
    </div>
  )
}

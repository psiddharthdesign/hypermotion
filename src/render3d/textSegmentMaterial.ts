// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'
import {
  installDepthOfFieldShader,
  type PlaneDepthOfFieldShaderState,
  updateDepthOfFieldShader,
} from './depthOfFieldShader'

const TEXT_SEGMENT_SHADER_KEY = 'hypermotion-text-segment-v3'

type MaterialCompileHook = THREE.MeshBasicMaterial['onBeforeCompile']

interface TextSegmentShaderInstallation {
  key: string
  compile: MaterialCompileHook
}

/**
 * Adds per-segment atlas bounds, opacity, effect blur, and lens blur attributes
 * to a MeshBasicMaterial while retaining Hyper Motion's depth-of-field shader.
 *
 * Every vertex in a segment quad must provide:
 * - `hmOpacity`: segment opacity in the range 0...1.
 * - `hmEffectBlur`: authored text-effect blur in screen pixels.
 * - `hmDofBlur`: lens blur for the segment's current world depth, in pixels.
 * - `hmUvBounds`: atlas cell bounds as minU, minV, maxU, maxV.
 */
export function installTextSegmentMaterialShader(
  material: THREE.MeshBasicMaterial,
): void {
  const current = material.userData
    .hyperMotionTextSegmentShader as TextSegmentShaderInstallation | undefined
  if (
    current?.key === TEXT_SEGMENT_SHADER_KEY &&
    current.compile === material.onBeforeCompile
  ) {
    return
  }

  if (current) {
    // HMR can update this injector while an existing material still owns the
    // previous wrapper. Re-wrapping that hook duplicates attributes/varyings
    // and fails shader compilation, so rebuild the clean DOF base first.
    delete material.userData.hyperMotionTextSegmentShader
    delete material.userData.hyperMotionDofShaderKey
    delete material.userData.hyperMotionDofUniforms
    material.onBeforeCompile = () => {}
    material.customProgramCacheKey = () => material.type
  }
  installDepthOfFieldShader(material)

  const compileDepthOfField = material.onBeforeCompile
  const depthOfFieldCacheKey = material.customProgramCacheKey
  const compile: MaterialCompileHook = (shader, renderer) => {
    compileDepthOfField(shader, renderer)
    injectTextSegmentShader(shader)
  }

  material.onBeforeCompile = compile
  material.customProgramCacheKey = () =>
    `${depthOfFieldCacheKey.call(material)}:${TEXT_SEGMENT_SHADER_KEY}`
  material.userData.hyperMotionTextSegmentShader = {
    key: TEXT_SEGMENT_SHADER_KEY,
    compile,
  } satisfies TextSegmentShaderInstallation
  material.needsUpdate = true
}

/**
 * Updates the shared camera/focus/kernel uniforms used by a batched segment
 * material, then ensures the per-segment shader layer is installed. Set
 * `blurPx` to the greatest lens blur carried by the batch so the shared DOF
 * enabled flag represents every segment; individual radii come from the
 * `hmDofBlur` geometry attribute.
 */
export function updateTextSegmentMaterialShader(
  material: THREE.MeshBasicMaterial,
  state: PlaneDepthOfFieldShaderState,
): void {
  installTextSegmentMaterialShader(material)
  updateDepthOfFieldShader(material, state)
}

function injectTextSegmentShader(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = injectDeclarations(
    shader.vertexShader,
    `attribute float hmOpacity;
attribute float hmEffectBlur;
attribute float hmDofBlur;
attribute vec4 hmUvBounds;
varying float vHmOpacity;
varying float vHmEffectBlur;
varying float vHmDofBlur;
varying vec4 vHmUvBounds;`,
  ).replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
vHmOpacity = hmOpacity;
vHmEffectBlur = hmEffectBlur;
vHmDofBlur = hmDofBlur;
vHmUvBounds = hmUvBounds;`,
  )

  shader.fragmentShader = injectDeclarations(
    shader.fragmentShader,
    `varying float vHmOpacity;
varying float vHmEffectBlur;
varying float vHmDofBlur;
varying vec4 vHmUvBounds;`,
  )
    .replace(
      'float hmLocalBlur = mix( hmDofMinBlur, hmDofBlur, hmFocusBlend );',
      `float hmEffectBlur = max( vHmEffectBlur, 0.0 );
  float hmLensBlur = hmDofEnabled > 0.5
    ? mix(
        hmDofMinBlur,
        max( vHmDofBlur, hmDofMinBlur ),
        hmFocusBlend
      )
    : 0.0;
  float hmLocalBlur = max( hmEffectBlur, hmLensBlur );`,
    )
    .replace(
      'float hmKernelBlur = hmLocalBlur;',
      `float hmKernelBlur = hmLensBlur > 0.05 ? hmLensBlur : hmEffectBlur;
  float hmCombinedSampleCount = hmSampleCount < 7.0
    ? 12.0
    : hmSampleCount < 12.0
      ? 24.0
      : min( 48.0, ceil( hmSampleCount / 12.0 ) * 12.0 );
  float hmActiveSampleCount = hmLensBlur > 0.05
    ? ( hmEffectBlur > 0.05 ? hmCombinedSampleCount : hmSampleCount )
    : 12.0;`,
    )
    .replace(
      'if ( hmDofEnabled > 0.5 && hmKernelBlur > 0.05 && hmSampleCount > 0.5 ) {',
      'if ( hmLocalBlur > 0.05 && hmActiveSampleCount > 0.5 ) {',
    )
    .replace(
      'float hmKernelRadiusPx = hmKernelBlur * max(hmScreenPixelRatio, 0.001);',
      `float hmLensRadiusPx = hmLensBlur * max(hmScreenPixelRatio, 0.001);
    float hmEffectRadiusPx = hmEffectBlur * max(hmScreenPixelRatio, 0.001);
    float hmKernelRadiusPx = max( hmLensRadiusPx, hmEffectRadiusPx );`,
    )
    .replace(
      'sqrt(max(hmSampleCount, 1.0));',
      'sqrt(max(hmActiveSampleCount, 1.0));',
    )
    .replace(
      `float hmSampleSpacing =
      hmKernelRadiusPx * hmApertureStretch /
      sqrt(max(hmActiveSampleCount, 1.0));`,
      `float hmSampleSpacing = hmLensBlur > 0.05
      ? hmLensRadiusPx * hmApertureStretch /
        sqrt(max(hmActiveSampleCount, 1.0))
      : hmEffectRadiusPx / sqrt(12.0);`,
    )
    .replace(
      'if ( float( hmIndex ) < hmSampleCount ) {',
      'if ( float( hmIndex ) < hmActiveSampleCount ) {',
    )
    .replace(
      'vec2 hmScreenOffset = hmDofKernel[hmIndex] * hmKernelRadiusPx;',
      `float hmEffectIndex = mod( float( hmIndex ), 12.0 );
        vec2 hmEffectOffset = vec2( 0.18, 0.0 );
        if ( hmEffectIndex > 0.5 && hmEffectIndex < 1.5 ) {
          hmEffectOffset = vec2( -0.18, 0.0 );
        } else if ( hmEffectIndex < 2.5 ) {
          hmEffectOffset = vec2( 0.0, 0.35 );
        } else if ( hmEffectIndex < 3.5 ) {
          hmEffectOffset = vec2( 0.0, -0.35 );
        } else if ( hmEffectIndex < 4.5 ) {
          hmEffectOffset = vec2( 0.38, 0.38 );
        } else if ( hmEffectIndex < 5.5 ) {
          hmEffectOffset = vec2( -0.38, -0.38 );
        } else if ( hmEffectIndex < 6.5 ) {
          hmEffectOffset = vec2( -0.55, 0.55 );
        } else if ( hmEffectIndex < 7.5 ) {
          hmEffectOffset = vec2( 0.55, -0.55 );
        } else if ( hmEffectIndex < 8.5 ) {
          hmEffectOffset = vec2( 0.78, 0.18 );
        } else if ( hmEffectIndex < 9.5 ) {
          hmEffectOffset = vec2( -0.78, -0.18 );
        } else if ( hmEffectIndex < 10.5 ) {
          hmEffectOffset = vec2( -0.3, 0.95 );
        } else {
          hmEffectOffset = vec2( 0.3, -0.95 );
        }
        int hmLensIndex = hmEffectBlur > 0.05
          ? int( floor(
              float( hmIndex ) * hmSampleCount /
              max( hmActiveSampleCount, 1.0 )
            ) )
          : hmIndex;
        vec2 hmScreenOffset =
          hmDofKernel[hmLensIndex] * hmLensRadiusPx +
          hmEffectOffset * hmEffectRadiusPx;`,
    )
    .replace(
      `float hmInside =
          step(0.0, hmRawUv.x) * step(hmRawUv.x, 1.0) *
          step(0.0, hmRawUv.y) * step(hmRawUv.y, 1.0);
        vec2 hmUv = clamp(hmRawUv, vec2( 0.0 ), vec2( 1.0 ));`,
      `float hmInside =
          step(vHmUvBounds.x, hmRawUv.x) *
          step(hmRawUv.x, vHmUvBounds.z) *
          step(vHmUvBounds.y, hmRawUv.y) *
          step(hmRawUv.y, vHmUvBounds.w);
        vec2 hmUv = clamp(
          hmRawUv,
          vHmUvBounds.xy,
          vHmUvBounds.zw
        );`,
    )
    .replace(
      `vec4 hmTap = texture2DGradEXT(
          map,
          hmUv,
          hmUvDx * hmGradientScale,
          hmUvDy * hmGradientScale
        );
        hmTap *= hmInside;`,
      `vec4 hmTap;
        if ( hmActiveSampleCount < 16.0 && hmSampleSpacing > 0.75 ) {
          // Whole-atlas mipmaps blend neighboring cells before UV clamping.
          // A bounded 2x2 screen-space prefilter gives sparse realtime
          // aperture taps continuous coverage while remaining cell-safe.
          float hmPrefilterCapPx = hmEffectBlur > 0.05
            ? max( 6.0, hmEffectRadiusPx * 0.2 )
            : 2.0;
          float hmPrefilterRadiusPx = min(
            hmPrefilterCapPx,
            max( 0.5, hmSampleSpacing * 0.6 )
          );
          vec2 hmPrefilterX = hmUvDx * hmPrefilterRadiusPx;
          vec2 hmPrefilterY = hmUvDy * hmPrefilterRadiusPx;
          vec2 hmRawA = hmRawUv - hmPrefilterX - hmPrefilterY;
          vec2 hmRawB = hmRawUv + hmPrefilterX - hmPrefilterY;
          vec2 hmRawC = hmRawUv - hmPrefilterX + hmPrefilterY;
          vec2 hmRawD = hmRawUv + hmPrefilterX + hmPrefilterY;
          float hmInsideA =
            step(vHmUvBounds.x, hmRawA.x) *
            step(hmRawA.x, vHmUvBounds.z) *
            step(vHmUvBounds.y, hmRawA.y) *
            step(hmRawA.y, vHmUvBounds.w);
          float hmInsideB =
            step(vHmUvBounds.x, hmRawB.x) *
            step(hmRawB.x, vHmUvBounds.z) *
            step(vHmUvBounds.y, hmRawB.y) *
            step(hmRawB.y, vHmUvBounds.w);
          float hmInsideC =
            step(vHmUvBounds.x, hmRawC.x) *
            step(hmRawC.x, vHmUvBounds.z) *
            step(vHmUvBounds.y, hmRawC.y) *
            step(hmRawC.y, vHmUvBounds.w);
          float hmInsideD =
            step(vHmUvBounds.x, hmRawD.x) *
            step(hmRawD.x, vHmUvBounds.z) *
            step(vHmUvBounds.y, hmRawD.y) *
            step(hmRawD.y, vHmUvBounds.w);
          vec4 hmSampleA = texture2D(
              map,
              clamp(hmRawA, vHmUvBounds.xy, vHmUvBounds.zw)
            ) * hmInsideA;
          vec4 hmSampleB = texture2D(
              map,
              clamp(hmRawB, vHmUvBounds.xy, vHmUvBounds.zw)
            ) * hmInsideB;
          vec4 hmSampleC = texture2D(
              map,
              clamp(hmRawC, vHmUvBounds.xy, vHmUvBounds.zw)
            ) * hmInsideC;
          vec4 hmSampleD = texture2D(
              map,
              clamp(hmRawD, vHmUvBounds.xy, vHmUvBounds.zw)
            ) * hmInsideD;
          float hmPrefilterAlpha =
            hmSampleA.a + hmSampleB.a + hmSampleC.a + hmSampleD.a;
          vec3 hmPrefilterPremultiplied =
            hmSampleA.rgb * hmSampleA.a +
            hmSampleB.rgb * hmSampleB.a +
            hmSampleC.rgb * hmSampleC.a +
            hmSampleD.rgb * hmSampleD.a;
          hmTap = vec4(
            hmPrefilterPremultiplied / max(hmPrefilterAlpha, 0.00001),
            hmPrefilterAlpha * 0.25
          );
        } else {
          hmTap = texture2D( map, hmUv ) * hmInside;
        }`,
    )
    .replace(
      `diffuseColor *= sampledDiffuseColor;

#endif`,
      `diffuseColor *= sampledDiffuseColor;

#endif

diffuseColor.a *= clamp( vHmOpacity, 0.0, 1.0 );`,
    )
}

function injectDeclarations(source: string, declarations: string): string {
  const marker = '#include <common>'
  if (source.includes(marker)) {
    return source.replace(marker, `${marker}\n${declarations}`)
  }
  return `${declarations}\n${source}`
}

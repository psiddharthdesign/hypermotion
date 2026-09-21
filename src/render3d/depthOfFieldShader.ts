// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'

export const MAX_DOF_KERNEL_SAMPLES = 48
/** Fixed shader budget for local + inherited Bend modifier composition. */
export const MAX_BEND_DEFORMERS = 8

export type DofPreviewQuality = 'draft' | 'balanced' | 'high'

export interface DofSampleBudgetContext {
  playing: boolean
  interactive: boolean
  finalRender: boolean
}

export interface PlaneDepthOfFieldShaderState {
  clipMap?: boolean
  enabled: boolean
  blurPx: number
  minimumBlurPx: number
  planeWidth: number
  planeHeight: number
  focusMask: boolean
  focusX: number
  focusY: number
  focusRadius: number
  focusFalloff: number
  /** Drawing-buffer pixels per composition pixel. */
  screenPixelRatio: number
  sampleCount: number
  bladeCount: number
  bladeRotation: number
  bokehRatio: number
  /** Ordered local-to-outer Bend modifiers applied by the vertex shader. */
  bends?: readonly PlaneBendShaderState[]
  /** @deprecated Single-Bend compatibility for non-compositor callers. */
  bend?: PlaneBendShaderState | null
}

export interface PlaneBendShaderState {
  enabled: boolean
  angle: number
  factor: number
  bothDirections: boolean
  limitToRegion: boolean
  captureDirection: { x: number; y: number; z: number }
  captureRotation: number
  upDirection: { x: number; y: number; z: number }
  upRotation: number
  bendRotation: number
  captureOrigin: { x: number; y: number; z: number }
  resolvedLength: number
  surfaceShading: boolean
  lightAzimuth: number
  lightElevation: number
  ambient: number
  diffuse: number
  specular: number
  roughness: number
}

interface DofShaderUniforms {
  hmClipMap: { value: number }
  hmDofEnabled: { value: number }
  hmDofBlur: { value: number }
  hmDofMinBlur: { value: number }
  hmPlaneSize: { value: THREE.Vector2 }
  hmFocusMask: { value: number }
  hmFocusCenter: { value: THREE.Vector2 }
  hmFocusRadius: { value: number }
  hmFocusFalloff: { value: number }
  hmScreenPixelRatio: { value: number }
  hmSampleCount: { value: number }
  hmApertureStretch: { value: number }
  hmDofKernel: { value: THREE.Vector2[] }
  hmBendCount: { value: number }
  hmBendEnabled: { value: number[] }
  hmBendAngle: { value: number[] }
  hmBendFactor: { value: number[] }
  hmBendBothDirections: { value: number[] }
  hmBendLimitToRegion: { value: number[] }
  hmBendCaptureDirection: { value: THREE.Vector3[] }
  hmBendCaptureRotation: { value: number[] }
  hmBendUpDirection: { value: THREE.Vector3[] }
  hmBendUpRotation: { value: number[] }
  hmBendRotation: { value: number[] }
  hmBendCaptureOrigin: { value: THREE.Vector3[] }
  hmBendCaptureLength: { value: number[] }
  hmBendSurfaceShading: { value: number }
  hmBendLightDirection: { value: THREE.Vector3 }
  hmBendAmbient: { value: number }
  hmBendDiffuse: { value: number }
  hmBendSpecular: { value: number }
  hmBendRoughness: { value: number }
}

const DOF_SHADER_KEY = 'hypermotion-gpu-dof-bend-stack-v15'
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const kernelCache = new Map<string, THREE.Vector2[]>()

/**
 * Bound interactive work independently of the authored/final quality.
 * Timeline and camera gestures always use the realtime budget; paused preview
 * and export can spend progressively more samples without changing the scene.
 */
export function depthOfFieldSampleCount(
  previewQuality: DofPreviewQuality,
  blurQuality: number,
  context: DofSampleBudgetContext,
): number {
  if (context.playing || context.interactive) {
    if (context.playing) {
      // Motion clarity wins while the clock is advancing. Paused preview and
      // export immediately restore their larger authored-quality budgets.
      return previewQuality === 'high'
        ? 6
        : previewQuality === 'balanced'
          ? 4
          : 3
    }
    return previewQuality === 'high'
      ? 12
      : previewQuality === 'balanced'
        ? 8
        : 6
  }
  if (context.finalRender) {
    // Final output must never fall below the Balanced paused-preview budget.
    // Older scenes may still carry the legacy default (8), so enforce the
    // effective floor here instead of relying only on newly-authored values.
    return clampInt(Math.round(blurQuality), 24, MAX_DOF_KERNEL_SAMPLES)
  }
  switch (previewQuality) {
    case 'draft':
      return 6
    case 'high':
      return 48
    default:
      return 24
  }
}

/**
 * Deterministic Vogel-disc samples shaped by a regular aperture polygon.
 * Kernel generation happens on the CPU only when lens-shape controls change;
 * the fragment shader receives ready-to-use offsets and avoids per-pixel trig.
 */
export function createApertureKernel(
  sampleCount: number,
  bladeCount: number,
  rotationDegrees: number,
  bokehRatio: number,
): Array<{ x: number; y: number }> {
  const count = clampInt(sampleCount, 1, MAX_DOF_KERNEL_SAMPLES)
  const blades = clampInt(bladeCount, 3, 16)
  const ratio = clamp(bokehRatio, 0.25, 4)
  const ratioX = Math.sqrt(ratio)
  const ratioY = 1 / ratioX
  const rotation = THREE.MathUtils.degToRad(rotationDegrees)
  const sector = (Math.PI * 2) / blades
  const polygonNumerator = Math.cos(Math.PI / blades)

  const samples = Array.from({ length: count }, (_, index) => {
    const angle = index * GOLDEN_ANGLE + rotation
    const radius = Math.sqrt((index + 0.5) / count)
    const wrapped = positiveModulo(angle + sector / 2, sector) - sector / 2
    const polygonRadius = polygonNumerator / Math.max(0.001, Math.cos(wrapped))
    const shapedRadius = radius * polygonRadius
    return {
      x: Math.cos(angle) * shapedRadius * ratioX,
      y: Math.sin(angle) * shapedRadius * ratioY,
    }
  })
  // Sample budgets change between playback and paused preview. Recenter every
  // budget so the convolution never nudges the image when that switch occurs.
  const centroid = samples.reduce(
    (sum, sample) => ({ x: sum.x + sample.x, y: sum.y + sample.y }),
    { x: 0, y: 0 },
  )
  centroid.x /= samples.length
  centroid.y /= samples.length
  return samples.map((sample) => ({
    x: sample.x - centroid.x,
    y: sample.y - centroid.y,
  }))
}

export function installDepthOfFieldShader(material: THREE.MeshBasicMaterial) {
  const installedUniforms = material.userData.hyperMotionDofUniforms
  if (
    material.userData.hyperMotionDofShaderKey === DOF_SHADER_KEY &&
    hasCurrentUniformSchema(installedUniforms)
  ) {
    return
  }
  const uniforms: DofShaderUniforms = {
    hmClipMap: { value: 0 },
    hmDofEnabled: { value: 0 },
    hmDofBlur: { value: 0 },
    hmDofMinBlur: { value: 0 },
    hmPlaneSize: { value: new THREE.Vector2(1, 1) },
    hmFocusMask: { value: 0 },
    hmFocusCenter: { value: new THREE.Vector2(0.5, 0.5) },
    hmFocusRadius: { value: 0 },
    hmFocusFalloff: { value: 1 },
    hmScreenPixelRatio: { value: 1 },
    hmSampleCount: { value: 1 },
    hmApertureStretch: { value: 1 },
    hmDofKernel: {
      value: apertureKernelVectors(7, 0, 1, 1),
    },
    hmBendCount: { value: 0 },
    hmBendEnabled: { value: bendNumberArray(0) },
    hmBendAngle: { value: bendNumberArray(0) },
    hmBendFactor: { value: bendNumberArray(1) },
    hmBendBothDirections: { value: bendNumberArray(0) },
    hmBendLimitToRegion: { value: bendNumberArray(1) },
    hmBendCaptureDirection: {
      value: bendVectorArray(() => new THREE.Vector3(1, 0, 0)),
    },
    hmBendCaptureRotation: { value: bendNumberArray(0) },
    hmBendUpDirection: {
      value: bendVectorArray(() => new THREE.Vector3(0, 0, 1)),
    },
    hmBendUpRotation: { value: bendNumberArray(0) },
    hmBendRotation: { value: bendNumberArray(0) },
    hmBendCaptureOrigin: {
      value: bendVectorArray(() => new THREE.Vector3()),
    },
    hmBendCaptureLength: { value: bendNumberArray(1) },
    hmBendSurfaceShading: { value: 0 },
    hmBendLightDirection: {
      value: bendLightDirection(135, 55),
    },
    hmBendAmbient: { value: 0.82 },
    hmBendDiffuse: { value: 0.28 },
    hmBendSpecular: { value: 0.12 },
    hmBendRoughness: { value: 0.62 },
  }
  material.userData.hyperMotionDofShaderKey = DOF_SHADER_KEY
  material.userData.hyperMotionDofUniforms = uniforms
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `${BEND_VERTEX_DECLARATIONS}\nvoid main() {`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\ntransformed = hmApplyBendStack(transformed);`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>\nhmBentViewPosition = mvPosition.xyz;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_pars_fragment>',
        `#include <map_pars_fragment>

uniform float hmDofEnabled;
uniform float hmClipMap;
uniform float hmDofBlur;
uniform float hmDofMinBlur;
uniform vec2 hmPlaneSize;
uniform float hmFocusMask;
uniform vec2 hmFocusCenter;
uniform float hmFocusRadius;
uniform float hmFocusFalloff;
uniform float hmScreenPixelRatio;
uniform float hmSampleCount;
uniform float hmApertureStretch;
uniform vec2 hmDofKernel[${MAX_DOF_KERNEL_SAMPLES}];
uniform float hmBendSurfaceShading;
uniform vec3 hmBendLightDirection;
uniform float hmBendAmbient;
uniform float hmBendDiffuse;
uniform float hmBendSpecular;
uniform float hmBendRoughness;
varying vec3 hmBentViewPosition;`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP

  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  float hmFocusBlend = 1.0;
  if ( hmFocusMask > 0.5 ) {
    // Point focus is authored in composition pixels and must stay circular in
    // camera space. Measuring it in plane UVs sheared the mask on tilted cards.
    vec2 hmFragmentPosition = gl_FragCoord.xy / max(hmScreenPixelRatio, 0.001);
    vec2 hmFocusDelta = hmFragmentPosition - hmFocusCenter;
    hmFocusBlend = smoothstep(
      hmFocusRadius,
      hmFocusRadius + max( hmFocusFalloff, 0.001 ),
      length( hmFocusDelta )
    );
  }

  float hmLocalBlur = mix( hmDofMinBlur, hmDofBlur, hmFocusBlend );
  // Circle of confusion grows continuously across the authored falloff: zero
  // inside the sharp radius, progressively wider through the transition, and
  // equal to Max Blur beyond the outer radius.
  float hmKernelBlur = hmLocalBlur;
  // Derivatives must be evaluated in uniform control flow. hmKernelBlur varies
  // across the focus falloff, so computing them inside the blur branch leaves
  // results undefined at the sharp/blur boundary on some GPUs.
  vec2 hmUvDx = dFdx(vMapUv);
  vec2 hmUvDy = dFdy(vMapUv);
  if ( hmDofEnabled > 0.5 && hmKernelBlur > 0.05 && hmSampleCount > 0.5 ) {
    // The authored sample count is the whole aperture kernel. Keeping an
    // additional unblurred texel here left a visible sharp copy in the middle
    // of defocused text, particularly in the six-sample playback budget.
    vec3 hmPremultiplied = vec3( 0.0 );
    float hmAlpha = 0.0;
    float hmWeight = 0.0;
    float hmKernelRadiusPx = hmKernelBlur * max(hmScreenPixelRatio, 0.001);
    // Approximate the continuous aperture area represented by every discrete
    // tap. Sparse realtime kernels receive a wider prefilter than 48-tap still
    // previews, closing the gaps that otherwise appear as repeated glyphs.
    float hmSampleSpacing =
      hmKernelRadiusPx * hmApertureStretch /
      sqrt(max(hmSampleCount, 1.0));
    float hmMipBias = clamp(
      log2(max(1.0, hmSampleSpacing)) + 0.75,
      0.0,
      6.0
    );
    float hmGradientScale = exp2(hmMipBias);
    for ( int hmIndex = 0; hmIndex < ${MAX_DOF_KERNEL_SAMPLES}; hmIndex ++ ) {
      if ( float( hmIndex ) < hmSampleCount ) {
        vec2 hmScreenOffset = hmDofKernel[hmIndex] * hmKernelRadiusPx;
        // Convert camera/screen-pixel aperture offsets into this fragment's UV
        // basis. The lens shape now stays stable under plane tilt/perspective.
        vec2 hmRawUv = vMapUv +
          hmUvDx * hmScreenOffset.x +
          hmUvDy * hmScreenOffset.y;
        float hmInside =
          step(0.0, hmRawUv.x) * step(hmRawUv.x, 1.0) *
          step(0.0, hmRawUv.y) * step(hmRawUv.y, 1.0);
        vec2 hmUv = clamp(hmRawUv, vec2( 0.0 ), vec2( 1.0 ));
        vec4 hmTap = texture2DGradEXT(
          map,
          hmUv,
          hmUvDx * hmGradientScale,
          hmUvDy * hmGradientScale
        );
        hmTap *= hmInside;
        hmPremultiplied += hmTap.rgb * hmTap.a;
        hmAlpha += hmTap.a;
        hmWeight += 1.0;
      }
    }
    sampledDiffuseColor = vec4(
      hmPremultiplied / max( hmAlpha, 0.00001 ),
      hmAlpha / hmWeight
    );
  }

  #ifdef DECODE_VIDEO_TEXTURE
    sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
  #endif

  if ( hmBendSurfaceShading > 0.5 && sampledDiffuseColor.a > 0.0001 ) {
    // Reconstruct the deformed surface normal from adjacent camera-space
    // fragments. This follows the actual bent tessellation, including its
    // animated capture axes, without maintaining a second normal formula.
    vec3 hmSurfaceDx = dFdx( hmBentViewPosition );
    vec3 hmSurfaceDy = dFdy( hmBentViewPosition );
    vec3 hmSurfaceNormalRaw = cross( hmSurfaceDx, hmSurfaceDy );
    float hmSurfaceNormalLength = length( hmSurfaceNormalRaw );
    vec3 hmSurfaceNormal = hmSurfaceNormalLength > 0.00001
      ? hmSurfaceNormalRaw / hmSurfaceNormalLength
      : vec3( 0.0, 0.0, 1.0 );
    if ( hmSurfaceNormal.z < 0.0 ) hmSurfaceNormal *= -1.0;
    vec3 hmViewDirection = normalize( -hmBentViewPosition );
    vec3 hmLightDirection = normalize( hmBendLightDirection );
    float hmLambert = max( dot( hmSurfaceNormal, hmLightDirection ), 0.0 );
    vec3 hmHalfDirection = normalize( hmLightDirection + hmViewDirection );
    float hmHighlightPower = mix( 128.0, 6.0, hmBendRoughness );
    float hmHighlight = pow(
      max( dot( hmSurfaceNormal, hmHalfDirection ), 0.0 ),
      hmHighlightPower
    );
    float hmLighting = max( 0.0, hmBendAmbient + hmBendDiffuse * hmLambert );
    sampledDiffuseColor.rgb =
      sampledDiffuseColor.rgb * hmLighting +
      vec3( hmBendSpecular * hmHighlight * sampledDiffuseColor.a );
  }

  // Clip after derivative-based sampling so neighboring fragments stay valid.
  if (hmClipMap > 0.5 && (any(lessThan(vMapUv, vec2(0.0))) || any(greaterThan(vMapUv, vec2(1.0))))) discard;
  diffuseColor *= sampledDiffuseColor;

#endif`,
      )
  }
  material.customProgramCacheKey = () => DOF_SHADER_KEY
  material.needsUpdate = true
}

function hasCurrentUniformSchema(value: unknown): value is DofShaderUniforms {
  if (!value || typeof value !== 'object') return false
  const uniforms = value as Partial<Record<keyof DofShaderUniforms, unknown>>
  return [
    'hmClipMap',
    'hmDofEnabled',
    'hmDofBlur',
    'hmDofMinBlur',
    'hmPlaneSize',
    'hmFocusMask',
    'hmFocusCenter',
    'hmFocusRadius',
    'hmFocusFalloff',
    'hmScreenPixelRatio',
    'hmSampleCount',
    'hmApertureStretch',
    'hmDofKernel',
    'hmBendCount',
    'hmBendEnabled',
    'hmBendAngle',
    'hmBendFactor',
    'hmBendBothDirections',
    'hmBendLimitToRegion',
    'hmBendCaptureDirection',
    'hmBendCaptureRotation',
    'hmBendUpDirection',
    'hmBendUpRotation',
    'hmBendRotation',
    'hmBendCaptureOrigin',
    'hmBendCaptureLength',
    'hmBendSurfaceShading',
    'hmBendLightDirection',
    'hmBendAmbient',
    'hmBendDiffuse',
    'hmBendSpecular',
    'hmBendRoughness',
  ].every((key) => uniforms[key as keyof DofShaderUniforms] != null)
}

export function updateDepthOfFieldShader(
  material: THREE.MeshBasicMaterial,
  state: PlaneDepthOfFieldShaderState,
) {
  installDepthOfFieldShader(material)
  const uniforms = material.userData.hyperMotionDofUniforms as DofShaderUniforms
  uniforms.hmDofEnabled.value = state.enabled && state.blurPx > 0.05 ? 1 : 0
  uniforms.hmClipMap.value = state.clipMap ? 1 : 0
  uniforms.hmDofBlur.value = Math.max(0, state.blurPx)
  uniforms.hmDofMinBlur.value = Math.max(
    0,
    Math.min(state.blurPx, state.minimumBlurPx),
  )
  uniforms.hmPlaneSize.value.set(
    Math.max(1, state.planeWidth),
    Math.max(1, state.planeHeight),
  )
  uniforms.hmFocusMask.value = state.focusMask ? 1 : 0
  uniforms.hmFocusCenter.value.set(
    state.focusX,
    state.focusY,
  )
  uniforms.hmFocusRadius.value = Math.max(0, state.focusRadius)
  uniforms.hmFocusFalloff.value = Math.max(0.001, state.focusFalloff)
  uniforms.hmScreenPixelRatio.value = Math.max(0.001, state.screenPixelRatio)
  const sampleCount = clampInt(
    state.sampleCount,
    1,
    MAX_DOF_KERNEL_SAMPLES,
  )
  uniforms.hmSampleCount.value = sampleCount
  const safeBokehRatio = clamp(state.bokehRatio, 0.25, 4)
  uniforms.hmApertureStretch.value = Math.max(
    Math.sqrt(safeBokehRatio),
    1 / Math.sqrt(safeBokehRatio),
  )
  uniforms.hmDofKernel.value = apertureKernelVectors(
    state.bladeCount,
    state.bladeRotation,
    state.bokehRatio,
    sampleCount,
  )
  const bends = (
    state.bends ?? (state.bend ? [state.bend] : [])
  ).slice(0, MAX_BEND_DEFORMERS)
  uniforms.hmBendCount.value = bends.length
  for (let index = 0; index < MAX_BEND_DEFORMERS; index += 1) {
    const bend = bends[index]
    uniforms.hmBendEnabled.value[index] = bend?.enabled ? 1 : 0
    uniforms.hmBendAngle.value[index] = THREE.MathUtils.degToRad(
      bend?.angle ?? 0,
    )
    uniforms.hmBendFactor.value[index] = clamp(bend?.factor ?? 0, 0, 1)
    uniforms.hmBendBothDirections.value[index] = bend?.bothDirections ? 1 : 0
    uniforms.hmBendLimitToRegion.value[index] = bend?.limitToRegion ? 1 : 0
    uniforms.hmBendCaptureDirection.value[index]!.set(
      bend?.captureDirection.x ?? 1,
      bend?.captureDirection.y ?? 0,
      bend?.captureDirection.z ?? 0,
    )
    uniforms.hmBendCaptureRotation.value[index] = THREE.MathUtils.degToRad(
      bend?.captureRotation ?? 0,
    )
    uniforms.hmBendUpDirection.value[index]!.set(
      bend?.upDirection.x ?? 0,
      bend?.upDirection.y ?? 0,
      bend?.upDirection.z ?? 1,
    )
    uniforms.hmBendUpRotation.value[index] = THREE.MathUtils.degToRad(
      bend?.upRotation ?? 0,
    )
    uniforms.hmBendRotation.value[index] = THREE.MathUtils.degToRad(
      bend?.bendRotation ?? 0,
    )
    uniforms.hmBendCaptureOrigin.value[index]!.set(
      bend?.captureOrigin.x ?? 0,
      bend?.captureOrigin.y ?? 0,
      bend?.captureOrigin.z ?? 0,
    )
    uniforms.hmBendCaptureLength.value[index] = Math.max(
      0.0001,
      bend?.resolvedLength ?? 1,
    )
  }
  // The closest active Bend owns the material lighting. Geometry still runs
  // through every modifier, while a child can override its parent's shading.
  const shadingBend = bends.find(
    (bend) =>
      bend.enabled &&
      bend.surfaceShading &&
      Math.abs(bend.angle) > 0.0001 &&
      bend.factor > 0,
  )
  uniforms.hmBendSurfaceShading.value =
    shadingBend ? 1 : 0
  uniforms.hmBendLightDirection.value.copy(
    bendLightDirection(
      shadingBend?.lightAzimuth ?? 135,
      shadingBend?.lightElevation ?? 55,
    ),
  )
  uniforms.hmBendAmbient.value = clamp(shadingBend?.ambient ?? 0.82, 0, 2)
  uniforms.hmBendDiffuse.value = clamp(shadingBend?.diffuse ?? 0.28, 0, 2)
  uniforms.hmBendSpecular.value = clamp(shadingBend?.specular ?? 0.12, 0, 2)
  uniforms.hmBendRoughness.value = clamp(shadingBend?.roughness ?? 0.62, 0, 1)
}

const BEND_VERTEX_DECLARATIONS = `
#define HM_MAX_BENDS ${MAX_BEND_DEFORMERS}
uniform float hmBendCount;
uniform float hmBendEnabled[HM_MAX_BENDS];
uniform float hmBendAngle[HM_MAX_BENDS];
uniform float hmBendFactor[HM_MAX_BENDS];
uniform float hmBendBothDirections[HM_MAX_BENDS];
uniform float hmBendLimitToRegion[HM_MAX_BENDS];
uniform vec3 hmBendCaptureDirection[HM_MAX_BENDS];
uniform float hmBendCaptureRotation[HM_MAX_BENDS];
uniform vec3 hmBendUpDirection[HM_MAX_BENDS];
uniform float hmBendUpRotation[HM_MAX_BENDS];
uniform float hmBendRotation[HM_MAX_BENDS];
uniform vec3 hmBendCaptureOrigin[HM_MAX_BENDS];
uniform float hmBendCaptureLength[HM_MAX_BENDS];
varying vec3 hmBentViewPosition;

vec3 hmSafeNormalize(vec3 value, vec3 fallbackValue) {
  float magnitude = length(value);
  return magnitude > 0.00001 ? value / magnitude : fallbackValue;
}

vec3 hmRotateAroundAxis(vec3 value, vec3 axisValue, float angle) {
  vec3 axis = hmSafeNormalize(axisValue, vec3(0.0, 0.0, 1.0));
  float cosine = cos(angle);
  float sine = sin(angle);
  return value * cosine + cross(axis, value) * sine +
    axis * dot(axis, value) * (1.0 - cosine);
}

float hmSinc(float value) {
  float squared = value * value;
  if (abs(value) < 0.01) {
    return 1.0 - squared / 6.0 + squared * squared / 120.0;
  }
  return sin(value) / value;
}

float hmCosc(float value) {
  float squared = value * value;
  if (abs(value) < 0.01) {
    return value * 0.5 - value * squared / 24.0 +
      value * squared * squared / 720.0;
  }
  return (1.0 - cos(value)) / value;
}

vec2 hmBendArc(float q, float height, float start, float curvature) {
  float theta = curvature * q;
  float sine = sin(theta);
  float cosine = cos(theta);
  // Express the circular arc with sinc/cosc instead of 1 / curvature.
  // The Taylor branches remain continuous and precise as Bend settles at 0.
  return vec2(
    start + q * hmSinc(theta) - height * sine,
    q * hmCosc(theta) + height * cosine
  );
}

vec3 hmApplyBend(vec3 originalPoint, int bendIndex) {
  float enabled = hmBendEnabled[bendIndex];
  float angle = hmBendAngle[bendIndex];
  float factor = hmBendFactor[bendIndex];
  if (
    enabled < 0.5 ||
    abs(angle) < 0.000001 ||
    factor <= 0.0
  ) return originalPoint;

  vec3 localZ = vec3(0.0, 0.0, 1.0);
  vec3 capture = hmSafeNormalize(
    hmBendCaptureDirection[bendIndex],
    vec3(1.0, 0.0, 0.0)
  );
  capture = hmRotateAroundAxis(
    capture,
    localZ,
    hmBendCaptureRotation[bendIndex]
  );
  vec3 up = hmRotateAroundAxis(
    hmBendUpDirection[bendIndex],
    localZ,
    hmBendUpRotation[bendIndex]
  );
  up -= capture * dot(up, capture);
  if (length(up) < 0.00001) {
    vec3 fallbackUp = abs(capture.z) < 0.9 ? localZ : vec3(0.0, 1.0, 0.0);
    up = fallbackUp - capture * dot(fallbackUp, capture);
  }
  up = hmSafeNormalize(up, vec3(0.0, 0.0, 1.0));
  vec3 across = hmSafeNormalize(cross(capture, up), localZ);
  up = hmSafeNormalize(cross(across, capture), up);

  vec3 captureOrigin = hmBendCaptureOrigin[bendIndex];
  vec3 relative = originalPoint - captureOrigin;
  float along = dot(relative, capture);
  float height = dot(relative, up);
  float acrossAmount = dot(relative, across);
  float captureLength = max(hmBendCaptureLength[bendIndex], 0.0001);
  float start = hmBendBothDirections[bendIndex] > 0.5
    ? -captureLength * 0.5
    : 0.0;
  float q = along - start;
  float curvature = angle / captureLength;
  vec2 bent;
  if (
    hmBendLimitToRegion[bendIndex] < 0.5 ||
    (q >= 0.0 && q <= captureLength)
  ) {
    bent = hmBendArc(q, height, start, curvature);
  } else {
    float endpointQ = q < 0.0 ? 0.0 : captureLength;
    vec2 endpoint = hmBendArc(endpointQ, 0.0, start, curvature);
    float theta = curvature * endpointQ;
    vec2 tangent = vec2(cos(theta), sin(theta));
    vec2 normal = vec2(-sin(theta), cos(theta));
    float extension = q - endpointQ;
    bent = endpoint + tangent * extension + normal * height;
  }
  vec3 deformed = captureOrigin +
    capture * bent.x + up * bent.y + across * acrossAmount;
  float bendRotation = hmBendRotation[bendIndex];
  if (abs(bendRotation) > 0.000001) {
    deformed = captureOrigin + hmRotateAroundAxis(
      deformed - captureOrigin,
      capture,
      bendRotation
    );
  }
  return mix(originalPoint, deformed, clamp(factor, 0.0, 1.0));
}

vec3 hmApplyBendStack(vec3 originalPoint) {
  vec3 point = originalPoint;
  for (int index = 0; index < HM_MAX_BENDS; index++) {
    if (float(index) >= hmBendCount) break;
    point = hmApplyBend(point, index);
  }
  return point;
}
`

export function bendLightDirection(
  azimuthDegrees: number,
  elevationDegrees: number,
): THREE.Vector3 {
  const azimuth = THREE.MathUtils.degToRad(azimuthDegrees)
  const elevation = THREE.MathUtils.degToRad(
    clamp(elevationDegrees, -90, 90),
  )
  const horizontal = Math.cos(elevation)
  return new THREE.Vector3(
    horizontal * Math.cos(azimuth),
    horizontal * Math.sin(azimuth),
    Math.sin(elevation),
  ).normalize()
}

function apertureKernelVectors(
  bladeCount: number,
  rotationDegrees: number,
  bokehRatio: number,
  sampleCount: number,
): THREE.Vector2[] {
  const blades = clampInt(bladeCount, 3, 16)
  const rotation = Number(rotationDegrees.toFixed(3))
  const ratio = Number(clamp(bokehRatio, 0.25, 4).toFixed(3))
  const count = clampInt(sampleCount, 1, MAX_DOF_KERNEL_SAMPLES)
  const key = `${blades}:${rotation}:${ratio}:${count}`
  const cached = kernelCache.get(key)
  if (cached) return cached
  const vectors = createApertureKernel(
    count,
    blades,
    rotation,
    ratio,
  ).map(({ x, y }) => new THREE.Vector2(x, y))
  while (vectors.length < MAX_DOF_KERNEL_SAMPLES) {
    vectors.push(new THREE.Vector2())
  }
  kernelCache.set(key, vectors)
  return vectors
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function bendNumberArray(value: number): number[] {
  return Array.from({ length: MAX_BEND_DEFORMERS }, () => value)
}

function bendVectorArray(create: () => THREE.Vector3): THREE.Vector3[] {
  return Array.from({ length: MAX_BEND_DEFORMERS }, create)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max))
}

// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'
import type { BlendMode } from '@/scene'

const BACKDROP_BLEND_SHADER_KEY = 'hypermotion-backdrop-blend-v1'

export const BACKDROP_BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const satisfies readonly BlendMode[]

type BlendUniform = { value: number }
type TextureUniform = { value: THREE.Texture }
type VectorUniform = { value: THREE.Vector2 }

interface BackdropBlendUniforms {
  hmBlendBackdrop: TextureUniform
  hmBlendViewport: VectorUniform
  hmBlendMode: BlendUniform
  hmBlendTargetIsLinear: BlendUniform
}

interface BackdropBlendInstallation {
  key: string
  compile: THREE.MeshBasicMaterial['onBeforeCompile']
  texture: THREE.FramebufferTexture
  uniforms: BackdropBlendUniforms
}

const drawingBufferSize = new THREE.Vector2()

export function backdropBlendModeIndex(mode: BlendMode | undefined): number {
  return Math.max(0, BACKDROP_BLEND_MODES.indexOf(mode ?? 'normal'))
}

/**
 * Install a destination-aware blend stage after the material's existing map,
 * depth-of-field, output-colour, and dithering stages.
 *
 * WebGL's fixed blend factors cannot express Overlay, Soft Light, Color Dodge,
 * or the HSL-family modes because those formulas must read the destination
 * colour. The mesh copies the framebuffer immediately before it draws, then
 * this shader combines that backdrop with the Paper/layer texture.
 */
export function setBackdropBlendMode(
  material: THREE.MeshBasicMaterial,
  mode: BlendMode | undefined,
): void {
  const modeIndex = backdropBlendModeIndex(mode)
  const installation =
    modeIndex > 0 || material.userData.hyperMotionBackdropBlend
      ? installBackdropBlendShader(material)
      : null
  if (installation) installation.uniforms.hmBlendMode.value = modeIndex

  const previousMode = material.userData.hyperMotionBackdropBlendMode
  if (previousMode === modeIndex) return
  material.userData.hyperMotionBackdropBlendMode = modeIndex
  material.transparent = true
  material.premultipliedAlpha = false
  // The advanced shader already emits the source-over-composited framebuffer
  // pixel, so another fixed-function blend would apply alpha twice.
  material.blending =
    modeIndex > 0 ? THREE.NoBlending : THREE.NormalBlending
  material.needsUpdate = true
}

export function captureBackdropForMaterial(
  renderer: THREE.WebGLRenderer,
  material: THREE.MeshBasicMaterial,
): void {
  const installation = material.userData
    .hyperMotionBackdropBlend as BackdropBlendInstallation | undefined
  if (!installation || installation.uniforms.hmBlendMode.value <= 0) return

  const renderTarget = renderer.getRenderTarget()
  if (!renderTarget) renderer.getDrawingBufferSize(drawingBufferSize)
  const width = renderTarget ? renderTarget.width : drawingBufferSize.x
  const height = renderTarget ? renderTarget.height : drawingBufferSize.y
  const type = renderTarget?.texture.type ?? THREE.UnsignedByteType
  const targetColorSpace =
    renderTarget?.texture.colorSpace ?? renderer.outputColorSpace
  installation.uniforms.hmBlendTargetIsLinear.value =
    targetColorSpace === THREE.LinearSRGBColorSpace ||
    targetColorSpace === THREE.NoColorSpace
      ? 1
      : 0
  const texture = installation.texture
  const sizeChanged =
    texture.image.width !== width || texture.image.height !== height
  const typeChanged = texture.type !== type

  if (sizeChanged || typeChanged) {
    texture.dispose()
    texture.image.width = Math.max(1, width)
    texture.image.height = Math.max(1, height)
    texture.type = type
    texture.needsUpdate = true
  }
  installation.uniforms.hmBlendViewport.value.set(
    Math.max(1, width),
    Math.max(1, height),
  )
  renderer.copyFramebufferToTexture(texture)
}

export function disposeBackdropBlendMode(
  material: THREE.MeshBasicMaterial,
): void {
  const installation = material.userData
    .hyperMotionBackdropBlend as BackdropBlendInstallation | undefined
  installation?.texture.dispose()
  delete material.userData.hyperMotionBackdropBlend
  delete material.userData.hyperMotionBackdropBlendMode
}

function installBackdropBlendShader(
  material: THREE.MeshBasicMaterial,
): BackdropBlendInstallation {
  const current = material.userData
    .hyperMotionBackdropBlend as BackdropBlendInstallation | undefined
  if (
    current?.key === BACKDROP_BLEND_SHADER_KEY &&
    current.compile === material.onBeforeCompile
  ) {
    return current
  }

  const texture = new THREE.FramebufferTexture(1, 1)
  texture.name = 'Hyper Motion layer blend backdrop'
  const uniforms: BackdropBlendUniforms = {
    hmBlendBackdrop: { value: texture },
    hmBlendViewport: { value: new THREE.Vector2(1, 1) },
    hmBlendMode: { value: 0 },
    hmBlendTargetIsLinear: { value: 0 },
  }
  const compilePrevious = material.onBeforeCompile
  const previousCacheKey = material.customProgramCacheKey
  const compile: THREE.MeshBasicMaterial['onBeforeCompile'] = (
    shader,
    renderer,
  ) => {
    compilePrevious(shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = injectBackdropBlendShader(shader.fragmentShader)
  }
  const installation: BackdropBlendInstallation = {
    key: BACKDROP_BLEND_SHADER_KEY,
    compile,
    texture,
    uniforms,
  }
  current?.texture.dispose()
  material.onBeforeCompile = compile
  material.customProgramCacheKey = () =>
    `${previousCacheKey.call(material)}:${BACKDROP_BLEND_SHADER_KEY}`
  material.userData.hyperMotionBackdropBlend = installation
  material.needsUpdate = true
  return installation
}

export function injectBackdropBlendShader(fragmentShader: string): string {
  return fragmentShader
    .replace(
      '#include <common>',
      `#include <common>

uniform sampler2D hmBlendBackdrop;
uniform vec2 hmBlendViewport;
uniform float hmBlendMode;
uniform float hmBlendTargetIsLinear;

float hmBlendLum(vec3 color) {
  return dot(color, vec3(0.3, 0.59, 0.11));
}

float hmBlendSat(vec3 color) {
  return max(max(color.r, color.g), color.b) -
    min(min(color.r, color.g), color.b);
}

vec3 hmBlendClipColor(vec3 color) {
  float lum = hmBlendLum(color);
  float minimum = min(min(color.r, color.g), color.b);
  float maximum = max(max(color.r, color.g), color.b);
  if (minimum < 0.0) {
    color = vec3(lum) +
      (color - vec3(lum)) * lum / max(lum - minimum, 0.00001);
  }
  if (maximum > 1.0) {
    color = vec3(lum) +
      (color - vec3(lum)) * (1.0 - lum) /
      max(maximum - lum, 0.00001);
  }
  return clamp(color, 0.0, 1.0);
}

vec3 hmBlendSetLum(vec3 color, float lum) {
  return hmBlendClipColor(color + vec3(lum - hmBlendLum(color)));
}

vec3 hmBlendSetSat(vec3 color, float saturation) {
  float minimum = min(min(color.r, color.g), color.b);
  float maximum = max(max(color.r, color.g), color.b);
  if (maximum <= minimum + 0.00001) return vec3(0.0);
  return (color - vec3(minimum)) * saturation / (maximum - minimum);
}

float hmBlendOverlayChannel(float backdrop, float source) {
  return backdrop <= 0.5
    ? 2.0 * backdrop * source
    : 1.0 - 2.0 * (1.0 - backdrop) * (1.0 - source);
}

float hmBlendHardLightChannel(float backdrop, float source) {
  return source <= 0.5
    ? 2.0 * backdrop * source
    : 1.0 - 2.0 * (1.0 - backdrop) * (1.0 - source);
}

float hmBlendSoftLightD(float backdrop) {
  return backdrop <= 0.25
    ? ((16.0 * backdrop - 12.0) * backdrop + 4.0) * backdrop
    : sqrt(max(backdrop, 0.0));
}

float hmBlendSoftLightChannel(float backdrop, float source) {
  return source <= 0.5
    ? backdrop -
      (1.0 - 2.0 * source) * backdrop * (1.0 - backdrop)
    : backdrop +
      (2.0 * source - 1.0) * (hmBlendSoftLightD(backdrop) - backdrop);
}

vec3 hmBlendCss(vec3 backdrop, vec3 source, float mode) {
  if (mode < 1.5) return backdrop * source;
  if (mode < 2.5) return backdrop + source - backdrop * source;
  if (mode < 3.5) {
    return vec3(
      hmBlendOverlayChannel(backdrop.r, source.r),
      hmBlendOverlayChannel(backdrop.g, source.g),
      hmBlendOverlayChannel(backdrop.b, source.b)
    );
  }
  if (mode < 4.5) return min(backdrop, source);
  if (mode < 5.5) return max(backdrop, source);
  if (mode < 6.5) {
    return min(
      vec3(1.0),
      backdrop / max(vec3(0.00001), vec3(1.0) - source)
    );
  }
  if (mode < 7.5) {
    return vec3(1.0) - min(
      vec3(1.0),
      (vec3(1.0) - backdrop) / max(source, vec3(0.00001))
    );
  }
  if (mode < 8.5) {
    return vec3(
      hmBlendHardLightChannel(backdrop.r, source.r),
      hmBlendHardLightChannel(backdrop.g, source.g),
      hmBlendHardLightChannel(backdrop.b, source.b)
    );
  }
  if (mode < 9.5) {
    return vec3(
      hmBlendSoftLightChannel(backdrop.r, source.r),
      hmBlendSoftLightChannel(backdrop.g, source.g),
      hmBlendSoftLightChannel(backdrop.b, source.b)
    );
  }
  if (mode < 10.5) return abs(backdrop - source);
  if (mode < 11.5) {
    return backdrop + source - 2.0 * backdrop * source;
  }
  if (mode < 12.5) {
    return hmBlendSetLum(
      hmBlendSetSat(source, hmBlendSat(backdrop)),
      hmBlendLum(backdrop)
    );
  }
  if (mode < 13.5) {
    return hmBlendSetLum(
      hmBlendSetSat(backdrop, hmBlendSat(source)),
      hmBlendLum(backdrop)
    );
  }
  if (mode < 14.5) {
    return hmBlendSetLum(source, hmBlendLum(backdrop));
  }
  return hmBlendSetLum(backdrop, hmBlendLum(source));
}`,
    )
    .replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>

if (hmBlendMode > 0.5) {
  vec2 hmBlendUv =
    gl_FragCoord.xy / max(hmBlendViewport, vec2(1.0));
  vec4 hmBackdropPixel = texture2D(hmBlendBackdrop, hmBlendUv);
  float hmBackdropAlpha = clamp(hmBackdropPixel.a, 0.0, 1.0);
  float hmSourceAlpha = clamp(gl_FragColor.a, 0.0, 1.0);
  vec3 hmBackdropColor = hmBackdropAlpha > 0.00001
    ? hmBackdropPixel.rgb / hmBackdropAlpha
    : vec3(0.0);
  vec3 hmSourceColor = max(gl_FragColor.rgb, vec3(0.0));
  if (hmBlendTargetIsLinear > 0.5) {
    // CSS/Canvas blend modes operate in the display sRGB working space.
    // EffectComposer's half-float targets are linear, so temporarily encode
    // both straight colors for identical preview/export results.
    hmBackdropColor = sRGBTransferOETF(
      vec4(max(hmBackdropColor, vec3(0.0)), 1.0)
    ).rgb;
    hmSourceColor = sRGBTransferOETF(
      vec4(hmSourceColor, 1.0)
    ).rgb;
  }
  hmBackdropColor = clamp(hmBackdropColor, 0.0, 1.0);
  hmSourceColor = clamp(hmSourceColor, 0.0, 1.0);
  vec3 hmBlendedColor = hmBlendCss(
    hmBackdropColor,
    hmSourceColor,
    hmBlendMode
  );
  vec3 hmBlendSource =
    (1.0 - hmBackdropAlpha) * hmSourceColor +
    hmBackdropAlpha * hmBlendedColor;
  vec3 hmCompositeColor =
    hmSourceAlpha * hmBlendSource +
    (1.0 - hmSourceAlpha) * hmBackdropPixel.rgb;
  float hmCompositeAlpha =
    hmSourceAlpha + hmBackdropAlpha * (1.0 - hmSourceAlpha);
  if (hmBlendTargetIsLinear > 0.5 && hmCompositeAlpha > 0.00001) {
    vec3 hmCompositeStraight = clamp(
      hmCompositeColor / hmCompositeAlpha,
      0.0,
      1.0
    );
    hmCompositeColor = sRGBTransferEOTF(
      vec4(hmCompositeStraight, 1.0)
    ).rgb * hmCompositeAlpha;
  }
  gl_FragColor = vec4(hmCompositeColor, hmCompositeAlpha);
}`,
    )
}

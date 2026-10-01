// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { SceneBloomPass } from './SceneBloomPass'

export interface CameraPostEffectsInput {
  chromaticAberrationEnabled?: boolean
  chromaticAberrationAmount?: number
  chromaticAberrationAngle?: number
  bloomEnabled?: boolean
  bloomStrength?: number
  bloomRadius?: number
  bloomThreshold?: number
  vhsEnabled?: boolean
  vhsIntensity?: number
  vhsNoise?: number
  vhsScanlines?: number
  vhsColorBleed?: number
  vignetteEnabled?: boolean
  vignetteAmount?: number
  vignetteSize?: number
  vignetteFeather?: number
}

export interface CameraPostEffectsState {
  chromaticAberrationEnabled: boolean
  /** Per-channel offset: red/blue move +/- this many composition pixels. */
  chromaticAberrationAmount: number
  /** Channel-separation direction in degrees. */
  chromaticAberrationAngle: number
  bloomEnabled: boolean
  bloomStrength: number
  /** UnrealBloomPass radius, in the range 0...1. */
  bloomRadius: number
  /** Minimum normalized luminance that contributes to bloom. */
  bloomThreshold: number
  vhsEnabled: boolean
  /** Overall analog tape contribution, in the range 0...1. */
  vhsIntensity: number
  /** Fine luminance noise contribution, in the range 0...1. */
  vhsNoise: number
  /** Alternating horizontal scanline contrast, in the range 0...1. */
  vhsScanlines: number
  /** Horizontal red/blue channel bleed in composition pixels. */
  vhsColorBleed: number
  vignetteEnabled: boolean
  /** Edge darkening contribution, in the range 0...1. */
  vignetteAmount: number
  /** Unaffected inner radius relative to the viewport corners, 0...1. */
  vignetteSize: number
  /** Width of the smooth edge transition, in the range 0...1. */
  vignetteFeather: number
}

const EFFECT_EPSILON = 0.001
const MAX_PLAYBACK_CHROMATIC_PIXELS = 2_000_000
const MAX_PLAYBACK_BLOOM_PIXELS = 1_250_000
export const POST_EFFECTS_IDLE_QUALITY_DELAY_MS = 200

/**
 * Keep authored and animated camera values finite and inside the same ranges
 * exposed by the Inspector. This function is shared by the scene resolver and
 * focused tests so malformed/legacy documents never reach Three uniforms.
 */
export function normalizeCameraPostEffects(
  input: CameraPostEffectsInput,
): CameraPostEffectsState {
  return {
    chromaticAberrationEnabled:
      input.chromaticAberrationEnabled === true,
    chromaticAberrationAmount: clampFinite(
      input.chromaticAberrationAmount,
      0,
      64,
      4,
    ),
    chromaticAberrationAngle: clampFinite(
      input.chromaticAberrationAngle,
      -180,
      180,
      0,
    ),
    bloomEnabled: input.bloomEnabled === true,
    bloomStrength: clampFinite(input.bloomStrength, 0, 4, 0.8),
    bloomRadius: clampFinite(input.bloomRadius, 0, 1, 0.35),
    bloomThreshold: clampFinite(input.bloomThreshold, 0, 1, 0.75),
    vhsEnabled: input.vhsEnabled === true,
    vhsIntensity: clampFinite(input.vhsIntensity, 0, 1, 0.65),
    vhsNoise: clampFinite(input.vhsNoise, 0, 1, 0.35),
    vhsScanlines: clampFinite(input.vhsScanlines, 0, 1, 0.5),
    vhsColorBleed: clampFinite(input.vhsColorBleed, 0, 32, 3),
    vignetteEnabled: input.vignetteEnabled === true,
    vignetteAmount: clampFinite(input.vignetteAmount, 0, 1, 0.35),
    vignetteSize: clampFinite(input.vignetteSize, 0, 1, 0.5),
    vignetteFeather: clampFinite(input.vignetteFeather, 0, 1, 0.5),
  }
}

/** Skip both the render targets and full-screen passes for inert settings. */
export function cameraPostEffectsActive(
  effects: CameraPostEffectsState,
): boolean {
  return (
    (effects.chromaticAberrationEnabled &&
      effects.chromaticAberrationAmount > EFFECT_EPSILON) ||
    (effects.bloomEnabled && effects.bloomStrength > EFFECT_EPSILON) ||
    (effects.vhsEnabled && effects.vhsIntensity > EFFECT_EPSILON) ||
    cameraVignetteActive(effects)
  )
}

/** Resource lifetime follows authored toggles, not animated zero crossings. */
export function cameraPostEffectsEnabled(
  effects: CameraPostEffectsState,
): boolean {
  return (
    effects.chromaticAberrationEnabled ||
    effects.bloomEnabled ||
    effects.vhsEnabled ||
    effects.vignetteEnabled
  )
}

/**
 * Detect paused Inspector edits and timeline seeks that should use the
 * realtime compositor budget until the interaction settles.
 */
export function cameraPostEffectsInteractionChanged(
  previousEffects: CameraPostEffectsState,
  nextEffects: CameraPostEffectsState,
  previousPlayhead: number,
  nextPlayhead: number,
): boolean {
  return (
    previousPlayhead !== nextPlayhead ||
    previousEffects.chromaticAberrationEnabled !==
      nextEffects.chromaticAberrationEnabled ||
    previousEffects.chromaticAberrationAmount !==
      nextEffects.chromaticAberrationAmount ||
    previousEffects.chromaticAberrationAngle !==
      nextEffects.chromaticAberrationAngle ||
    previousEffects.bloomEnabled !== nextEffects.bloomEnabled ||
    previousEffects.bloomStrength !== nextEffects.bloomStrength ||
    previousEffects.bloomRadius !== nextEffects.bloomRadius ||
    previousEffects.bloomThreshold !== nextEffects.bloomThreshold ||
    previousEffects.vhsEnabled !== nextEffects.vhsEnabled ||
    previousEffects.vhsIntensity !== nextEffects.vhsIntensity ||
    previousEffects.vhsNoise !== nextEffects.vhsNoise ||
    previousEffects.vhsScanlines !== nextEffects.vhsScanlines ||
    previousEffects.vhsColorBleed !== nextEffects.vhsColorBleed ||
    previousEffects.vignetteEnabled !== nextEffects.vignetteEnabled ||
    previousEffects.vignetteAmount !== nextEffects.vignetteAmount ||
    previousEffects.vignetteSize !== nextEffects.vignetteSize ||
    previousEffects.vignetteFeather !== nextEffects.vignetteFeather
  )
}

export function cameraVignetteActive(effects: CameraPostEffectsState): boolean {
  return effects.vignetteEnabled &&
    effects.vignetteAmount > EFFECT_EPSILON &&
    effects.vignetteSize < 1
}

/** Linear RGB multiplier shared by the SVG fallback and shader contract tests. */
export function cameraVignetteMultiplier(
  radius: number,
  effects: Pick<CameraPostEffectsState, 'vignetteAmount' | 'vignetteSize' | 'vignetteFeather'>,
): number {
  const transition = Math.max(0, Math.min(1,
    (radius - effects.vignetteSize) / Math.max(effects.vignetteFeather, 0.001),
  ))
  const mask = transition * transition * (3 - 2 * transition)
  return 1 - effects.vignetteAmount * mask
}

/**
 * Small framework-agnostic idle gate. React supplies `onIdle` to request one
 * final full-quality render after rapid edits/scrubs have stopped.
 */
export class PostEffectsIdleQualityController {
  private realtime = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly onIdle: () => void
  private readonly delayMs: number

  constructor(
    onIdle: () => void,
    delayMs = POST_EFFECTS_IDLE_QUALITY_DELAY_MS,
  ) {
    this.onIdle = onIdle
    this.delayMs = delayMs
  }

  noteInteraction(): void {
    this.realtime = true
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.realtime = false
      this.onIdle()
    }, this.delayMs)
  }

  isRealtime(): boolean {
    return this.realtime
  }

  reset(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.realtime = false
  }

  dispose(): void {
    this.reset()
  }
}

/**
 * Keep continuous post-processing inside a predictable fragment budget.
 * Bloom gets the lower budget because UnrealBloomPass runs a five-level,
 * two-axis blur pyramid. Paused preview remains at the renderer's requested
 * density, and final export always bypasses this realtime policy.
 */
export function cameraPostEffectsPixelRatio({
  width,
  height,
  rendererPixelRatio,
  effects,
  realtime,
  finalRender,
}: {
  width: number
  height: number
  rendererPixelRatio: number
  effects: CameraPostEffectsState
  realtime: boolean
  finalRender: boolean
}): number {
  const safeWidth = clampFinite(width, 1, Number.MAX_SAFE_INTEGER, 1)
  const safeHeight = clampFinite(height, 1, Number.MAX_SAFE_INTEGER, 1)
  const safeRendererPixelRatio = clampFinite(rendererPixelRatio, 0.25, 4, 1)
  if (
    finalRender ||
    !realtime ||
    !cameraPostEffectsEnabled(effects)
  ) {
    return safeRendererPixelRatio
  }

  const pixelBudget = effects.bloomEnabled
    ? MAX_PLAYBACK_BLOOM_PIXELS
    : MAX_PLAYBACK_CHROMATIC_PIXELS
  const budgetPixelRatio = Math.sqrt(
    pixelBudget / (safeWidth * safeHeight),
  )
  return Math.max(
    0.25,
    Math.min(safeRendererPixelRatio, budgetPixelRatio),
  )
}

/**
 * CPU mirror of the shader's composition-pixel to UV conversion. Useful for
 * keeping resolution behavior explicit: a 4px per-channel offset stays 4
 * composition pixels at 1x, Retina preview, and 4K export.
 */
export function chromaticAberrationUvOffset(
  amountPx: number,
  angleDegrees: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const radians = THREE.MathUtils.degToRad(angleDegrees)
  return {
    x: (Math.cos(radians) * amountPx) / Math.max(1, width),
    y: (Math.sin(radians) * amountPx) / Math.max(1, height),
  }
}

/**
 * Three ShaderPass definition for a true RGB channel split. Red samples ahead
 * of the authored direction, blue behind it, and green stays centered. Alpha
 * uses the widest of the three samples so transparent artwork retains its
 * colored fringe instead of being cropped to the original silhouette. Samples
 * beyond the composition repeat its edge pixels: the camera's crop is not an
 * artwork edge and must not lose a color channel when the split crosses it.
 */
export const CHROMATIC_ABERRATION_SHADER = {
  name: 'HyperMotionChromaticAberration',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    hmResolution: { value: new THREE.Vector2(1, 1) },
    hmAmountPx: { value: 0 },
    hmAngleRadians: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 hmResolution;
    uniform float hmAmountPx;
    uniform float hmAngleRadians;
    varying vec2 vUv;

    vec4 sampleWithinFrame(vec2 uv) {
      return texture2D(tDiffuse, clamp(uv, vec2(0.0), vec2(1.0)));
    }

    void main() {
      vec2 direction = vec2(cos(hmAngleRadians), sin(hmAngleRadians));
      vec2 offsetUv = direction * hmAmountPx / max(hmResolution, vec2(1.0));
      vec4 redSample = sampleWithinFrame(vUv + offsetUv);
      vec4 centerSample = sampleWithinFrame(vUv);
      vec4 blueSample = sampleWithinFrame(vUv - offsetUv);
      gl_FragColor = vec4(
        redSample.r,
        centerSample.g,
        blueSample.b,
        max(centerSample.a, max(redSample.a, blueSample.a))
      );
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
} as const

/** Viewport-relative ellipse that darkens existing pixels without adding alpha. */
export const VIGNETTE_SHADER = {
  name: 'HyperMotionVignette',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    hmAmount: { value: 0.35 },
    hmSize: { value: 0.5 },
    hmFeather: { value: 0.5 },
    // One display code of spatial dither prevents near-black gradients from
    // collapsing into broad contours at the final 8-bit output boundary.
    hmDitherAmplitude: { value: 1 / 255 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float hmAmount;
    uniform float hmSize;
    uniform float hmFeather;
    uniform float hmDitherAmplitude;
    varying vec2 vUv;

    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      float radius = length((vUv - 0.5) * 2.0) / sqrt(2.0);
      float mask = smoothstep(hmSize, hmSize + max(hmFeather, 0.001), radius);
      gl_FragColor = vec4(source.rgb * (1.0 - hmAmount * mask), source.a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      // Dither in display space, after encoding, where the 8-bit rounding
      // happens. Keep it monochrome and fixed to output pixels so neither
      // color speckles nor animated grain are introduced during playback.
      float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
      float ditherWeight = smoothstep(0.0, 1.0 / 255.0, hmAmount * mask) * source.a;
      gl_FragColor.rgb = clamp(gl_FragColor.rgb + vec3(noise * hmDitherAmplitude * ditherWeight), 0.0, 1.0);
    }
  `,
} as const

/**
 * Deterministic analog-tape treatment. All temporal variation comes from the
 * authored scene playhead; a paused frame and the matching exported frame
 * therefore resolve to the same wobble, tear, grain, and rolling noise band.
 *
 * This pass intentionally stays in linear color space. OutputPass or the final
 * chromatic/vignette pass owns tone mapping and display encoding.
 */
export const VHS_SHADER = {
  name: 'HyperMotionVHS',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    hmResolution: { value: new THREE.Vector2(1, 1) },
    hmTime: { value: 0 },
    hmIntensity: { value: 0 },
    hmNoise: { value: 0.35 },
    hmScanlines: { value: 0.5 },
    hmColorBleedPx: { value: 3 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 hmResolution;
    uniform float hmTime;
    uniform float hmIntensity;
    uniform float hmNoise;
    uniform float hmScanlines;
    uniform float hmColorBleedPx;
    varying vec2 vUv;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    vec4 sampleWithinFrame(vec2 uv) {
      vec2 lowerBound = step(vec2(0.0), uv);
      vec2 upperBound = step(uv, vec2(1.0));
      float coverage =
        lowerBound.x * lowerBound.y * upperBound.x * upperBound.y;
      return texture2D(tDiffuse, clamp(uv, vec2(0.0), vec2(1.0))) * coverage;
    }

    void main() {
      vec2 resolution = max(hmResolution, vec2(1.0));
      float amount = clamp(hmIntensity, 0.0, 1.0);
      float sceneTime = max(hmTime, 0.0);
      float temporalFrame = floor(sceneTime * 60.0 + 0.0001);
      vec2 pixel = floor(vUv * resolution);
      float tapeRow = floor(pixel.y / 3.0);

      // Two low-frequency tracking waves plus sparse horizontal tears.
      float wobblePx =
        sin(vUv.y * 42.0 + sceneTime * 3.1) * 1.4 +
        sin(vUv.y * 127.0 - sceneTime * 1.7) * 0.65;
      float tearGate = step(
        0.94,
        hash21(vec2(floor(sceneTime * 7.0), tapeRow))
      );
      wobblePx +=
        (hash21(vec2(tapeRow, temporalFrame)) - 0.5) *
        14.0 *
        tearGate;

      // Occasional whole-frame vertical tracking kick.
      float verticalGate = step(
        0.975,
        hash21(vec2(floor(sceneTime * 4.0), 17.0))
      );
      float verticalKickPx =
        verticalGate * sin(sceneTime * 90.0) * 6.0;
      vec2 signalUv = vUv + vec2(
        wobblePx * amount / resolution.x,
        verticalKickPx * amount / resolution.y
      );

      // Tape color bleed stays horizontal and composition-pixel based.
      vec2 bleedUv = vec2(
        hmColorBleedPx * amount / resolution.x,
        0.0
      );
      vec4 redSample = sampleWithinFrame(signalUv + bleedUv);
      vec4 centerSample = sampleWithinFrame(signalUv);
      vec4 blueSample = sampleWithinFrame(signalUv - bleedUv);
      float alpha = max(
        centerSample.a,
        max(redSample.a, blueSample.a)
      );
      vec3 color = vec3(
        redSample.r,
        centerSample.g,
        blueSample.b
      );

      // Slight tape desaturation, alternating scanlines, and frame-stable grain.
      float luma = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(color, vec3(luma), amount * 0.12);
      float scanline = mod(pixel.y, 2.0);
      color *= 1.0 - scanline * hmScanlines * amount * 0.18;

      float grain =
        hash21(pixel + vec2(temporalFrame, temporalFrame * 0.37)) - 0.5;
      color += grain * hmNoise * amount * 0.16 * alpha;

      // A noisy tracking band rolls through the image in authored scene time.
      float bandCenter = fract(sceneTime * 0.12);
      float bandDistance = abs(signalUv.y - bandCenter);
      bandDistance = min(bandDistance, 1.0 - bandDistance);
      float band = 1.0 - smoothstep(0.0, 0.055, bandDistance);
      float bandNoise =
        hash21(vec2(pixel.x * 0.25 + temporalFrame, tapeRow)) - 0.5;
      color += bandNoise * hmNoise * amount * band * 0.22 * alpha;
      color *= 1.0 - band * amount * 0.08;

      float flicker =
        1.0 +
        (hash21(vec2(temporalFrame, 91.0)) - 0.5) * amount * 0.035;
      gl_FragColor = vec4(max(color * flicker, vec3(0.0)), alpha);
    }
  `,
} as const

/**
 * Persistent post-processing graph for one Three viewport.
 *
 * The graph is allocated lazily by ThreeSceneViewport only when at least one
 * effect is active, then reused for every preview/export frame. Parameter
 * animation updates uniforms/pass fields without rebuilding shaders or render
 * targets. The caller retains the direct renderer.render fast path while all
 * effects are inactive.
 */
export class ScenePostEffectsRenderer {
  private readonly composer: EffectComposer
  private readonly renderPass: RenderPass
  private bloomPass: SceneBloomPass | null = null
  private readonly vhsPass: ShaderPass
  private readonly chromaticPass: ShaderPass
  private readonly vignettePass: ShaderPass
  private readonly outputPass: OutputPass
  private readonly withBloomSource?: (draw: () => void) => void
  private width = 0
  private height = 0
  private pixelRatio = 0
  private disposed = false

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
    pixelRatio: number,
    withBloomSource?: (draw: () => void) => void,
  ) {
    this.withBloomSource = withBloomSource
    this.composer = new EffectComposer(renderer)
    this.renderPass = new RenderPass(scene, camera)
    this.vhsPass = new ShaderPass(VHS_SHADER)
    this.chromaticPass = new ShaderPass(CHROMATIC_ABERRATION_SHADER)
    this.vignettePass = new ShaderPass(VIGNETTE_SHADER)
    this.outputPass = new OutputPass()

    this.composer.addPass(this.renderPass)
    this.composer.addPass(this.vhsPass)
    this.composer.addPass(this.chromaticPass)
    this.composer.addPass(this.vignettePass)
    this.composer.addPass(this.outputPass)
    this.resize(width, height, pixelRatio)
  }

  resize(width: number, height: number, pixelRatio: number): void {
    const safeWidth = Math.max(1, width)
    const safeHeight = Math.max(1, height)
    const safePixelRatio = Math.max(0.25, Math.min(4, pixelRatio))
    if (
      this.width === safeWidth &&
      this.height === safeHeight &&
      Math.abs(this.pixelRatio - safePixelRatio) <= 0.001
    ) {
      return
    }
    this.width = safeWidth
    this.height = safeHeight
    this.pixelRatio = safePixelRatio
    this.composer.setPixelRatio(safePixelRatio)
    this.composer.setSize(safeWidth, safeHeight)
    this.chromaticPass.uniforms.hmResolution.value.set(
      safeWidth,
      safeHeight,
    )
    this.vhsPass.uniforms.hmResolution.value.set(safeWidth, safeHeight)
  }

  configure(
    effects: CameraPostEffectsState,
    width: number,
    height: number,
    pixelRatio: number,
    playhead = 0,
  ): void {
    // Tear Bloom down before a resize so disabling its authored toggle never
    // reallocates eleven scratch targets just before disposing them.
    if (!effects.bloomEnabled) this.releaseBloomPass()
    this.resize(width, height, pixelRatio)

    const chromaticEnabled =
      effects.chromaticAberrationEnabled &&
      effects.chromaticAberrationAmount > EFFECT_EPSILON
    const bloomEnabled =
      effects.bloomEnabled && effects.bloomStrength > EFFECT_EPSILON
    const vhsEnabled =
      effects.vhsEnabled && effects.vhsIntensity > EFFECT_EPSILON

    this.vhsPass.enabled = vhsEnabled
    this.vhsPass.uniforms.hmTime.value =
      Number.isFinite(playhead) ? Math.max(0, playhead) : 0
    this.vhsPass.uniforms.hmIntensity.value = effects.vhsIntensity
    this.vhsPass.uniforms.hmNoise.value = effects.vhsNoise
    this.vhsPass.uniforms.hmScanlines.value = effects.vhsScanlines
    this.vhsPass.uniforms.hmColorBleedPx.value = effects.vhsColorBleed

    this.chromaticPass.enabled = chromaticEnabled
    this.chromaticPass.uniforms.hmAmountPx.value =
      effects.chromaticAberrationAmount
    this.chromaticPass.uniforms.hmAngleRadians.value =
      THREE.MathUtils.degToRad(effects.chromaticAberrationAngle)

    const vignetteEnabled = cameraVignetteActive(effects)
    this.vignettePass.enabled = vignetteEnabled
    this.vignettePass.uniforms.hmAmount.value = effects.vignetteAmount
    this.vignettePass.uniforms.hmSize.value = effects.vignetteSize
    this.vignettePass.uniforms.hmFeather.value = effects.vignetteFeather

    // Three applies tone mapping/display encoding only when a ShaderPass
    // renders to the screen. The last active chromatic/vignette pass owns it;
    // intermediate passes retain linear RGB, avoiding duplicate conversion.
    this.outputPass.enabled = !chromaticEnabled && !vignetteEnabled

    const bloomPass = effects.bloomEnabled
      ? this.ensureBloomPass()
      : null
    if (bloomPass) {
      bloomPass.enabled = bloomEnabled
      bloomPass.strength = effects.bloomStrength
      bloomPass.radius = effects.bloomRadius
      bloomPass.threshold = effects.bloomThreshold
    }
  }

  render(): void {
    // Time-dependent passes use the scene playhead. A fixed delta keeps export
    // independent of how long the previous frame took to render.
    this.composer.render(0)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.releaseBloomPass()
    this.vhsPass.dispose()
    this.chromaticPass.dispose()
    this.vignettePass.dispose()
    this.outputPass.dispose()
    this.composer.dispose()
  }

  /** Read-only diagnostics used by lifecycle tests and performance tooling. */
  getResourceProfile(): {
    disposed: boolean
    bloomAllocated: boolean
    bloomScratchTargets: number
    bloomDepthBufferedTargets: number
  } {
    const targets = this.bloomPass
      ? bloomScratchTargets(this.bloomPass)
      : []
    return {
      disposed: this.disposed,
      bloomAllocated: this.bloomPass !== null,
      bloomScratchTargets: targets.length,
      bloomDepthBufferedTargets: targets.filter(
        (target) => target.depthBuffer,
      ).length,
    }
  }

  private ensureBloomPass(): SceneBloomPass {
    if (this.bloomPass) return this.bloomPass
    const bloomPass = new SceneBloomPass(
      Math.max(1, this.width * this.pixelRatio),
      Math.max(1, this.height * this.pixelRatio),
      (renderer, target, deltaTime) => {
        const draw = () => this.renderPass.render(renderer, target, target, deltaTime, false)
        if (this.withBloomSource) this.withBloomSource(draw)
        else draw()
      },
    )
    this.composer.insertPass(bloomPass, 1)
    this.bloomPass = bloomPass
    return bloomPass
  }

  private releaseBloomPass(): void {
    const bloomPass = this.bloomPass
    if (!bloomPass) return
    this.composer.removePass(bloomPass)
    bloomPass.dispose()
    this.bloomPass = null
  }
}

function bloomScratchTargets(
  bloomPass: SceneBloomPass,
): THREE.WebGLRenderTarget[] {
  return bloomPass.getScratchTargets()
}

function clampFinite(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric = typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback
  return Math.max(min, Math.min(max, numeric))
}

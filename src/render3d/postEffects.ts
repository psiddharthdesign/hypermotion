// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

export interface CameraPostEffectsInput {
  chromaticAberrationEnabled?: boolean
  chromaticAberrationAmount?: number
  chromaticAberrationAngle?: number
  bloomEnabled?: boolean
  bloomStrength?: number
  bloomRadius?: number
  bloomThreshold?: number
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
  }
}

/** Skip both the render targets and full-screen passes for inert settings. */
export function cameraPostEffectsActive(
  effects: CameraPostEffectsState,
): boolean {
  return (
    (effects.chromaticAberrationEnabled &&
      effects.chromaticAberrationAmount > EFFECT_EPSILON) ||
    (effects.bloomEnabled && effects.bloomStrength > EFFECT_EPSILON)
  )
}

/** Resource lifetime follows authored toggles, not animated zero crossings. */
export function cameraPostEffectsEnabled(
  effects: CameraPostEffectsState,
): boolean {
  return effects.chromaticAberrationEnabled || effects.bloomEnabled
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
    previousEffects.bloomThreshold !== nextEffects.bloomThreshold
  )
}

/**
 * Small framework-agnostic idle gate. React supplies `onIdle` to request one
 * final full-quality render after rapid edits/scrubs have stopped.
 */
export class PostEffectsIdleQualityController {
  private realtime = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly onIdle: () => void,
    private readonly delayMs = POST_EFFECTS_IDLE_QUALITY_DELAY_MS,
  ) {}

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
 * colored fringe instead of being cropped to the original silhouette.
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
      vec2 lowerBound = step(vec2(0.0), uv);
      vec2 upperBound = step(uv, vec2(1.0));
      float coverage =
        lowerBound.x * lowerBound.y * upperBound.x * upperBound.y;
      return texture2D(tDiffuse, clamp(uv, vec2(0.0), vec2(1.0))) * coverage;
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

/**
 * Persistent post-processing graph for one Three viewport.
 *
 * The graph is allocated lazily by ThreeSceneViewport only when at least one
 * effect is active, then reused for every preview/export frame. Parameter
 * animation updates uniforms/pass fields without rebuilding shaders or render
 * targets. The caller retains the direct renderer.render fast path while both
 * effects are inactive.
 */
export class ScenePostEffectsRenderer {
  private readonly composer: EffectComposer
  private readonly renderPass: RenderPass
  private bloomPass: UnrealBloomPass | null = null
  private readonly chromaticPass: ShaderPass
  private readonly outputPass: OutputPass
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
  ) {
    this.composer = new EffectComposer(renderer)
    this.renderPass = new RenderPass(scene, camera)
    this.chromaticPass = new ShaderPass(CHROMATIC_ABERRATION_SHADER)
    this.outputPass = new OutputPass()

    this.composer.addPass(this.renderPass)
    this.composer.addPass(this.chromaticPass)
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
  }

  configure(
    effects: CameraPostEffectsState,
    width: number,
    height: number,
    pixelRatio: number,
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

    this.chromaticPass.enabled = chromaticEnabled
    this.chromaticPass.uniforms.hmAmountPx.value =
      effects.chromaticAberrationAmount
    this.chromaticPass.uniforms.hmAngleRadians.value =
      THREE.MathUtils.degToRad(effects.chromaticAberrationAngle)

    // Chromatic is already a full-screen pass. When active, it also performs
    // Three's standard tone mapping/output conversion and becomes the final
    // pass, avoiding a second full-resolution copy through OutputPass.
    this.outputPass.enabled = !chromaticEnabled

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
    // No pass is time-dependent. A fixed delta keeps frame export bit-stable.
    this.composer.render(0)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.releaseBloomPass()
    this.chromaticPass.dispose()
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

  private ensureBloomPass(): UnrealBloomPass {
    if (this.bloomPass) return this.bloomPass
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(
        Math.max(1, this.width * this.pixelRatio),
        Math.max(1, this.height * this.pixelRatio),
      ),
      0,
      0.35,
      0.75,
    )
    // UnrealBloom's fullscreen scratch passes never use depth. These targets
    // are public Three API and have not reached WebGL yet, so disabling their
    // attachments here prevents the allocations entirely.
    for (const target of bloomScratchTargets(bloomPass)) {
      target.depthBuffer = false
    }
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
  bloomPass: UnrealBloomPass,
): THREE.WebGLRenderTarget[] {
  return [
    bloomPass.renderTargetBright,
    ...bloomPass.renderTargetsHorizontal,
    ...bloomPass.renderTargetsVertical,
  ]
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

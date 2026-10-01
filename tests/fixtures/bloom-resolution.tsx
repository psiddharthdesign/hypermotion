// SPDX-License-Identifier: Apache-2.0
// Actual GPU regression fixture. No project, document, or persistence imports.
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { ScenePostEffectsRenderer, normalizeCameraPostEffects } from '../../src/render3d/postEffects'
import { SceneBloomPass } from '../../src/render3d/SceneBloomPass'
import { installDepthOfFieldShader, updateDepthOfFieldShader } from '../../src/render3d/depthOfFieldShader'
import { installDepthOfFieldRenderTargetScale } from '../../src/render3d/depthOfFieldRenderTarget'

const WIDTH = 3840
const HEIGHT = 2160
const CANONICAL_WIDTH = 960
const CANONICAL_HEIGHT = 540
const RATIOS = [0.25, 1, 2]
const BLOOM = { bloomEnabled: true, bloomStrength: 4, bloomRadius: 0, bloomThreshold: 0.75 }
const MIXED = {
  ...BLOOM,
  chromaticAberrationEnabled: true,
  chromaticAberrationAmount: 4.200459,
  chromaticAberrationAngle: 0,
  vignetteEnabled: true,
  vignetteAmount: 0.23872333,
  vignetteSize: 0.5,
  vignetteFeather: 0.5,
}
type Snapshot = { canvas: HTMLCanvasElement; pixels: Uint8ClampedArray }
type Frames = { base: Snapshot; bloom: Snapshot; mixed: Snapshot }
type Halo = { values: Float32Array; energy: number; footprint: number; peak: number }
const checks: { name: string; passed: boolean }[] = []
const host = document.getElementById('root')!
host.innerHTML = `
  <style>
    body { margin: 0; padding: 24px; background: #11151d; color: #f3f5fa; font: 14px system-ui; }
    h1 { margin: 0 0 10px; font-size: 24px; } h2 { margin: 28px 0 12px; font-size: 18px; }
    p { max-width: 1000px; line-height: 1.5; color: #c3cbd9; }
    #summary { font-weight: 700; padding: 12px 0; position: sticky; top: 0; background: #11151d; }
    #examples, #legacy, #dof, #dof-legacy, #budgets { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 18px; }
    figure { margin: 0; } canvas { display: block; width: 100%; height: auto; border: 1px solid #394252; }
    figcaption { margin: 7px 0 12px; color: #d7deeb; line-height: 1.5; }
    table { border-collapse: collapse; width: 100%; margin-top: 18px; background: #171e29; }
    td, th { padding: 8px 10px; text-align: left; border-bottom: 1px solid #303949; }
    .pass { color: #7de3a6; } .fail { color: #ff9292; } .note { color: #f6d589; }
  </style>
  <h1>Bloom: preview and export parity</h1>
  <p>The same 3840 × 2160 scene is rendered through the production post-processing graph at 960 × 540, 3840 × 2160, and 7680 × 4320. All outputs are reduced to 960 × 540 before comparison. The scene includes small text, thin white lines, and bright shapes on a dark background.</p>
  <p>Settings reproduce the reported strong bloom: strength 4, radius 0, threshold 0.75. A second pass combines bloom, chromatic aberration, and vignette. The old Three.js bloom graph is included as a negative control.</p>
  <div id="summary" role="status">Running real GPU renders…</div>
  <h2>Current renderer — strong bloom, with and without other effects</h2><div id="examples"></div>
  <h2>Tilted text with depth of field — 48 aperture samples</h2>
  <p>A real tilted text plane crosses the focus plane. Its mipmapped texture, aperture kernel, and render-target density hook match the production material. Bloom is measured only where all no-bloom outputs are dark, separating the halo from changes to the underlying text raster.</p><div id="dof"></div>
  <h2>Downsample-only bloom input — expected depth-of-field mismatch</h2><div id="dof-legacy"></div>
  <h2>Isolated glow with 6, 24, and 48 base-image aperture samples</h2>
  <p>These images display the production bloom pass's glow texture directly. Base-image sampling changes between playback and paused quality, while the tagged bloom source must use the same 48-sample aperture kernel.</p><div id="budgets"></div>
  <h2>Previous renderer — expected resolution mismatch</h2><div id="legacy"></div>
  <table><thead><tr><th>Result</th><th>Check</th><th>Pixel evidence</th></tr></thead><tbody id="results"></tbody></table>
`

function record(name: string, passed: boolean, detail: string) {
  checks.push({ name, passed })
  const row = document.createElement('tr')
  row.className = passed ? 'pass' : 'fail'
  for (const value of [passed ? 'PASS' : 'FAIL', name, detail]) {
    const cell = document.createElement('td')
    cell.textContent = value
    row.append(cell)
  }
  document.getElementById('results')!.append(row)
}

function show(snapshot: Snapshot, caption: string, group = 'examples') {
  const figure = document.createElement('figure')
  const label = document.createElement('figcaption')
  label.textContent = caption
  figure.append(snapshot.canvas, label)
  document.getElementById(group)!.append(figure)
}

function sourceScene() {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const context = canvas.getContext('2d')!
  context.scale(4, 4)
  context.fillStyle = '#080b12'
  context.fillRect(0, 0, CANONICAL_WIDTH, CANONICAL_HEIGHT)
  context.fillStyle = '#ffffff'
  context.font = '600 42px Arial, sans-serif'
  context.fillText('Small details. Same glow.', 74, 120)
  context.font = '500 20px Arial, sans-serif'
  context.fillText('Dashboard  /  Transactions  /  Accounts', 74, 166)
  context.font = '400 12px Arial, sans-serif'
  context.fillText('Preview and export should preserve this text and its halo.', 74, 198)
  context.fillRect(76, 250, 330, 2)
  context.fillRect(76, 266, 240, 1)
  context.fillRect(76, 282, 150, 0.5)
  context.fillRect(76, 324, 4, 120)
  context.fillRect(100, 324, 2, 120)
  context.fillRect(122, 324, 1, 120)
  context.fillRect(144, 324, 0.5, 120)
  context.beginPath()
  context.arc(610, 332, 44, 0, Math.PI * 2)
  context.fill()
  context.fillRect(750, 294, 74, 74)
  context.fillStyle = '#38bdff'
  context.fillRect(250, 358, 140, 52)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  const material = new THREE.MeshBasicMaterial({ map: texture, depthTest: false, depthWrite: false })
  const geometry = new THREE.PlaneGeometry(WIDTH, HEIGHT)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#080b12')
  scene.add(new THREE.Mesh(geometry, material))
  const camera = new THREE.OrthographicCamera(-WIDTH / 2, WIDTH / 2, HEIGHT / 2, -HEIGHT / 2, 0, 2)
  camera.position.z = 1
  return { scene, camera, dispose: () => { texture.dispose(); material.dispose(); geometry.dispose() } }
}

function depthOfFieldScene() {
  const width = 3400
  const height = 1900
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  context.fillStyle = '#ffffff'
  const labels = ['Dashboard  /  Overview', 'Transactions  /  Payments', 'Accounts  /  Recent activity', 'Investments  /  Performance', 'Categories  /  Monthly budget', 'Recurring  /  Upcoming bills']
  labels.forEach((label, index) => {
    const y = 290 + index * 265
    // Thick centre rows cross the sharp band and must produce positive bloom
    // even in the canonical pass. Surrounding fine labels retain the mip/DOF
    // threshold regression; matching two empty glow buffers cannot pass.
    const thick = index === 2 || index === 3
    context.font = thick ? '900 190px Arial, sans-serif' : '500 104px Arial, sans-serif'
    context.fillText(thick ? (index === 2 ? 'ACCOUNTS' : 'INVESTMENTS') : label, thick ? 1050 : 260, y)
    context.font = '400 42px Arial, sans-serif'
    context.fillText('Available balance  $12,480.42  •  Updated just now', 270, y + 80)
    context.fillRect(270, y + 110, 2540, 3)
  })
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false })
  installDepthOfFieldShader(material)
  installDepthOfFieldRenderTargetScale(material)
  const updateSampling = (sampleCount: number) => updateDepthOfFieldShader(material, {
    enabled: true,
    blurPx: 24,
    minimumBlurPx: 0,
    planeWidth: width,
    planeHeight: height,
    focusMask: false,
    focusX: 0,
    focusY: 0,
    focusRadius: 0,
    focusFalloff: 1,
    screenPixelRatio: 1,
    sampleCount,
    bladeCount: 7,
    bladeRotation: 0,
    bokehRatio: 1,
    depthFocus: {
      normal: { x: 0, y: 0, z: 1 },
      constant: 5000,
      depthScale: 400,
      aperture: 1,
      maxBlurPx: 24,
    },
  })
  updateSampling(48)
  const draws: { bloom: boolean; samples: number }[] = []
  const beforeRender = material.onBeforeRender
  material.onBeforeRender = function (...args) {
    beforeRender.apply(this, args)
    draws.push({
      bloom: args[0].getRenderTarget()?.texture.userData.hyperMotionBloomSource === true,
      samples: material.userData.hyperMotionDofUniforms.hmSampleCount.value,
    })
  }
  const geometry = new THREE.PlaneGeometry(width, height)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.set(THREE.MathUtils.degToRad(34), THREE.MathUtils.degToRad(-28), THREE.MathUtils.degToRad(-8))
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#080b12')
  scene.add(mesh)
  const camera = new THREE.OrthographicCamera(-WIDTH / 2, WIDTH / 2, HEIGHT / 2, -HEIGHT / 2, 1, 10000)
  camera.position.z = 5000
  return { scene, camera, updateSampling, draws, dispose: () => { texture.dispose(); material.dispose(); geometry.dispose() } }
}

/**
 * Negative control preserved from the first attempted fix. Its blur pyramid
 * is fixed at 960px, but it derives highlights from the output-density DOF
 * image. Downsampling cannot undo a different nonlinear aperture prefilter.
 */
class DownsampleOnlyBloomPass extends UnrealBloomPass {
  private readonly targets: THREE.WebGLRenderTarget[] = []
  private readonly sourceUniform = { value: null as THREE.Texture | null }
  private readonly prefilter: THREE.ShaderMaterial
  private readonly quad: FullScreenQuad

  constructor(width: number, height: number) {
    super(new THREE.Vector2(CANONICAL_WIDTH, CANONICAL_HEIGHT), BLOOM.bloomStrength, BLOOM.bloomRadius, BLOOM.bloomThreshold)
    this.materialHighPassFilter.uniforms.fixtureBloomSource = this.sourceUniform
    this.materialHighPassFilter.fragmentShader = this.materialHighPassFilter.fragmentShader.replace(/\btDiffuse\b/g, 'fixtureBloomSource')
    this.prefilter = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null as THREE.Texture | null }, outputSize: { value: new THREE.Vector2() } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 outputSize; varying vec2 vUv;
        void main() { vec2 d = 0.25 / outputSize; gl_FragColor = 0.25 * (
          texture2D(tDiffuse, vUv + vec2(-d.x, -d.y)) + texture2D(tDiffuse, vUv + vec2(d.x, -d.y)) +
          texture2D(tDiffuse, vUv + vec2(-d.x, d.y)) + texture2D(tDiffuse, vUv + vec2(d.x, d.y))); }`,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    this.quad = new FullScreenQuad(this.prefilter)
    this.setSize(width, height)
  }

  override setSize(width: number, height: number) {
    super.setSize(CANONICAL_WIDTH, CANONICAL_HEIGHT)
    for (const target of this.targets) target.dispose()
    this.targets.length = 0
    while (width > CANONICAL_WIDTH || height > CANONICAL_HEIGHT) {
      width = Math.max(CANONICAL_WIDTH, Math.ceil(width / 2))
      height = Math.max(CANONICAL_HEIGHT, Math.ceil(height / 2))
      this.targets.push(new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false }))
    }
  }

  override render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
    let input = read.texture
    const previous = renderer.getRenderTarget()
    for (const target of this.targets) {
      this.prefilter.uniforms.tDiffuse.value = input
      this.prefilter.uniforms.outputSize.value.set(target.width, target.height)
      renderer.setRenderTarget(target)
      this.quad.render(renderer)
      input = target.texture
    }
    renderer.setRenderTarget(previous)
    this.sourceUniform.value = input
    super.render(renderer, write, read, deltaTime, maskActive)
  }

  override dispose() {
    for (const target of this.targets) target.dispose()
    this.targets.length = 0
    this.prefilter.dispose()
    this.quad.dispose()
    super.dispose()
  }
}

function snapshot(renderer: THREE.WebGLRenderer): Snapshot {
  const canvas = document.createElement('canvas')
  canvas.width = CANONICAL_WIDTH
  canvas.height = CANONICAL_HEIGHT
  const context = canvas.getContext('2d')!
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height)
  return { canvas, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data }
}

function validateFrame(name: string, frame: Snapshot) {
  let minimumAlpha = 255
  let maximumChannel = 0
  for (let i = 0; i < frame.pixels.length; i += 4) {
    minimumAlpha = Math.min(minimumAlpha, frame.pixels[i + 3])
    maximumChannel = Math.max(maximumChannel, frame.pixels[i], frame.pixels[i + 1], frame.pixels[i + 2])
  }
  record(name, minimumAlpha === 255 && maximumChannel >= 240,
    `minimum alpha ${minimumAlpha}; brightest channel ${maximumChannel}; ${frame.canvas.width} × ${frame.canvas.height} normalized pixels`)
}

function luminance(pixels: Uint8ClampedArray, index: number) {
  return pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722
}

function halo(base: Snapshot, glow: Snapshot, mask?: Uint8Array): Halo {
  const values = new Float32Array(CANONICAL_WIDTH * CANONICAL_HEIGHT)
  let energy = 0
  let footprint = 0
  let peak = 0
  for (let pixel = 0; pixel < values.length; pixel++) {
    const index = pixel * 4
    const baseLight = luminance(base.pixels, index)
    // Exclude source highlights; measure light added to the dark surroundings.
    const included = mask ? mask[pixel] === 1 : baseLight < 70
    const addedLight = included ? Math.max(0, luminance(glow.pixels, index) - baseLight) : 0
    values[pixel] = addedLight
    energy += addedLight
    if (addedLight > 3) footprint++
    peak = Math.max(peak, addedLight)
  }
  return { values, energy, footprint, peak }
}

function relativeError(a: number, b: number) {
  return Math.abs(a - b) / Math.max(a, b, 1)
}

function compareHalos(reference: Halo, candidate: Halo) {
  let absoluteError = 0
  for (let i = 0; i < reference.values.length; i++) absoluteError += Math.abs(reference.values[i] - candidate.values[i])
  return {
    energy: relativeError(reference.energy, candidate.energy),
    footprint: relativeError(reference.footprint, candidate.footprint),
    meanPixelError: absoluteError / reference.values.length,
  }
}

function imageError(reference: Snapshot, candidate: Snapshot) {
  let total = 0
  for (let i = 0; i < reference.pixels.length; i += 4) {
    total += Math.abs(reference.pixels[i] - candidate.pixels[i])
      + Math.abs(reference.pixels[i + 1] - candidate.pixels[i + 1])
      + Math.abs(reference.pixels[i + 2] - candidate.pixels[i + 2])
  }
  return total / (reference.pixels.length / 4 * 3)
}

function highlightCoverage(frame: Snapshot) {
  let count = 0
  for (let i = 0; i < frame.pixels.length; i += 4) if (luminance(frame.pixels, i) > 220) count++
  return count
}

function describe(errors: ReturnType<typeof compareHalos>) {
  return `halo energy difference ${(errors.energy * 100).toFixed(2)}%; halo footprint difference ${(errors.footprint * 100).toFixed(2)}%; mean halo error ${errors.meanPixelError.toFixed(3)}/255`
}

const yieldFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

async function verifyDepthOfFieldBloom(renderer: THREE.WebGLRenderer) {
  const source = depthOfFieldScene()
  const frames = new Map<number, { base: Snapshot; bloom: Snapshot; oldBloom: Snapshot }>()
  try {
    for (const ratio of RATIOS) {
      document.getElementById('summary')!.textContent = `Rendering tilted DOF text at ${WIDTH * ratio} × ${HEIGHT * ratio} with 48 aperture samples…`
      await yieldFrame()
      renderer.setPixelRatio(ratio)
      renderer.setSize(WIDTH, HEIGHT, false)
      const graph = new ScenePostEffectsRenderer(renderer, source.scene, source.camera, WIDTH, HEIGHT, ratio)
      let base: Snapshot
      let bloom: Snapshot
      try {
        graph.configure(normalizeCameraPostEffects({}), WIDTH, HEIGHT, ratio)
        graph.render()
        base = snapshot(renderer)
        graph.configure(normalizeCameraPostEffects(BLOOM), WIDTH, HEIGHT, ratio)
        graph.render()
        bloom = snapshot(renderer)
        show(base, `${ratio}× tilted text, DOF only.`, 'dof')
        show(bloom, `${ratio}× tilted text, DOF + strong bloom.`, 'dof')
        validateFrame(`Tilted DOF output is opaque and nonempty · ${ratio}×`, bloom)
      } finally {
        graph.dispose()
      }
      await yieldFrame()
      const oldGraph = new EffectComposer(renderer)
      const render = new RenderPass(source.scene, source.camera)
      const oldBloom = new DownsampleOnlyBloomPass(WIDTH * ratio, HEIGHT * ratio)
      const output = new OutputPass()
      oldGraph.addPass(render)
      oldGraph.addPass(oldBloom)
      oldGraph.addPass(output)
      oldGraph.setPixelRatio(ratio)
      oldGraph.setSize(WIDTH, HEIGHT)
      try {
        oldGraph.render(0)
        const oldFrame = snapshot(renderer)
        frames.set(ratio, { base, bloom, oldBloom: oldFrame })
        show(oldFrame, `${ratio}× downsample-only bloom input. DOF source sampling differs before threshold.`, 'dof-legacy')
      } finally {
        render.dispose()
        oldBloom.dispose()
        output.dispose()
        oldGraph.dispose()
      }
      await yieldFrame()
    }
    const sharedMask = new Uint8Array(CANONICAL_WIDTH * CANONICAL_HEIGHT)
    for (let pixel = 0; pixel < sharedMask.length; pixel++) {
      sharedMask[pixel] = RATIOS.every(ratio => luminance(frames.get(ratio)!.base.pixels, pixel * 4) < 20) ? 1 : 0
    }
    const reference = frames.get(0.25)!
    const referenceHalo = halo(reference.base, reference.bloom, sharedMask)
    record('Tilted text has a measurable bloom halo', referenceHalo.energy > 10000 && referenceHalo.footprint > 1000,
      `halo energy ${referenceHalo.energy.toFixed(0)}; illuminated dark-background pixels ${referenceHalo.footprint}`)
    for (const ratio of [1, 2]) {
      const candidate = frames.get(ratio)!
      const errors = compareHalos(referenceHalo, halo(candidate.base, candidate.bloom, sharedMask))
      record(`Tilted DOF bloom halo matches preview · ${ratio}× export`, errors.energy <= 0.05 && errors.footprint <= 0.08 && errors.meanPixelError <= 0.75, describe(errors))
      const oldErrors = compareHalos(halo(reference.base, reference.oldBloom, sharedMask), halo(candidate.base, candidate.oldBloom, sharedMask))
      record(`Negative control catches DOF-dependent bloom threshold · ${ratio}×`, oldErrors.energy > 0.05 || oldErrors.footprint > 0.08 || oldErrors.meanPixelError > 0.75, describe(oldErrors))
    }
  } finally {
    source.dispose()
  }
}

async function verifyBloomSampleBudgets(renderer: THREE.WebGLRenderer) {
  const source = depthOfFieldScene()
  renderer.setPixelRatio(0.25)
  renderer.setSize(WIDTH, HEIGHT, false)
  const composer = new EffectComposer(renderer)
  const scenePass = new RenderPass(source.scene, source.camera)
  const bloom = new SceneBloomPass(CANONICAL_WIDTH, CANONICAL_HEIGHT, (activeRenderer, target, deltaTime) => {
    scenePass.render(activeRenderer, target, target, deltaTime, false)
  })
  bloom.strength = BLOOM.bloomStrength
  bloom.radius = BLOOM.bloomRadius
  bloom.threshold = BLOOM.bloomThreshold
  const output = new OutputPass()
  composer.addPass(scenePass)
  composer.addPass(bloom)
  composer.addPass(output)
  composer.setPixelRatio(0.25)
  composer.setSize(WIDTH, HEIGHT)
  const glowMaterial = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: bloom.renderTargetsHorizontal[0].texture } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main() { gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
  })
  const glowQuad = new FullScreenQuad(glowMaterial)
  const frames = new Map<number, { base: Snapshot; glow: Snapshot }>()
  try {
    for (const samples of [6, 24, 48]) {
      document.getElementById('summary')!.textContent = `Checking isolated bloom with ${samples} base-image aperture samples…`
      await yieldFrame()
      source.updateSampling(samples)
      source.draws.length = 0
      bloom.enabled = false
      composer.render(0)
      const base = snapshot(renderer)
      bloom.enabled = true
      composer.render(0)
      const baseDraws = source.draws.filter(draw => !draw.bloom)
      const glowDraws = source.draws.filter(draw => draw.bloom)
      record(`Actual GPU lens budgets · ${samples} base samples`, baseDraws.length > 0 && baseDraws.every(draw => draw.samples === samples)
        && glowDraws.length > 0 && glowDraws.every(draw => draw.samples === 48),
      `base draw budgets [${baseDraws.map(draw => draw.samples).join(', ')}]; bloom draw budgets [${glowDraws.map(draw => draw.samples).join(', ')}]`)
      renderer.setRenderTarget(null)
      glowQuad.render(renderer)
      const glow = snapshot(renderer)
      frames.set(samples, { base, glow })
      show(glow, `Isolated glow: ${samples} base samples, 48 bloom-source samples.`, 'budgets')
    }
    const reference = frames.get(48)!
    let glowEnergy = 0
    let glowingPixels = 0
    for (let pixel = 0; pixel < reference.glow.pixels.length; pixel += 4) {
      const light = luminance(reference.glow.pixels, pixel)
      glowEnergy += light
      if (light > 3) glowingPixels++
    }
    record('Isolated glow is nonzero across lens budgets', glowEnergy > 10000 && glowingPixels > 1000,
      `isolated glow energy ${glowEnergy.toFixed(0)}; glowing pixels ${glowingPixels}`)
    for (const samples of [6, 24]) {
      const candidate = frames.get(samples)!
      const error = imageError(reference.glow, candidate.glow)
      const baseDifference = imageError(reference.base, candidate.base)
      record(`Isolated bloom is unchanged · ${samples} versus 48 base samples`, error <= 0.01,
        `mean glow RGB difference ${error.toFixed(6)}/255; underlying image difference ${baseDifference.toFixed(6)}/255`)
    }
    record('Fixture exercises different base DOF sampling', imageError(frames.get(6)!.base, reference.base) > 0.001,
      `6 versus 48 base-image mean RGB difference ${imageError(frames.get(6)!.base, reference.base).toFixed(6)}/255`)
  } finally {
    glowMaterial.dispose()
    glowQuad.dispose()
    scenePass.dispose()
    bloom.dispose()
    output.dispose()
    composer.dispose()
    source.dispose()
  }
}

async function run() {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setClearColor('#080b12', 1)
  const source = sourceScene()
  const frames = new Map<number, Frames>()
  const legacy = new Map<number, Snapshot>()
  try {
    for (const ratio of RATIOS) {
      document.getElementById('summary')!.textContent = `Rendering production graph at ${WIDTH * ratio} × ${HEIGHT * ratio}…`
      await yieldFrame()
      renderer.setPixelRatio(ratio)
      renderer.setSize(WIDTH, HEIGHT, false)
      const graph = new ScenePostEffectsRenderer(renderer, source.scene, source.camera, WIDTH, HEIGHT, ratio)
      try {
        graph.configure(normalizeCameraPostEffects({}), WIDTH, HEIGHT, ratio)
        graph.render()
        const base = snapshot(renderer)
        graph.configure(normalizeCameraPostEffects(BLOOM), WIDTH, HEIGHT, ratio)
        graph.render()
        const bloom = snapshot(renderer)
        graph.configure(normalizeCameraPostEffects(MIXED), WIDTH, HEIGHT, ratio)
        graph.render()
        const mixed = snapshot(renderer)
        frames.set(ratio, { base, bloom, mixed })
        validateFrame(`Production output is opaque and nonempty · ${ratio}×`, bloom)
        record(`Production output dimensions · ${ratio}×`, renderer.domElement.width === WIDTH * ratio && renderer.domElement.height === HEIGHT * ratio,
          `${renderer.domElement.width} × ${renderer.domElement.height} actual GPU canvas`)
        show(bloom, `${WIDTH * ratio} × ${HEIGHT * ratio} output (${ratio}×). Bloom alone.`)
        show(mixed, `${WIDTH * ratio} × ${HEIGHT * ratio} output (${ratio}×). Bloom + chromatic aberration + vignette.`)
      } finally {
        graph.dispose()
        const profile = graph.getResourceProfile()
        record(`Bloom resources disposed after render · ${ratio}×`, profile.disposed && !profile.bloomAllocated && profile.bloomScratchTargets === 0,
          `disposed ${profile.disposed}; bloom allocated ${profile.bloomAllocated}; scratch targets ${profile.bloomScratchTargets}`)
      }
      await yieldFrame()
    }
    const reference = frames.get(0.25)!
    const referenceHalo = halo(reference.base, reference.bloom)
    record('Bloom is visibly active', referenceHalo.energy > 10000 && referenceHalo.footprint > 1000 && referenceHalo.peak > 10,
      `halo energy ${referenceHalo.energy.toFixed(0)}; illuminated background pixels ${referenceHalo.footprint}; peak added luminance ${referenceHalo.peak.toFixed(2)}`)
    for (const ratio of [1, 2]) {
      const candidate = frames.get(ratio)!
      const errors = compareHalos(referenceHalo, halo(candidate.base, candidate.bloom))
      record(`Bloom halo matches preview · ${ratio}× export`, errors.energy <= 0.12 && errors.footprint <= 0.15 && errors.meanPixelError <= 2.5, describe(errors))
      const baseError = imageError(reference.base, candidate.base)
      const coverageError = relativeError(highlightCoverage(reference.base), highlightCoverage(candidate.base))
      record(`Source details match without bloom · ${ratio}×`, baseError <= 2 && coverageError <= 0.15,
        `mean RGB difference ${baseError.toFixed(3)}/255; bright source coverage difference ${(coverageError * 100).toFixed(2)}%`)
      const mixedError = imageError(reference.mixed, candidate.mixed)
      record(`Combined camera effects match preview · ${ratio}× export`, mixedError <= 3,
        `mean RGB difference ${mixedError.toFixed(3)}/255 with chromatic aberration and vignette`)
    }
    // Exact previous graph: bloom scratch resolution follows output density.
    for (const ratio of [0.25, 1]) {
      document.getElementById('summary')!.textContent = `Rendering previous bloom graph at ${WIDTH * ratio} × ${HEIGHT * ratio}…`
      await yieldFrame()
      renderer.setPixelRatio(ratio)
      renderer.setSize(WIDTH, HEIGHT, false)
      const composer = new EffectComposer(renderer)
      const renderPass = new RenderPass(source.scene, source.camera)
      const bloom = new UnrealBloomPass(new THREE.Vector2(WIDTH * ratio, HEIGHT * ratio), BLOOM.bloomStrength, BLOOM.bloomRadius, BLOOM.bloomThreshold)
      const output = new OutputPass()
      composer.addPass(renderPass)
      composer.addPass(bloom)
      composer.addPass(output)
      composer.setPixelRatio(ratio)
      composer.setSize(WIDTH, HEIGHT)
      try {
        composer.render(0)
        const frame = snapshot(renderer)
        legacy.set(ratio, frame)
        show(frame, `Previous graph: ${WIDTH * ratio} × ${HEIGHT * ratio}. Bloom changes with output density.`, 'legacy')
      } finally {
        renderPass.dispose()
        bloom.dispose()
        output.dispose()
        composer.dispose()
      }
      await yieldFrame()
    }
    const oldErrors = compareHalos(halo(frames.get(0.25)!.base, legacy.get(0.25)!), halo(frames.get(1)!.base, legacy.get(1)!))
    record('Negative control detects the previous resolution bug', oldErrors.energy > 0.12 || oldErrors.footprint > 0.15 || oldErrors.meanPixelError > 2.5, describe(oldErrors))
    await verifyDepthOfFieldBloom(renderer)
    await verifyBloomSampleBudgets(renderer)
  } finally {
    source.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
  const failed = checks.filter(check => !check.passed).length
  const summary = document.getElementById('summary')!
  summary.className = failed ? 'fail' : 'pass'
  summary.textContent = `${failed ? 'FAIL' : 'PASS'}: ${checks.length - failed}/${checks.length} real GPU checks passed; ${failed} failed.`
  document.title = `Bloom resolution: ${failed ? 'FAIL' : 'PASS'} ${checks.length - failed}/${checks.length}`
}

void run().catch(error => {
  record('Fixture execution', false, error instanceof Error ? error.message : String(error))
  const summary = document.getElementById('summary')!
  summary.className = 'fail'
  summary.textContent = `FAIL: fixture stopped — ${String(error)}`
})

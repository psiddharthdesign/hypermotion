// SPDX-License-Identifier: Apache-2.0
// Full production viewport, with an isolated in-memory scene and no storage.
import * as THREE from 'three'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { createRoot } from 'react-dom/client'
import { ThreeSceneViewport } from '../../src/render3d/ThreeSceneViewport'
import { SceneBloomPass } from '../../src/render3d/SceneBloomPass'
import { createSceneAPI } from '../../src/scene/doc'
import { DEFAULT_TEXT_ANIMATION } from '../../src/anim/textAnimations'
import type { AnimatedValue } from '../../src/anim'
import type { CameraNode } from '../../src/scene/types'
import type { SolvedLayout } from '../../src/layout'

const WIDTH = 3840
const HEIGHT = 2160
const RATIOS = [0.25, 1, 2]
type TargetReadback = { pixels: Float32Array; width: number; height: number; energy: number; peak: number; brightPixels: number }
type Capture = {
  ratio: number
  source?: TargetReadback
  bright?: TargetReadback
  glow?: TargetReadback
  mainTextures: Set<string>
  bloomTextures: Set<string>
  segmentDraws: Array<{ bloom: boolean; geometry: string; texture: string; vertices: number; visibleVertices: number; atlas: string }>
}
const captures: Capture[] = []
const checks: boolean[] = []
let activeCapture: Capture | null = null
const host = document.getElementById('root')!
host.innerHTML = `<style>
  body{margin:0;padding:24px;background:#11151d;color:#eaf0fa;font:14px system-ui}h1{font-size:23px;margin:0 0 12px}
  p{max-width:1050px;line-height:1.5;color:#c8d0dc}#status{font-weight:700;padding:12px 0;position:sticky;top:0;background:#11151d}
  #images{display:grid;grid-template-columns:repeat(4,minmax(180px,1fr));gap:12px}figure{margin:0}canvas{display:block;width:100%;height:auto;border:1px solid #354254}figcaption{padding:8px 0 16px;line-height:1.4}
  table{border-collapse:collapse;width:100%;margin-top:20px}th,td{padding:8px;text-align:left;border-bottom:1px solid #394353}.pass{color:#86e4ad}.fail{color:#ff9292}
  #live{position:fixed;left:-1200px;top:0;width:960px;height:540px}#live>div{position:absolute;inset:0}
  </style><h1>Bloom through the production texture pipeline</h1>
  <p>Native small text is magnified by a perspective camera with a long focal length and close focus. The actual ThreeSceneViewport selects and rasterizes its textures separately for 960px preview, 4K export, and 8K export. Depth of field uses 48 samples; bloom uses strength 4, radius 0, threshold 0.75.</p>
  <p>Each row shows the final frame, the canonical scene source, bright extraction, and isolated glow. Static small text and animated glyphs exercise both canvas rasters and segmented-text atlases. GPU readbacks must contain positive light and stay stable when final-render texture density changes.</p>
  <div id="status" role="status">Preparing isolated scene…</div><div id="images"></div>
  <table><thead><tr><th>Result</th><th>Check</th><th>Evidence</th></tr></thead><tbody id="results"></tbody></table><div id="live"></div>`

function check(name: string, passed: boolean, evidence: string) {
  checks.push(passed)
  const row = document.createElement('tr')
  row.className = passed ? 'pass' : 'fail'
  for (const text of [passed ? 'PASS' : 'FAIL', name, evidence]) {
    const cell = document.createElement('td')
    cell.textContent = text
    row.append(cell)
  }
  document.getElementById('results')!.append(row)
}

function display(canvas: HTMLCanvasElement, label: string) {
  const figure = document.createElement('figure')
  const caption = document.createElement('figcaption')
  caption.textContent = label
  figure.append(canvas, caption)
  document.getElementById('images')!.append(figure)
}

function readTarget(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): TargetReadback {
  const half = new Uint16Array(target.width * target.height * 4)
  renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, half)
  const pixels = new Float32Array(half.length)
  let energy = 0
  let peak = 0
  let brightPixels = 0
  for (let i = 0; i < half.length; i += 4) {
    for (let channel = 0; channel < 4; channel++) pixels[i + channel] = THREE.DataUtils.fromHalfFloat(half[i + channel])
    const light = pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722
    energy += light
    peak = Math.max(peak, light)
    if (light > 0.75) brightPixels++
  }
  return { pixels, width: target.width, height: target.height, energy, peak, brightPixels }
}

function targetCanvas(readback: TargetReadback) {
  const canvas = document.createElement('canvas')
  canvas.width = readback.width
  canvas.height = readback.height
  const context = canvas.getContext('2d')!
  const image = context.createImageData(canvas.width, canvas.height)
  const srgb = (linear: number) => 255 * (linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(Math.max(0, linear), 1 / 2.4) - 0.055)
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const source = (y * canvas.width + x) * 4
      const output = ((canvas.height - 1 - y) * canvas.width + x) * 4
      image.data[output] = srgb(readback.pixels[source])
      image.data[output + 1] = srgb(readback.pixels[source + 1])
      image.data[output + 2] = srgb(readback.pixels[source + 2])
      image.data[output + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return canvas
}

function compare(a: TargetReadback, b: TargetReadback) {
  if (a.width !== b.width || a.height !== b.height) return { error: Infinity, energy: Infinity }
  let error = 0
  for (let i = 0; i < a.pixels.length; i += 4) {
    error += Math.abs(a.pixels[i] - b.pixels[i]) + Math.abs(a.pixels[i + 1] - b.pixels[i + 1]) + Math.abs(a.pixels[i + 2] - b.pixels[i + 2])
  }
  return { error: error / (a.pixels.length / 4 * 3), energy: Math.abs(a.energy - b.energy) / Math.max(a.energy, b.energy, 1) }
}

const originalBloomRender = SceneBloomPass.prototype.render
SceneBloomPass.prototype.render = function (...args) {
  originalBloomRender.apply(this, args)
  if (!activeCapture) return
  const source = this.getScratchTargets().find(target => target.texture.userData.hyperMotionBloomSource === true)
  if (source) activeCapture.source = readTarget(args[0], source)
  activeCapture.bright = readTarget(args[0], this.renderTargetBright)
  activeCapture.glow = readTarget(args[0], this.renderTargetsHorizontal[0])
}

// RenderPass is a prototype method; WebGLRenderer.render is installed as an
// own-instance function and cannot be observed through its prototype. Wrap
// each actual scene pass, then inspect maps at the material's draw callback.
const originalSceneRender = RenderPass.prototype.render
RenderPass.prototype.render = function (...passArgs) {
  const restores: Array<() => void> = []
  const seen = new Set<THREE.Material>()
  if (activeCapture) this.scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof THREE.MeshBasicMaterial) || seen.has(material)) continue
      seen.add(material)
      const before = material.onBeforeRender
      material.onBeforeRender = function (...args) {
        before.apply(this, args)
        if (!activeCapture || !material.map) return
        const image = material.map.image as { width?: number; height?: number } | undefined
        const name = `${args[4].name || 'plane'}: ${image?.width ?? 0} × ${image?.height ?? 0}`
        const isBloom = args[0].getRenderTarget()?.texture.userData.hyperMotionBloomSource === true
        ;(isBloom ? activeCapture.bloomTextures : activeCapture.mainTextures).add(name)
        const geometry = args[3]
        const position = geometry.getAttribute('position')
        const opacity = geometry.getAttribute('hmOpacity')
        if (material.userData.hyperMotionTextSegmentShader && geometry.getAttribute('hmUvBounds') && position && opacity) {
          let visibleVertices = 0
          for (let i = 0; i < opacity.count; i++) if (opacity.getX(i) > 0.01) visibleVertices++
          activeCapture.segmentDraws.push({
            bloom: isBloom,
            geometry: geometry.uuid,
            texture: material.map.uuid,
            vertices: position.count,
            visibleVertices,
            atlas: `${image?.width ?? 0} × ${image?.height ?? 0}`,
          })
        }
      }
      restores.push(() => { material.onBeforeRender = before })
    }
  })
  try { originalSceneRender.apply(this, passArgs) } finally { restores.forEach(restore => restore()) }
}

const api = createSceneAPI()
api.setMeta({ name: 'Isolated bloom texture pipeline', duration: 2, canvas: { width: WIDTH, height: HEIGHT } })
const paint = (color: string) => ({ opacity: 1, fill: { kind: 'solid' as const, color }, stroke: null, cornerRadius: 0, effects: [] })
const rootId = api.createNode('frame', null, { name: 'Scene', size: { width: WIDTH, height: HEIGHT }, appearance: paint('#080b12'), clipsContent: false })
api.doc.getMap('scene').set('root', rootId)
const cardId = api.createNode('frame', rootId, { name: 'Small dashboard', size: { width: 440, height: 250 }, appearance: paint('#080b12'), clipsContent: false })
const layout: SolvedLayout = {
  [rootId]: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  [cardId]: { x: 1700, y: 955, width: 440, height: 250 },
}
for (const [index, text] of ['Dashboard', 'Transactions', 'Accounts', 'Investments', 'Categories', 'Recurring'].entries()) {
  const id = api.createNode('text', cardId, { name: text, text, fontFamily: 'Arial', fontSize: index === 2 ? 20 : 13, fontWeight: index === 2 ? 900 : 600, color: '#ffffff' })
  layout[id] = { x: 1770, y: 980 + index * 32, width: 280, height: 28 }
  const detail = api.createNode('text', cardId, { name: `${text} detail`, text: '$12,480.42   Updated now', fontFamily: 'Arial', fontSize: 6, fontWeight: 400, color: '#ffffff' })
  layout[detail] = { x: 1770, y: 1001 + index * 32, width: 260, height: 10 }
}
const textAnimation = {
  ...DEFAULT_TEXT_ANIMATION,
  id: 'blur-slide' as const,
  applyTo: 'letters' as const,
  duration: 0.8,
  delay: 0.04,
  blurRadius: 2,
  motionVector: { x: 0, y: 0.2, z: 1 },
}
// Keep this as a root sibling so the existing dashboard remains a flattened
// canvas plane and the animated text independently takes the atlas path.
const segmentedId = api.createNode('text', rootId, {
  name: 'Animated glyphs', text: 'MOTION', fontFamily: 'Arial', fontSize: 16,
  fontWeight: 800, color: '#ffffff', textAnimation,
})
layout[segmentedId] = { x: 1958, y: 1060, width: 110, height: 26 }
const animated: Record<string, AnimatedValue> = {
  [segmentedId]: { textProgress: 0.85, textTimelineProgress: 0.85, textAnimation },
}
const camera: CameraNode = {
  ...api.getActiveCamera()!,
  projection: 'perspective',
  transform: { ...api.getActiveCamera()!.transform, x: 1920, y: 1080, z: 9124, scaleX: 1, scaleY: 1, rotationX: 35.2643897, rotationY: -45, rotation: 60 },
  focalLength: 10000,
  fieldOfView: 2 * Math.atan(HEIGHT / 20000) * 180 / Math.PI,
  depthOfField: true,
  focusMode: 'plane',
  focusDistance: 876,
  aperture: 1,
  fStop: 1.4,
  blurLevel: 24,
  blurQuality: 48,
  dofPreviewQuality: 'high',
  bloomEnabled: true,
  bloomStrength: 4,
  bloomRadius: 0,
  bloomThreshold: 0.75,
}

async function run() {
  await document.fonts.ready
  const viewportHost = document.getElementById('live')!
  const root = createRoot(viewportHost)
  try {
    for (const ratio of RATIOS) {
      document.getElementById('status')!.textContent = `Rendering actual viewport at ${ratio}×…`
      const capture: Capture = { ratio, mainTextures: new Set(), bloomTextures: new Set(), segmentDraws: [] }
      activeCapture = capture
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error(`Viewport ${ratio}× did not acknowledge a frame`)), 30000)
        root.render(<ThreeSceneViewport key={ratio} api={api} layout={layout} animated={animated} camera={camera} cameraAnim={undefined}
          width={WIDTH} height={HEIGHT} sceneFill="#080b12" selectedIds={[]} showHelpers={false} showPlanes
          finalRender={ratio !== 0.25} cameraTransitions={false} renderPixelRatio={ratio} texturePixelRatio={ratio}
          playing={false} playhead={0} sceneVersion={1} exportable renderRequest={{ token: Math.round(ratio * 100), pass: 0 }}
          onFrameRendered={(_request, surface) => {
            window.clearTimeout(timeout)
            const canvas = document.createElement('canvas')
            canvas.width = 960
            canvas.height = 540
            canvas.getContext('2d')!.drawImage(surface, 0, 0, 960, 540)
            display(canvas, `${ratio}× final image — actual canvas ${surface.width} × ${surface.height}`)
            resolve()
          }} />)
      })
      captures.push(capture)
      for (const stage of ['source', 'bright', 'glow'] as const) {
        const readback = capture[stage]
        check(`${ratio}× ${stage} readback`, !!readback && Number.isFinite(readback.energy) && readback.energy > (stage === 'source' ? 100 : 1) && readback.peak > 0.01,
          readback ? `${readback.width} × ${readback.height}; linear energy ${readback.energy.toFixed(3)}; peak ${readback.peak.toFixed(5)}; pixels above 0.75: ${readback.brightPixels}` : 'Missing render target')
        if (readback) display(targetCanvas(readback), `${ratio}× ${stage}: energy ${readback.energy.toFixed(2)}, peak ${readback.peak.toFixed(3)}`)
      }
      check(`${ratio}× production texture draws observed`, capture.mainTextures.size > 0 && capture.bloomTextures.size > 0,
        `Main: ${[...capture.mainTextures].join('; ')}. Bloom: ${[...capture.bloomTextures].join('; ')}.`)
      const mainSegments = capture.segmentDraws.find(draw => !draw.bloom)
      const bloomSegments = capture.segmentDraws.find(draw => draw.bloom)
      check(`${ratio}× animated glyph atlas and geometry participate`, !!mainSegments && !!bloomSegments
        && mainSegments.vertices > 4 && bloomSegments.vertices > 4 && mainSegments.visibleVertices > 0 && bloomSegments.visibleVertices > 0
        && mainSegments.geometry !== bloomSegments.geometry && mainSegments.texture !== bloomSegments.texture,
      `Main: ${mainSegments?.vertices ?? 0} vertices, ${mainSegments?.visibleVertices ?? 0} visible, atlas ${mainSegments?.atlas ?? 'missing'}. Bloom: ${bloomSegments?.vertices ?? 0} vertices, ${bloomSegments?.visibleVertices ?? 0} visible, atlas ${bloomSegments?.atlas ?? 'missing'}. Separate geometry and texture: ${!!mainSegments && !!bloomSegments && mainSegments.geometry !== bloomSegments.geometry && mainSegments.texture !== bloomSegments.texture}.`)
      activeCapture = null
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }
    const reference = captures[0]
    for (const candidate of captures.slice(1)) {
      for (const stage of ['source', 'bright', 'glow'] as const) {
        const a = reference[stage]
        const b = candidate[stage]
        const errors = a && b ? compare(a, b) : { error: Infinity, energy: Infinity }
        check(`${stage} stable across actual texture density · ${candidate.ratio}×`, errors.error <= 0.002 && errors.energy <= 0.03,
          `Mean linear RGB difference ${errors.error.toFixed(6)}; energy difference ${(errors.energy * 100).toFixed(3)}%`)
      }
    }
    check('Integration exercises different main texture densities', [...reference.mainTextures].join('|') !== [...captures[1].mainTextures].join('|'),
      `Preview: ${[...reference.mainTextures].join('; ')}. Export: ${[...captures[1].mainTextures].join('; ')}.`)
  } finally {
    activeCapture = null
    root.unmount()
    SceneBloomPass.prototype.render = originalBloomRender
    RenderPass.prototype.render = originalSceneRender
    api.doc.destroy()
  }
  const passed = checks.filter(Boolean).length
  const status = document.getElementById('status')!
  status.className = passed === checks.length ? 'pass' : 'fail'
  status.textContent = `${passed === checks.length ? 'PASS' : 'FAIL'}: ${passed}/${checks.length} production texture checks passed.`
  document.title = `Bloom texture pipeline: ${passed === checks.length ? 'PASS' : 'FAIL'} ${passed}/${checks.length}`
}

void run().catch(error => {
  check('Fixture execution', false, String(error))
  document.getElementById('status')!.textContent = `FAIL: ${String(error)}`
})

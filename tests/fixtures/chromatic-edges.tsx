// SPDX-License-Identifier: Apache-2.0
// Isolated browser/GPU regression fixture. Never loads a document or storage.
import * as THREE from 'three'
import { renderToStaticMarkup } from 'react-dom/server'
import { CameraPostEffectsFallback } from '../../src/render/CameraPostEffectsFallback'
import { CHROMATIC_ABERRATION_SHADER, normalizeCameraPostEffects } from '../../src/render3d/postEffects'

const WIDTH = 128
const HEIGHT = 96
const ANGLES = [0, 45, 90, 135, -45]
const AMOUNTS = [0, 0.5, 4, 64]
const RATIOS = [1, 2]
type Artwork = 'gray' | 'opaque-card' | 'transparent-card'
type Rendered = { pixels: Uint8Array | Uint8ClampedArray; width: number; height: number }
type Check = { name: string; passed: boolean; detail: string }
const checks: Check[] = []
const host = document.getElementById('root')!
host.innerHTML = `
  <style>
    body { margin: 0; padding: 24px; background: #f4f5f8; color: #1d2735; font: 14px system-ui; }
    h1 { margin: 0 0 12px; font-size: 24px; }
    #summary { font-weight: 700; margin: 16px 0; }
    #examples { display: flex; flex-wrap: wrap; gap: 24px; margin: 24px 0; }
    figure { margin: 0; }
    figcaption { max-width: 256px; margin: 8px 0; }
    canvas { width: 256px; height: 192px; display: block; image-rendering: pixelated; border: 1px solid #b4bac2;
      background: repeating-conic-gradient(#eee 0% 25%, #ccc 0% 50%) 50% / 16px 16px; }
    table { border-collapse: collapse; width: 100%; background: white; }
    td, th { text-align: left; padding: 6px 10px; border-bottom: 1px solid #e0e3e8; }
    .pass { color: #176538; } .fail { color: #bc2525; }
  </style>
  <h1>Chromatic aberration: composition edges</h1>
  <p>Real WebGL production shader and actual DOM fallback filter. Pixel checks cover every frame pixel, including all four edges and corners, at 1× and 2× resolution.</p>
  <div id="summary" role="status">Running pixel checks…</div>
  <div id="examples"></div>
  <table><thead><tr><th>Result</th><th>Check</th><th>Pixel evidence</th></tr></thead><tbody id="results"></tbody></table>
`

function record(name: string, passed: boolean, detail: string) {
  checks.push({ name, passed, detail })
  const row = document.createElement('tr')
  row.className = passed ? 'pass' : 'fail'
  for (const value of [passed ? 'PASS' : 'FAIL', name, detail]) {
    const cell = document.createElement('td')
    cell.textContent = value
    row.append(cell)
  }
  document.getElementById('results')!.append(row)
}

function showExample(caption: string, rendered: Rendered) {
  const figure = document.createElement('figure')
  const canvas = document.createElement('canvas')
  canvas.width = rendered.width
  canvas.height = rendered.height
  const context = canvas.getContext('2d')!
  const image = context.createImageData(rendered.width, rendered.height)
  image.data.set(rendered.pixels)
  context.putImageData(image, 0, 0)
  const label = document.createElement('figcaption')
  label.textContent = caption
  figure.append(canvas, label)
  document.getElementById('examples')!.append(figure)
}

function sourcePixels(artwork: Artwork, ratio: number) {
  const width = WIDTH * ratio
  const height = HEIGHT * ratio
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = x >= 40 * ratio && x < 88 * ratio && y >= 24 * ratio && y < 72 * ratio
      const value = artwork !== 'gray' && inside ? 255 : artwork === 'transparent-card' ? 0 : 180
      const index = (y * width + x) * 4
      pixels.set([value, value, value, artwork === 'transparent-card' && !inside ? 0 : 255], index)
    }
  }
  return { pixels, width, height }
}

function verifyUniform(name: string, rendered: Rendered) {
  let maxChannelSpread = 0
  let minAlpha = 255
  let minChannel = 255
  let maxChannel = 0
  for (let index = 0; index < rendered.pixels.length; index += 4) {
    const channels = [rendered.pixels[index], rendered.pixels[index + 1], rendered.pixels[index + 2]]
    const lo = Math.min(...channels)
    const hi = Math.max(...channels)
    maxChannelSpread = Math.max(maxChannelSpread, hi - lo)
    minAlpha = Math.min(minAlpha, rendered.pixels[index + 3])
    minChannel = Math.min(minChannel, lo)
    maxChannel = Math.max(maxChannel, hi)
  }
  record(name, maxChannelSpread <= 1 && maxChannel - minChannel <= 1 && minChannel > 100 && minAlpha === 255,
    `RGB spread ${maxChannelSpread}; intensity ${minChannel}–${maxChannel}; minimum alpha ${minAlpha}`)
}

function pixelAt(rendered: Rendered, x: number, y: number) {
  const ratio = rendered.width / WIDTH
  const index = (Math.floor(y * ratio) * rendered.width + Math.floor(x * ratio)) * 4
  return Array.from(rendered.pixels.slice(index, index + 4))
}

function verifyCard(name: string, rendered: Rendered, transparent: boolean) {
  const leftFringe = pixelAt(rendered, 38, 48)
  const rightFringe = pixelAt(rendered, 90, 48)
  const center = pixelAt(rendered, 64, 48)
  const corner = pixelAt(rendered, 0, 0)
  const split = [leftFringe, rightFringe].every(pixel => Math.max(...pixel.slice(0, 3)) - Math.min(...pixel.slice(0, 3)) > 30)
  const alpha = center[3] === 255 && leftFringe[3] === 255 && rightFringe[3] === 255 && corner[3] === (transparent ? 0 : 255)
  record(name, split && alpha, `left ${leftFringe.join('/')}; right ${rightFringe.join('/')}; center alpha ${center[3]}; corner alpha ${corner[3]}`)
}

function createGpuRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true })
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  const uniforms = THREE.UniformsUtils.clone(CHROMATIC_ABERRATION_SHADER.uniforms)
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: CHROMATIC_ABERRATION_SHADER.vertexShader,
    fragmentShader: CHROMATIC_ABERRATION_SHADER.fragmentShader,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  })
  const scene = new THREE.Scene()
  const geometry = new THREE.PlaneGeometry(2, 2)
  scene.add(new THREE.Mesh(geometry, material))
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  return {
    render(artwork: Artwork, amount: number, angle: number, ratio: number): Rendered {
      const source = sourcePixels(artwork, ratio)
      const texture = new THREE.DataTexture(source.pixels, source.width, source.height, THREE.RGBAFormat)
      texture.minFilter = texture.magFilter = THREE.LinearFilter
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
      texture.needsUpdate = true
      const target = new THREE.WebGLRenderTarget(source.width, source.height, { depthBuffer: false, stencilBuffer: false })
      uniforms.tDiffuse.value = texture
      uniforms.hmResolution.value.set(WIDTH, HEIGHT)
      uniforms.hmAmountPx.value = amount
      uniforms.hmAngleRadians.value = THREE.MathUtils.degToRad(angle)
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
      const pixels = new Uint8Array(source.pixels.length)
      renderer.readRenderTargetPixels(target, 0, 0, source.width, source.height, pixels)
      renderer.setRenderTarget(null)
      texture.dispose()
      target.dispose()
      return { pixels, width: source.width, height: source.height }
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}

async function renderFallback(artwork: Artwork, amount: number, angle: number, ratio: number, bloom = false): Promise<Rendered> {
  const effects = normalizeCameraPostEffects({
    chromaticAberrationEnabled: true,
    chromaticAberrationAmount: amount,
    chromaticAberrationAngle: angle,
    bloomEnabled: bloom,
    bloomStrength: 0.5,
    bloomThreshold: 0.5,
  })
  const markup = renderToStaticMarkup(<CameraPostEffectsFallback effects={effects} width={WIDTH} height={HEIGHT}><span /></CameraPostEffectsFallback>)
  const parsed = new DOMParser().parseFromString(markup, 'text/html')
  const filter = parsed.querySelector('filter')
  const background = artwork === 'transparent-card' ? '' : `<rect width="${WIDTH}" height="${HEIGHT}" fill="#b4b4b4" />`
  const card = artwork === 'gray' ? '' : '<rect x="40" y="24" width="48" height="48" fill="white" />'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH * ratio}" height="${HEIGHT * ratio}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>${filter?.outerHTML ?? ''}</defs><g${filter ? ` filter="url(#${filter.id})"` : ''}>${background}${card}</g></svg>`
  const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.src = blobUrl
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = WIDTH * ratio
    canvas.height = HEIGHT * ratio
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    return { pixels: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height }
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

async function run() {
  const gpu = createGpuRenderer()
  try {
    for (const ratio of RATIOS) {
      for (const angle of ANGLES) {
        for (const amount of AMOUNTS) {
          verifyUniform(`WebGL opaque edges · ${ratio}× · ${angle}° · ${amount}px`, gpu.render('gray', amount, angle, ratio))
        }
      }
      for (const artwork of ['opaque-card', 'transparent-card'] as const) {
        const rendered = gpu.render(artwork, 4, 0, ratio)
        verifyCard(`WebGL interior fringe · ${ratio}× · ${artwork}`, rendered, artwork === 'transparent-card')
        if (ratio === 1) showExample(`WebGL: ${artwork}, 4px. Internal colored fringes remain.`, rendered)
      }
    }
    showExample('WebGL: uniform gray, 64px diagonal. Every edge remains neutral.', gpu.render('gray', 64, 45, 1))
  } finally {
    gpu.dispose()
  }
  for (const ratio of RATIOS) {
    for (const angle of ANGLES) {
      for (const amount of AMOUNTS) {
        const rendered = await renderFallback('gray', amount, angle, ratio)
        verifyUniform(`DOM fallback opaque edges · ${ratio}× · ${angle}° · ${amount}px`, rendered)
        if (ratio === 1 && angle === 45 && amount === 64) showExample('DOM fallback: uniform gray, 64px diagonal. Every edge remains neutral.', rendered)
      }
    }
    for (const artwork of ['opaque-card', 'transparent-card'] as const) {
      const rendered = await renderFallback(artwork, 4, 0, ratio)
      verifyCard(`DOM fallback interior fringe · ${ratio}× · ${artwork}`, rendered, artwork === 'transparent-card')
      if (ratio === 1) showExample(`DOM fallback: ${artwork}, 4px. Internal colored fringes remain.`, rendered)
    }
    verifyUniform(`DOM fallback bloom plus chromatic edges · ${ratio}×`, await renderFallback('gray', 4, 45, ratio, true))
  }
  const failed = checks.filter(check => !check.passed)
  const summary = document.getElementById('summary')!
  summary.className = failed.length ? 'fail' : 'pass'
  summary.textContent = `${failed.length ? 'FAIL' : 'PASS'}: ${checks.length - failed.length}/${checks.length} pixel checks passed; ${failed.length} failed.`
  document.title = `Chromatic edges: ${failed.length ? 'FAIL' : 'PASS'} ${checks.length - failed.length}/${checks.length}`
}

void run().catch(error => {
  record('Fixture execution', false, error instanceof Error ? error.message : String(error))
  document.getElementById('summary')!.textContent = `FAIL: fixture stopped — ${String(error)}`
})

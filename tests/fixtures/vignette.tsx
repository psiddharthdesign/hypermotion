// SPDX-License-Identifier: Apache-2.0
// Isolated production-renderer regression fixture. No scene document or storage.
import * as THREE from 'three'
import { renderToStaticMarkup } from 'react-dom/server'
import { CameraPostEffectsFallback } from '../../src/render/CameraPostEffectsFallback'
import { normalizeCameraPostEffects, VIGNETTE_SHADER } from '../../src/render3d/postEffects'

const WIDTH = 128
const HEIGHT = 96
const COLOR = 180
type Artwork = 'opaque' | 'alpha-bands'
type Settings = { amount?: number; size?: number; feather?: number; enabled?: boolean }
type Rendered = { pixels: Uint8Array | Uint8ClampedArray; width: number; height: number }
type Check = { name: string; passed: boolean; detail: string }
type Render = (artwork: Artwork, settings: Settings, ratio: number) => Rendered | Promise<Rendered>
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
    canvas { width: 256px; height: 192px; display: block; border: 1px solid #b4bac2;
      background: repeating-conic-gradient(#eee 0% 25%, #ccc 0% 50%) 50% / 16px 16px; }
    table { border-collapse: collapse; width: 100%; background: white; }
    td, th { text-align: left; padding: 6px 10px; border-bottom: 1px solid #e0e3e8; }
    .pass { color: #176538; } .fail { color: #bc2525; }
  </style>
  <h1>Camera vignette: rendered pixels</h1>
  <p>Production WebGL shader and serialized production DOM filter. Checks cover the center, all corners, control boundaries, transparency, and 1×/2× output consistency.</p>
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

function sourcePixels(artwork: Artwork, ratio: number): Rendered {
  const width = WIDTH * ratio
  const height = HEIGHT * ratio
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = artwork === 'opaque' ? 255 : x < 32 * ratio ? 0 : x < 96 * ratio ? 128 : 255
      const value = alpha ? COLOR : 0
      pixels.set([value, value, value, alpha], (y * width + x) * 4)
    }
  }
  return { pixels, width, height }
}

function pixelAt(rendered: Rendered, u: number, v: number): number[] {
  const x = Math.min(rendered.width - 1, Math.max(0, Math.floor(u * rendered.width)))
  const y = Math.min(rendered.height - 1, Math.max(0, Math.floor(v * rendered.height)))
  const index = (y * rendered.width + x) * 4
  return Array.from(rendered.pixels.slice(index, index + 4))
}

function maximumDifference(a: Rendered, b: Rendered, alphaOnly = false) {
  let max = 0
  for (let index = alphaOnly ? 3 : 0; index < a.pixels.length; index += alphaOnly ? 4 : 1) {
    max = Math.max(max, Math.abs(a.pixels[index] - b.pixels[index]))
  }
  return max
}

function createGpuRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true })
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  const uniforms = THREE.UniformsUtils.clone(VIGNETTE_SHADER.uniforms)
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VIGNETTE_SHADER.vertexShader,
    fragmentShader: VIGNETTE_SHADER.fragmentShader,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  })
  const scene = new THREE.Scene()
  const geometry = new THREE.PlaneGeometry(2, 2)
  scene.add(new THREE.Mesh(geometry, material))
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  return {
    render(artwork: Artwork, settings: Settings, ratio: number): Rendered {
      const source = sourcePixels(artwork, ratio)
      const texture = new THREE.DataTexture(source.pixels, source.width, source.height, THREE.RGBAFormat)
      texture.minFilter = texture.magFilter = THREE.NearestFilter
      texture.needsUpdate = true
      const target = new THREE.WebGLRenderTarget(source.width, source.height, { depthBuffer: false, stencilBuffer: false })
      uniforms.tDiffuse.value = texture
      uniforms.hmAmount.value = settings.enabled === false ? 0 : settings.amount ?? 0.35
      uniforms.hmSize.value = settings.size ?? 0.5
      uniforms.hmFeather.value = settings.feather ?? 0.5
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

async function renderFallback(artwork: Artwork, settings: Settings, ratio: number): Promise<Rendered> {
  const effects = normalizeCameraPostEffects({
    vignetteEnabled: settings.enabled ?? true,
    vignetteAmount: settings.amount,
    vignetteSize: settings.size,
    vignetteFeather: settings.feather,
  })
  const markup = renderToStaticMarkup(<CameraPostEffectsFallback effects={effects} width={WIDTH} height={HEIGHT}><span /></CameraPostEffectsFallback>)
  const parsed = new DOMParser().parseFromString(markup, 'text/html')
  const defs = Array.from(parsed.querySelectorAll('defs')).map(element => element.outerHTML).join('')
  const filter = Array.from(parsed.querySelectorAll('filter')).find(element => element.id.endsWith('-vignette'))
  if (effects.vignetteEnabled && effects.vignetteAmount > 0.001 && !filter) {
    throw new Error('Production DOM fallback did not expose its vignette filter.')
  }
  const artworkSvg = artwork === 'opaque'
    ? `<rect width="${WIDTH}" height="${HEIGHT}" fill="#b4b4b4" />`
    : `<rect x="32" width="64" height="${HEIGHT}" fill="#b4b4b4" fill-opacity="${128 / 255}" /><rect x="96" width="32" height="${HEIGHT}" fill="#b4b4b4" />`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH * ratio}" height="${HEIGHT * ratio}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${defs}<g${filter ? ` filter="url(#${filter.id})"` : ''}>${artworkSvg}</g></svg>`
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

async function verifyRenderer(name: string, render: Render) {
  const defaults: Rendered[] = []
  for (const ratio of [1, 2]) {
    const label = `${name} · ${ratio}×`
    const baseline = await render('opaque', { amount: 0 }, ratio)
    const normal = await render('opaque', {}, ratio)
    defaults.push(normal)
    const center = pixelAt(normal, 0.5, 0.5)
    const baselineCenter = pixelAt(baseline, 0.5, 0.5)
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => pixelAt(normal, u, v))
    record(`${label} · unchanged center`, Math.abs(center[0] - baselineCenter[0]) <= 1 && center[3] === 255,
      `center ${center.join('/')}; identity ${baselineCenter.join('/')}`)
    record(`${label} · darker symmetric corners`, corners.every(pixel => pixel[0] < center[0] - 20 && pixel[3] === 255) && Math.max(...corners.map(pixel => pixel[0])) - Math.min(...corners.map(pixel => pixel[0])) <= 2,
      `corner red ${corners.map(pixel => pixel[0]).join('/')}; center ${center[0]}`)
    const identityDifference = maximumDifference(baseline, sourcePixels('opaque', ratio))
    record(`${label} · zero amount is identity`, identityDifference <= 1, `maximum channel difference ${identityDifference}/255`)
    const disabled = await render('opaque', { enabled: false, amount: 1 }, ratio)
    const disabledDifference = maximumDifference(disabled, baseline)
    record(`${label} · disabled effect is identity`, disabledDifference <= 1, `maximum channel difference ${disabledDifference}/255`)

    const small = await render('opaque', { size: 0.25, feather: 0.25 }, ratio)
    const large = await render('opaque', { size: 0.75, feather: 0.25 }, ratio)
    const smallInner = pixelAt(small, 0.85, 0.5)[0]
    const largeInner = pixelAt(large, 0.85, 0.5)[0]
    record(`${label} · larger size widens clear center`, largeInner >= baselineCenter[0] - 1 && largeInner > smallInner + 20,
      `at 85% width: small ${smallInner}; large ${largeInner}; identity ${baselineCenter[0]}`)

    const hard = await render('opaque', { feather: 0 }, ratio)
    const hardCenter = pixelAt(hard, 0.5, 0.5)[0]
    const hardEdge = pixelAt(hard, 1, 0.5)[0]
    let opaqueCount = 0
    for (let index = 3; index < hard.pixels.length; index += 4) if (hard.pixels[index] === 255) opaqueCount++
    record(`${label} · zero feather renders finite hard edge`, Math.abs(hardCenter - baselineCenter[0]) <= 1 && hardEdge > 40 && hardEdge < hardCenter - 20 && opaqueCount === hard.width * hard.height,
      `center ${hardCenter}; outer midpoint ${hardEdge}; opaque pixels ${opaqueCount}/${hard.width * hard.height}`)

    const alphaBaseline = await render('alpha-bands', { amount: 0 }, ratio)
    const alphaVignette = await render('alpha-bands', {}, ratio)
    const alphaDifference = maximumDifference(alphaBaseline, alphaVignette, true)
    const samples = [pixelAt(alphaVignette, 0.1, 0.1)[3], pixelAt(alphaVignette, 0.5, 0.1)[3], pixelAt(alphaVignette, 0.9, 0.1)[3]]
    record(`${label} · transparent and partial alpha preserved`, alphaDifference === 0 && samples[0] === 0 && Math.abs(samples[1] - 128) <= 1 && samples[2] === 255,
      `maximum alpha change ${alphaDifference}; alpha bands ${samples.join('/')}`)
    if (ratio === 1) {
      showExample(`${name}: default vignette, amount .35 / size .5 / feather .5.`, normal)
      showExample(`${name}: transparent, half-opacity, and opaque bands.`, alphaVignette)
    }
  }

  const [one, two] = defaults
  let maxDifference = 0
  for (let y = 0; y < one.height; y++) {
    for (let x = 0; x < one.width; x++) {
      for (let channel = 0; channel < 4; channel++) {
        let average = 0
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          average += two.pixels[((y * 2 + dy) * two.width + x * 2 + dx) * 4 + channel] / 4
        }
        maxDifference = Math.max(maxDifference, Math.abs(one.pixels[(y * one.width + x) * 4 + channel] - average))
      }
    }
  }
  record(`${name} · resolution-independent mask`, maxDifference <= 3,
    `1× versus averaged 2× maximum channel difference ${maxDifference.toFixed(2)}/255`)
}

async function run() {
  const gpu = createGpuRenderer()
  try {
    await verifyRenderer('WebGL', gpu.render)
  } finally {
    gpu.dispose()
  }
  await verifyRenderer('DOM fallback', renderFallback)
  const failed = checks.filter(check => !check.passed)
  const summary = document.getElementById('summary')!
  summary.className = failed.length ? 'fail' : 'pass'
  summary.textContent = `${failed.length ? 'FAIL' : 'PASS'}: ${checks.length - failed.length}/${checks.length} pixel checks passed; ${failed.length} failed.`
  document.title = `Vignette: ${failed.length ? 'FAIL' : 'PASS'} ${checks.length - failed.length}/${checks.length}`
  document.documentElement.dataset.fixtureStatus = failed.length ? 'fail' : 'pass'
}

void run().catch(error => {
  record('Fixture execution', false, error instanceof Error ? error.message : String(error))
  document.getElementById('summary')!.textContent = `FAIL: fixture stopped — ${String(error)}`
  document.documentElement.dataset.fixtureStatus = 'fail'
})

// SPDX-License-Identifier: Apache-2.0
// Real production GPU + MP4 encoder regression, isolated from user documents.
import * as THREE from 'three'
import type { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { ScenePostEffectsRenderer, normalizeCameraPostEffects, cameraVignetteMultiplier } from '../../src/render3d/postEffects'
import { createMp4Encoder } from '../../src/export/encodeMp4'

const WIDTH = 3840
const HEIGHT = 2160
const SETTINGS = { vignetteEnabled: true, vignetteAmount: 0.36854242, vignetteSize: 0.37904226, vignetteFeather: 0.42938531 }
const EFFECTS = normalizeCameraPostEffects(SETTINGS)
type Snapshot = { canvas: HTMLCanvasElement; pixels: Uint8ClampedArray; width: number; height: number }
const checks: { name: string; passed: boolean }[] = []
const blobUrls: string[] = []
const root = document.getElementById('root')!
root.innerHTML = `
<style>
body { margin:0; padding:24px; color:#eee; background:#141820; font:14px system-ui; }
h1 { font-size:24px; margin:0 0 12px; } p { max-width:1100px; line-height:1.5; }
#summary { position:sticky; top:0; background:#141820; padding:12px 0; font-weight:700; }
#images,#videos { display:grid; grid-template-columns:repeat(2,minmax(280px,1fr)); gap:20px; }
figure { margin:0; } canvas,video { width:100%; height:auto; display:block; }
figcaption { line-height:1.5; margin:10px 0; } a { color:#81c8ff; margin-right:16px; }
table { border-collapse:collapse; margin-top:24px; width:100%; } th,td { text-align:left; border-bottom:1px solid #37404c; padding:8px; }
.pass {color:#84dea6} .fail {color:#ff9a9a}
</style>
<h1>Vignette: dark gradient and 4K60 MP4 regression</h1>
<p>Real production post-processing on #171717 at 960×540 and 3840×2160. The previous shader is reproduced by setting only its final dithering amplitude to zero. Both use the same linear-light vignette and sRGB output. Downloads retain native resolution.</p>
<div id="summary" role="status">Running GPU checks…</div>
<div id="downloads"></div><div id="images"></div><div id="videos"></div>
<table><thead><tr><th>Result</th><th>Check</th><th>Evidence</th></tr></thead><tbody id="results"></tbody></table>`

function record(name: string, passed: boolean, detail: string) {
  checks.push({ name, passed })
  const tr = document.createElement('tr')
  tr.className = passed ? 'pass' : 'fail'
  for (const value of [passed ? 'PASS' : 'FAIL', name, detail]) {
    const td = document.createElement('td'); td.textContent = value; tr.append(td)
  }
  document.getElementById('results')!.append(tr)
}

function snapshot(canvas: HTMLCanvasElement, renderer?: THREE.WebGLRenderer): Snapshot {
  const copy = document.createElement('canvas')
  copy.width = canvas.width; copy.height = canvas.height
  const context = copy.getContext('2d', { willReadFrequently: true })!
  context.drawImage(canvas, 0, 0)
  let pixels = context.getImageData(0, 0, copy.width, copy.height).data
  if (renderer) {
    // Compare the actual GPU output; a Canvas2D copy may introduce a separate
    // browser color-conversion/readback step unrelated to the effect shader.
    const gl = renderer.getContext()
    const raw = new Uint8Array(copy.width * copy.height * 4)
    gl.readPixels(0, 0, copy.width, copy.height, gl.RGBA, gl.UNSIGNED_BYTE, raw)
    pixels = new Uint8ClampedArray(raw.length)
    const rowBytes = copy.width * 4
    for (let y = 0; y < copy.height; y++) {
      pixels.set(raw.subarray(y * rowBytes, (y + 1) * rowBytes), (copy.height - 1 - y) * rowBytes)
    }
  }
  return { canvas: copy, pixels, width: copy.width, height: copy.height }
}

function maxDiff(a: Snapshot, b: Snapshot, alphaOnly = false) {
  let difference = 0
  for (let i = alphaOnly ? 3 : 0; i < a.pixels.length; i += alphaOnly ? 4 : 1) difference = Math.max(difference, Math.abs(a.pixels[i] - b.pixels[i]))
  return difference
}

function render(ratio: number, legacy: boolean, alpha = 1) {
  const renderer = new THREE.WebGLRenderer({ antialias:false, alpha:true, preserveDrawingBuffer:true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setPixelRatio(ratio); renderer.setSize(WIDTH, HEIGHT, false)
  renderer.setClearColor('#000000', 0)
  const scene = new THREE.Scene()
  const geometry = new THREE.PlaneGeometry(2, 2)
  const material = new THREE.MeshBasicMaterial({ color:'#171717', opacity:alpha, transparent:true, depthTest:false, depthWrite:false })
  scene.add(new THREE.Mesh(geometry, material))
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2)
  camera.position.z = 1
  const post = new ScenePostEffectsRenderer(renderer, scene, camera, WIDTH, HEIGHT, ratio)
  if (legacy) {
    const pass = (post as unknown as { vignettePass: ShaderPass }).vignettePass
    pass.uniforms.hmDitherAmplitude.value = 0

  }
  post.configure(EFFECTS, WIDTH, HEIGHT, ratio, 1.5)
  post.render()
  const first = snapshot(renderer.domElement, renderer)
  post.configure(EFFECTS, WIDTH, HEIGHT, ratio, 6.5)
  post.render()
  const repeat = snapshot(renderer.domElement, renderer)
  post.configure(normalizeCameraPostEffects({ ...SETTINGS, vignetteAmount:0 }), WIDTH, HEIGHT, ratio, 1.5)
  post.render()
  const disabled = snapshot(renderer.domElement, renderer)
  post.dispose(); geometry.dispose(); material.dispose(); renderer.dispose(); renderer.forceContextLoss()
  return { first, repeat, disabled }
}

function linearToSrgb(value: number) { return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055 }
const LINEAR_COLOR = new THREE.Color('#171717').r
function expectedAt(u: number, v: number) {
  return 255 * linearToSrgb(LINEAR_COLOR * cameraVignetteMultiplier(Math.hypot((u - 0.5) * 2, (v - 0.5) * 2) / Math.SQRT2, EFFECTS))
}

function gradientMetrics(frame: Snapshot) {
  // Across a shallow diagonal near the top-left corner: long quantization bands
  // dominate the old output. Rows independently measure runs so spatial dither
  // must actually break the contours rather than merely smooth a plotted mean.
  const runs: number[] = []
  let squaredError = 0; let blocks = 0; let bias = 0
  for (let y = Math.floor(frame.height * 0.04); y < frame.height * 0.30; y += Math.max(1, Math.floor(frame.height / 60))) {
    let value = -1; let count = 0
    for (let x = Math.floor(frame.width * 0.02); x < frame.width * 0.35; x++) {
      const radius = Math.hypot(((x + 0.5) / frame.width - 0.5) * 2, ((y + 0.5) / frame.height - 0.5) * 2) / Math.SQRT2
      if (radius <= EFFECTS.vignetteSize + 0.03 || radius >= EFFECTS.vignetteSize + EFFECTS.vignetteFeather - 0.03) {
        if (count) runs.push(count)
        value = -1; count = 0
        continue
      }
      const current = frame.pixels[(y * frame.width + x) * 4]
      if (current === value) count++
      else { if (count) runs.push(count); count = 1; value = current }
    }
    if (count) runs.push(count)
  }
  const blockSize = Math.max(8, Math.round(frame.width / 120))
  for (let y = blockSize; y < frame.height * 0.35 - blockSize; y += blockSize) {
    for (let x = blockSize; x < frame.width * 0.4 - blockSize; x += blockSize) {
      let actual = 0; let expected = 0
      for (let dy = 0; dy < blockSize; dy++) for (let dx = 0; dx < blockSize; dx++) {
        actual += frame.pixels[((y + dy) * frame.width + x + dx) * 4]
        expected += expectedAt((x + dx + 0.5) / frame.width, (y + dy + 0.5) / frame.height)
      }
      const error = (actual - expected) / (blockSize * blockSize)
      squaredError += error * error; bias += error; blocks++
    }
  }
  runs.sort((a, b) => a - b)
  return { longestRun: runs.at(-1)!, p95Run: runs[Math.floor(runs.length * 0.95)], meanRun: runs.reduce((sum, run) => sum + run, 0) / runs.length,
    blockRmse: Math.sqrt(squaredError / blocks), bias: bias / blocks, count: runs.length }
}

function centerDifference(a: Snapshot, b: Snapshot) {
  let difference = 0
  for (let y = Math.floor(a.height * 0.45); y < a.height * 0.55; y++) for (let x = Math.floor(a.width * 0.45); x < a.width * 0.55; x++) {
    for (let c = 0; c < 4; c++) difference = Math.max(difference, Math.abs(a.pixels[(y * a.width + x) * 4 + c] - b.pixels[(y * a.width + x) * 4 + c]))
  }
  return difference
}

function metricsText(metrics: ReturnType<typeof gradientMetrics>) { return `longest/p95/mean runs ${metrics.longestRun}/${metrics.p95Run}/${metrics.meanRun.toFixed(2)} px; local mean RMSE ${metrics.blockRmse.toFixed(4)}, bias ${metrics.bias.toFixed(4)} /255` }
function download(blob: Blob, name: string, label: string) {
  const url = URL.createObjectURL(blob); blobUrls.push(url)
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.textContent = label
  document.getElementById('downloads')!.append(anchor)
  return url
}
async function show(frame: Snapshot, caption: string, filename: string) {
  const figure = document.createElement('figure'); const label = document.createElement('figcaption')
  label.textContent = caption; figure.append(frame.canvas, label); document.getElementById('images')!.append(figure)
  const blob = await new Promise<Blob>((resolve, reject) => frame.canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG failed')), 'image/png'))
  download(blob, filename, caption + ' PNG')
}

async function encodeAndDecode(frame: Snapshot, name: string, preserveGradients = false) {
  const encoder = await createMp4Encoder({ width: WIDTH, height: HEIGHT, fps:60, preserveGradients })
  for (let index = 0; index < 12; index++) await encoder.addFrame(frame.canvas, index)
  const blob = await encoder.finish()
  const url = download(blob, `vignette-${name}-4k60.mp4`, `${name} 4K60 MP4`)
  const video = document.createElement('video')
  video.controls = true; video.muted = true; video.preload = 'auto'
  const loaded = new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error(`MP4 decode failed ${video.error?.message}`)) })
  video.src = url
  document.getElementById('videos')!.append(video)
  await loaded
  const seeked = new Promise<void>(resolve => { video.onseeked = () => resolve() })
  video.currentTime = 8 / 60
  await seeked
  const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT
  canvas.getContext('2d')!.drawImage(video, 0, 0)
  return { frame: snapshot(canvas), bytes: blob.size, width: video.videoWidth, height:video.videoHeight, duration:video.duration }
}

async function run() {
  const results: { ratio: number; old: Snapshot; current: Snapshot }[] = []
  for (const ratio of [0.25, 1]) {
    const old = render(ratio, true)
    const current = render(ratio, false)
    const oldMetrics = gradientMetrics(old.first); const metrics = gradientMetrics(current.first)
    record(`${ratio}× · original shader exposes quantization bands`, oldMetrics.p95Run > 15 && oldMetrics.blockRmse > 0.15, metricsText(oldMetrics))
    record(`${ratio}× · dither breaks contour bands`, metrics.meanRun < oldMetrics.meanRun * 0.35 && metrics.p95Run < oldMetrics.p95Run * 0.4, `old: ${metricsText(oldMetrics)}; current: ${metricsText(metrics)}`)
    record(`${ratio}× · local mean follows analytic vignette`, metrics.blockRmse < oldMetrics.blockRmse * 0.7 && Math.abs(metrics.bias) < 0.1, metricsText(metrics))
    record(`${ratio}× · center untouched`, centerDifference(current.first, old.first) === 0 && centerDifference(current.first, current.disabled) <= 1, `dither versus old vignette: ${centerDifference(current.first, old.first)}; neutral OutputPass conversion rounding: ${centerDifference(current.first, current.disabled)} /255`)
    record(`${ratio}× · no animated noise or flicker`, maxDiff(current.first, current.repeat) === 0, `maximum RGBA difference at 1.5s / 6.5s: ${maxDiff(current.first, current.repeat)}`)
    record(`${ratio}× · opaque alpha preserved`, maxDiff(current.first, current.disabled, true) === 0, `maximum alpha difference ${maxDiff(current.first, current.disabled, true)}`)
    results.push({ ratio, old:old.first, current:current.first })
  }
  for (const alpha of [0, 0.5]) {
    const image = render(0.25, false, alpha)
    record(`alpha ${alpha} · transparency preserved`, maxDiff(image.first, image.disabled, true) === 0, `maximum alpha difference ${maxDiff(image.first, image.disabled, true)}`)
  }
  const full = results[1]
  await show(full.old, 'Previous: quantized dark gradient', 'vignette-before-4k.png')
  await show(full.current, 'Current: dithered dark gradient', 'vignette-after-4k.png')
  document.getElementById('summary')!.textContent = 'GPU checks complete. Encoding and decoding real 4K60 H.264 MP4…'
  const before = await encodeAndDecode(full.old, 'before')
  const ditherOnly = await encodeAndDecode(full.current, 'dither-only')
  const after = await encodeAndDecode(full.current, 'after', true)
  const beforeMetrics = gradientMetrics(before.frame)
  const ditherMetrics = gradientMetrics(ditherOnly.frame)
  const afterMetrics = gradientMetrics(after.frame)
  record('Negative control · shader dither alone is lost during video compression', ditherMetrics.p95Run > 100,
    `Legacy bitrate-controlled encoder with fixed dithering: ${metricsText(ditherMetrics)}`)
  record('Production MP4 · actual 4K60 encode/decode', after.width === WIDTH && after.height === HEIGHT && Math.abs(after.duration - 0.2) < 0.002,
    `12 frames/60fps; dimensions ${after.width}×${after.height}; duration ${after.duration}s; sizes ${before.bytes}/${after.bytes} bytes`)
  record('Production MP4 · fewer contour bands after compression', afterMetrics.meanRun < beforeMetrics.meanRun * 0.2 && afterMetrics.p95Run < beforeMetrics.p95Run * 0.1,
    `before: ${metricsText(beforeMetrics)}; after: ${metricsText(afterMetrics)}`)
  record('Production MP4 · dark gradient brightness retained', Math.abs(afterMetrics.bias - beforeMetrics.bias) < 0.5,
    `decoded local-mean bias: before ${beforeMetrics.bias.toFixed(4)}, after ${afterMetrics.bias.toFixed(4)} /255`)
  const failed = checks.filter(check => !check.passed)
  document.getElementById('summary')!.textContent = `${failed.length ? 'FAIL' : 'PASS'}: ${checks.length - failed.length}/${checks.length} checks. Downloads are native 4K PNG and 4K60 MP4.`
  document.title = `Vignette banding: ${failed.length ? 'FAIL' : 'PASS'} ${checks.length - failed.length}/${checks.length}`
  document.documentElement.dataset.fixtureStatus = failed.length ? 'fail' : 'pass'
}
void run().catch(error => {
  record('Fixture execution', false, error instanceof Error ? error.stack ?? error.message : String(error))
  document.getElementById('summary')!.textContent = `FAIL: ${String(error)}`
  document.documentElement.dataset.fixtureStatus = 'fail'
})
window.addEventListener('beforeunload', () => blobUrls.forEach(url => URL.revokeObjectURL(url)))

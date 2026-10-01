// SPDX-License-Identifier: Apache-2.0
// Real production viewport with isolated in-memory documents. Never persists.
import { createRoot } from 'react-dom/client'
import { createSceneAPI } from '../../src/scene/doc'
import type { CameraNode, NodeId } from '../../src/scene/types'
import { ISOMETRIC_CAMERA_VIEWS } from '../../src/scene/cameraProjection'
import { solveLayout, yogaReady } from '../../src/layout/engine'
import { ThreeSceneViewport } from '../../src/render3d/ThreeSceneViewport'
import { getAnimEngine, type AnimatedValue } from '../../src/anim'
import { addKeyframe } from '../../src/anim/tracks'
import { createIsometricAsset } from '../../src/ui/isometricAssetAuthoring'
import { applyIsometricLoop } from '../../src/ui/isometricLoopAuthoring'

const WIDTH = 960
const HEIGHT = 540
const BACKGROUND = '#F2F5FB'
const checks: boolean[] = []
const host = document.getElementById('root')!
host.innerHTML = `<style>
body{margin:0;padding:24px;background:#111823;color:#eaf1fb;font:14px system-ui}h1{font-size:24px;margin:0 0 12px}h2{font-size:18px;margin:24px 0 12px}p{max-width:1000px;color:#c6d0df;line-height:1.5}
#status{position:sticky;top:0;padding:12px 0;background:#111823;font-weight:700}#views,#motion,#occlusion{display:grid;grid-template-columns:repeat(3,minmax(210px,1fr));gap:12px}figure{margin:0}canvas{display:block;width:100%;height:auto;border:1px solid #3a475b}figcaption{padding:6px 0 12px;font-size:12px}table{border-collapse:collapse;width:100%;margin-top:20px}td,th{padding:8px;text-align:left;border-bottom:1px solid #344157}.pass{color:#80dfaa}.fail{color:#ff9090}#live{position:fixed;left:-1300px;top:0;width:960px;height:540px}#live>div{position:absolute;inset:0}
</style><h1>Isometric assets: real renderer checks</h1><p>Editable blocks, circular platforms and server modules render through ThreeSceneViewport. Each of the four orthographic views compares depth enabled, flattened shapes, and a 3840 × 2160 final render reduced to preview size. Animation checks use the actual keyframe engine for camera movement, extrusion depth, and complete motion loops.</p>
<div id="status" role="status">Preparing isolated scene…</div><h2>Four views — solids, flat comparison, 4K export</h2><div id="views"></div><h2>Camera, depth, and editable loop animation</h2><div id="motion"></div><h2>Depth occlusion independent of layer order</h2><div id="occlusion"></div><table><thead><tr><th>Result</th><th>Check</th><th>Pixel evidence</th></tr></thead><tbody id="results"></tbody></table><div id="live"></div>`

type Capture = { canvas: HTMLCanvasElement; pixels: Uint8ClampedArray }
function record(name: string, passed: boolean, evidence: string) {
  checks.push(passed)
  const row = document.createElement('tr')
  row.className = passed ? 'pass' : 'fail'
  for (const text of [passed ? 'PASS' : 'FAIL', name, evidence]) {
    const cell = document.createElement('td'); cell.textContent = text; row.append(cell)
  }
  document.getElementById('results')!.append(row)
}
function show(capture: Capture, caption: string, group: string) {
  const figure = document.createElement('figure')
  const label = document.createElement('figcaption')
  label.textContent = caption
  const download = document.createElement('a')
  download.textContent = 'Save image'
  download.href = capture.canvas.toDataURL('image/png')
  download.download = `isometric-${group}-${document.getElementById(group)!.children.length + 1}.png`
  download.style.cssText = 'display:block;color:#9ecbff;font-size:11px;margin-bottom:12px'
  figure.append(capture.canvas, label, download)
  document.getElementById(group)!.append(figure)
}
function bluePixels(capture: Capture) {
  let count = 0
  for (let i = 0; i < capture.pixels.length; i += 4) if (capture.pixels[i + 2]! - capture.pixels[i]! > 35 && capture.pixels[i]! < 210) count++
  return count
}
function difference(a: Capture, b: Capture) {
  let total = 0
  let changed = 0
  for (let i = 0; i < a.pixels.length; i += 4) {
    const delta = Math.abs(a.pixels[i]! - b.pixels[i]!) + Math.abs(a.pixels[i + 1]! - b.pixels[i + 1]!) + Math.abs(a.pixels[i + 2]! - b.pixels[i + 2]!)
    total += delta
    if (delta > 30) changed++
  }
  return { mean: total / (WIDTH * HEIGHT * 3), changed }
}

const api = createSceneAPI()
api.setMeta({ name: 'Isolated isometric assets', duration: 4, frameRate: 60, canvas: { width: WIDTH, height: HEIGHT } })
const rootId = api.createNode('frame', null, {
  name: 'Scene', size: { width: WIDTH, height: HEIGHT }, clipsContent: false,
  appearance: { opacity: 1, fill: null, stroke: null, cornerRadius: 0, effects: [] },
})
const block = createIsometricAsset(api, 'block', { center: { x: 270, y: 320 } })
const platform = createIsometricAsset(api, 'platform', { center: { x: 470, y: 220 } })
const server = createIsometricAsset(api, 'server', { center: { x: 640, y: 330 } })
const bodyIds = api.getAllNodeIds().filter((id) => api.getNode(id)?.extrusion !== undefined)
const cameraId = api.getActiveCamera()!.id
api.setNodeProperty(cameraId, 'projection', 'orthographic')
api.setNodeProperty(cameraId, 'transform', {
  ...api.getActiveCamera()!.transform,
  x: WIDTH / 2, y: HEIGHT / 2, z: 0, scaleX: 1.3, scaleY: 1.3,
  ...ISOMETRIC_CAMERA_VIEWS[0].rotation,
})
const housing = api.getChildren(api.getChildren(server)[0]!.id)[0]!.id
applyIsometricLoop(api, [block], { kind: 'float', startTime: 0, duration: 4, amplitude: 64 })
applyIsometricLoop(api, [platform], { kind: 'spin', startTime: 0, duration: 4 })
for (const [time, value] of [[0, 96], [2, 180], [4, 96]]) addKeyframe(api, housing, 'extrusion.depth', time!, value!)
for (const [time, value] of [[0, 45], [2, 75], [4, 45]]) addKeyframe(api, cameraId, 'transform.rotationY', time!, value!)

async function run() {
  await document.fonts.ready
  const yoga = await yogaReady
  const layout = solveLayout(yoga, api, rootId, { width: WIDTH, height: HEIGHT })
  const root = createRoot(document.getElementById('live')!)
  let token = 0
  let version = 1
  const capture = (camera: CameraNode, animated: Record<NodeId, AnimatedValue>, ratio = 1, time = 0, hiddenNodeIds: NodeId[] = []) => new Promise<Capture>((resolve, reject) => {
    const request = { token: ++token, pass: 0 }
    const timeout = window.setTimeout(() => reject(new Error(`No GPU frame for request ${request.token}`)), 30000)
    root.render(<ThreeSceneViewport api={api} layout={layout} animated={animated} camera={camera} cameraAnim={animated[camera.id]}
      width={WIDTH} height={HEIGHT} sceneFill={BACKGROUND} selectedIds={[]} showHelpers={false} showPlanes
      hiddenNodeIds={hiddenNodeIds} cameraTransitions={false} finalRender={ratio > 1} renderPixelRatio={ratio} texturePixelRatio={ratio}
      playing={false} playhead={time} sceneVersion={version} exportable renderRequest={request}
      onFrameRendered={(rendered, surface) => {
        if (rendered.token !== request.token) return
        window.clearTimeout(timeout)
        if (surface.width !== WIDTH * ratio || surface.height !== HEIGHT * ratio) {
          reject(new Error(`Expected ${WIDTH * ratio} × ${HEIGHT * ratio}, received ${surface.width} × ${surface.height}`))
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = WIDTH; canvas.height = HEIGHT
        const context = canvas.getContext('2d', { willReadFrequently: true })!
        context.drawImage(surface, 0, 0, WIDTH, HEIGHT)
        resolve({ canvas, pixels: context.getImageData(0, 0, WIDTH, HEIGHT).data })
      }} />)
  })
  try {
    for (const view of ISOMETRIC_CAMERA_VIEWS) {
      document.getElementById('status')!.textContent = `Rendering ${view.label}…`
      const camera = { ...api.getActiveCamera()!, transform: { ...api.getActiveCamera()!.transform, ...view.rotation } }
      const solid = await capture(camera, {})
      const flat = await capture(camera, Object.fromEntries(bodyIds.map((id) => [id, { extrusionDepth: 0 }])))
      const exported = await capture(camera, {}, 4)
      show(solid, `${view.label} · native solids`, 'views')
      show(flat, `${view.label} · depth 0 comparison`, 'views')
      show(exported, `${view.label} · 4K final render`, 'views')
      const solidPixels = bluePixels(solid), flatPixels = bluePixels(flat)
      record(`${view.label}: closed solid faces remain visible`, solidPixels > flatPixels + 1000 && solidPixels > 5000, `${solidPixels} blue solid pixels vs ${flatPixels} flattened; added ${solidPixels - flatPixels}`)
      const parity = difference(solid, exported)
      record(`${view.label}: preview / 4K parity`, parity.mean < 2, `Mean RGB difference ${parity.mean.toFixed(4)}/255; ${parity.changed} edge/detail pixels differ > 30 summed RGB`)
    }
    const engine = getAnimEngine()
    engine.attach(api)
    const frames: Capture[] = []
    for (const time of [0, 1, 2, 3, 4]) {
      engine.seek(time)
      const frame = await capture(api.getActiveCamera()!, engine.getSnapshot(), 1, time)
      frames.push(frame)
      show(frame, `Animated camera + float + extrusion · ${time}s`, 'motion')
    }
    const middle = difference(frames[0]!, frames[2]!)
    const closed = difference(frames[0]!, frames[4]!)
    record('Camera, depth, and motion keys change the rendered scene', middle.changed > 10000, `${middle.changed} changed pixels at the midpoint`)
    record('Complete loop returns to exactly the same rendered pose', closed.mean < 0.05, `Mean start/end RGB difference ${closed.mean.toFixed(6)}/255`)
    engine.seek(2)
    const animatedExport = await capture(api.getActiveCamera()!, engine.getSnapshot(), 4, 2)
    show(animatedExport, 'Animated midpoint · 4K final render', 'motion')
    const motionParity = difference(frames[2]!, animatedExport)
    record('Animated extrusion and camera preserve preview / final parity', motionParity.mean < 2, `Mean RGB difference ${motionParity.mean.toFixed(4)}/255`)
    const effectsCamera = {
      ...api.getActiveCamera()!, bloomEnabled: true, bloomStrength: 1.5, bloomRadius: 0.3, bloomThreshold: 0.75,
      vignetteEnabled: true, vignetteAmount: 0.45, vignetteSize: 0.5, vignetteFeather: 0.5,
    }
    const effectsPreview = await capture(effectsCamera, engine.getSnapshot(), 1, 2)
    const effectsExport = await capture(effectsCamera, engine.getSnapshot(), 4, 2)
    show(effectsPreview, 'Animated solids + bloom + vignette · preview', 'motion')
    show(effectsExport, 'Animated solids + bloom + vignette · 4K final', 'motion')
    const effectChange = difference(frames[2]!, effectsPreview)
    const effectParity = difference(effectsPreview, effectsExport)
    record('Bloom and vignette actually affect solid assets', effectChange.mean > 1, `Mean RGB change ${effectChange.mean.toFixed(4)}/255`)
    record('Bloom and vignette preserve preview / final parity on solids', effectParity.mean < 2, `Mean RGB difference ${effectParity.mean.toFixed(4)}/255`)
    engine.pause()

    // Deliberately add the farther object last: depth must defeat paint order.
    const front = createIsometricAsset(api, 'block', { center: { x: 480, y: 270 } })
    const back = createIsometricAsset(api, 'block', { center: { x: 480, y: 270 } })
    const frontBody = api.getChildren(front)[0]!.id
    const backBody = api.getChildren(back)[0]!.id
    api.setNodeProperty(frontBody, 'appearance', { ...api.getNode(frontBody)!.appearance, fill: { kind: 'solid', color: '#0969D9' } })
    api.setNodeProperty(backBody, 'appearance', { ...api.getNode(backBody)!.appearance, fill: { kind: 'solid', color: '#EE5533' } })
    api.setNodeProperty(back, 'transform', { ...api.getNode(back)!.transform, z: 140 })
    Object.assign(layout, solveLayout(yoga, api, rootId, { width: WIDTH, height: HEIGHT }))
    const flatCamera = { ...api.getActiveCamera()!, transform: { ...api.getActiveCamera()!.transform, rotationX: 0, rotationY: 0, rotation: 0 } }
    const descendants = (id: string): string[] => [id, ...api.getChildren(id).flatMap((node) => descendants(node.id))]
    const hidden = [block, platform, server].flatMap(descendants)
    version++
    const before = await capture(flatCamera, {}, 1, 0, hidden)
    show(before, 'Near blue block created before far orange block', 'occlusion')
    api.moveChild(rootId, front, api.getChildren(rootId).length - 1)
    version++
    const after = await capture(flatCamera, {}, 1, 0, hidden)
    show(after, 'Same blocks, layer order reversed', 'occlusion')
    const centerIndex = (270 * WIDTH + 480) * 4
    const rgb = before.pixels.slice(centerIndex, centerIndex + 3)
    const orderDifference = difference(before, after)
    record('Near solid hides farther solid regardless of layer order', rgb[2]! > rgb[0]! + 100 && orderDifference.mean < 0.05, `Center RGB ${[...rgb].join(', ')}; reorder RGB difference ${orderDifference.mean.toFixed(6)}/255`)
    const transparent = await capture(flatCamera, { [frontBody]: { opacity: 0 } }, 1, 0, hidden)
    show(transparent, 'Near solid opacity 0 reveals the orange block', 'occlusion')
    const transparentRgb = transparent.pixels.slice(centerIndex, centerIndex + 3)
    record('A transparent solid does not leave an invisible depth blocker', transparentRgb[0]! > transparentRgb[2]! + 100, `Center RGB ${[...transparentRgb].join(', ')}`)
  } finally {
    getAnimEngine().pause()
    root.unmount()
    api.doc.destroy()
  }
  const passed = checks.filter(Boolean).length
  const status = document.getElementById('status')!
  status.className = passed === checks.length ? 'pass' : 'fail'
  status.textContent = `${passed === checks.length ? 'PASS' : 'FAIL'}: ${passed}/${checks.length} isometric GPU checks passed.`
  document.title = `Isometric assets: ${passed === checks.length ? 'PASS' : 'FAIL'} ${passed}/${checks.length}`
}

void run().catch((error) => {
  record('Fixture execution', false, String(error))
  document.getElementById('status')!.textContent = `FAIL: ${String(error)}`
})

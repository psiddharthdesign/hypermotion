// SPDX-License-Identifier: Apache-2.0
/* eslint-disable react-refresh/only-export-components -- Standalone visual fixture owns its React root. */

import '../../src/index.css'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { DEFAULT_TEXT_ANIMATION } from '../../src/anim/textAnimations'
import type { AnimatedValue } from '../../src/anim'
import { createSceneAPI } from '../../src/scene/doc'
import type { CameraNode } from '../../src/scene/types'
import { ISOMETRIC_CAMERA_ROTATION } from '../../src/scene/cameraProjection'
import type { SolvedLayout } from '../../src/layout'
import { ThreeSceneViewport } from '../../src/render3d/ThreeSceneViewport'
import { cameraSpaceDepth, resolveCamera3D } from '../../src/render3d/scene3d'
import { FocusPlaneOverlay, type FocusPlanePositionPatch } from '../../src/ui/FocusPlaneOverlay'
import { FocusPlaneDistanceField } from '../../src/ui/FocusPlaneDistanceField'
import { CameraCompositionGuideField } from '../../src/ui/CameraCompositionGuideField'
import { CameraCompositionOverlay } from '../../src/ui/CameraCompositionOverlay'
import { cameraPreviewStore, mergeCameraAnimationPreview } from '../../src/ui/cameraPreviewStore'

// This scene stays entirely in memory. No editor scene, persistence service,
// global animation engine, or app storage is read or changed by this fixture.
const viewport = { width: 900, height: 500 }
const emptySelection: string[] = []
const paint = (color: string) => ({ opacity: 1, fill: { kind: 'solid' as const, color }, stroke: null, cornerRadius: 0, effects: [] })
const api = createSceneAPI()
api.setMeta({ canvas: viewport })
const artboard = api.createNode('frame', null, { size: viewport, appearance: paint('#e9ecf2') })
api.doc.getMap('scene').set('root', artboard)
const card = api.createNode('frame', artboard, {
  name: 'One tilted card', size: { width: 1000, height: 324 }, clipsContent: false,
  appearance: paint('#ffffff'),
})
const layout: SolvedLayout = {
  [artboard]: { x: 0, y: 0, ...viewport },
  [card]: { x: -50, y: 56, width: 1000, height: 324 },
}
const label = (text: string, x: number, y: number, width: number, fontSize: number) => {
  const id = api.createNode('text', card, { text, fontFamily: 'Arial', fontSize, fontWeight: 600, color: '#172334' })
  layout[id] = { x: -50 + x, y: 56 + y, width, height: fontSize * 1.4 }
}
label('FAR', 24, 18, 200, 32)
label('FOCUS SURFACE', 365, 18, 340, 32)
label('NEAR', 868, 18, 110, 32)
for (let i = 0; i < 110; i += 1) {
  const stripe = api.createNode('rect', card, { size: { width: 4, height: 150 }, appearance: paint(i % 3 ? '#182c48' : '#1285ee') })
  layout[stripe] = { x: -26 + i * 8.6, y: 142, width: 4, height: 150 }
}
for (let i = 0; i < 10; i += 1) label(`Aa ${String(i).padStart(2, '0')}`, 24 + i * 96, 256, 94, 24)

const textAnimation = {
  ...DEFAULT_TEXT_ANIMATION, id: 'blur-slide' as const, applyTo: 'letters' as const,
  duration: 0.8, delay: 0.08, blurRadius: 10, motionVector: { x: 0, y: 0.2, z: 4 },
}
const spatialText = api.createNode('text', artboard, {
  name: 'Spatial animated text', text: 'DEPTH IN EVERY LETTER',
  fontFamily: 'Arial', fontSize: 40, fontWeight: 700, color: '#087bec', textAnimation,
})
layout[spatialText] = { x: 110, y: 416, width: 700, height: 60 }
const originalCamera = api.getActiveCamera()!

function Range({ label: name, value, min, max, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void
}) {
  return <label className="focus-range">
    <span>{name}<output>{Math.round(value * 100) / 100}</output></span>
    <input aria-label={name} type="range" value={value} min={min} max={max} step={step}
      onChange={event => onChange(Number(event.target.value))} />
  </label>
}

function FocusFixture() {
  const [projection, setProjection] = useState<'perspective' | 'orthographic'>('perspective')
  const [cameraScale, setCameraScale] = useState(1)
  const [cameraTiltZ, setCameraTiltZ] = useState(0)
  const [compositionGuide, setCompositionGuide] = useState<CameraNode['compositionGuide']>('none')
  const [mode, setMode] = useState<CameraNode['focusMode']>('plane')
  const [focusZ, setFocusZ] = useState(0)
  const [focusX, setFocusX] = useState(450)
  const [focusY, setFocusY] = useState(218)
  const [planeX, setPlaneX] = useState(0)
  const [planeY, setPlaneY] = useState(0)
  const [cardTilt, setCardTilt] = useState(58)
  const [cameraTiltX, setCameraTiltX] = useState(0)
  const [cameraTiltY, setCameraTiltY] = useState(0)
  const [textProgress, setTextProgress] = useState(1)
  const [quality, setQuality] = useState('high')
  const [dof, setDof] = useState(true)
  const [sweep, setSweep] = useState(false)
  const [sweepTarget, setSweepTarget] = useState<'focus' | 'camera'>('focus')
  const [profiling, setProfiling] = useState(false)
  const [profileResult, setProfileResult] = useState('No performance capture yet.')
  const [available, setAvailable] = useState(false)
  const [guideVisible, setGuideVisible] = useState(false)
  const preview = useSyncExternalStore(cameraPreviewStore.subscribe, cameraPreviewStore.getSnapshot)

  useEffect(() => {
    if (!sweep) return
    let request = 0
    const start = performance.now()
    const tick = (time: number) => {
      if (sweepTarget === 'camera') setCameraTiltY(Math.sin((time - start) / 1600) * 25)
      else {
        setFocusZ(Math.sin((time - start) / 1600) * 320)
        if (mode === 'screen') setFocusX(450 + Math.sin((time - start) / 1600) * 200)
      }
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [sweep, sweepTarget, mode])

  useEffect(() => {
    if (!profiling) return
    // Instrument this isolated page only, then restore every method. Skip the
    // first second so the preview→playback allocation is outside the capture.
    const started = performance.now()
    const counts = { canvasClears: 0, textureUploads: 0, mipmaps: 0, shaderLinks: 0 }
    const intervals: number[] = []
    const restores: Array<() => void> = []
    const watch = <T extends object, K extends keyof T>(target: T, key: K, counter: keyof typeof counts) => {
      const original = target[key]
      target[key] = function (this: T, ...args: unknown[]) {
        if (performance.now() - started >= 1000) counts[counter] += 1
        return Reflect.apply(original as (...args: unknown[]) => unknown, this, args)
      } as T[K]
      restores.push(() => { target[key] = original })
    }
    watch(CanvasRenderingContext2D.prototype, 'clearRect', 'canvasClears')
    watch(WebGL2RenderingContext.prototype, 'texImage2D', 'textureUploads')
    watch(WebGL2RenderingContext.prototype, 'texSubImage2D', 'textureUploads')
    watch(WebGL2RenderingContext.prototype, 'generateMipmap', 'mipmaps')
    watch(WebGL2RenderingContext.prototype, 'linkProgram', 'shaderLinks')
    let request = 0
    let previous = 0
    const tick = (time: number) => {
      if (time - started >= 1000) {
        if (previous) intervals.push(time - previous)
        previous = time
      }
      if (time - started < 5000) request = requestAnimationFrame(tick)
      else {
        const sorted = [...intervals].sort((a, b) => a - b)
        const total = intervals.reduce((sum, value) => sum + value, 0)
        setProfileResult(JSON.stringify({
          fps: +(intervals.length * 1000 / total).toFixed(1),
          medianMs: +sorted[Math.floor(sorted.length * 0.5)].toFixed(1),
          p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
          maxMs: +Math.max(...intervals).toFixed(1),
          over33ms: intervals.filter(value => value > 33.4).length,
          measuredFrames: intervals.length, ...counts,
        }, null, 2))
        setProfiling(false)
        setSweep(false)
      }
    }
    request = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(request); restores.forEach(restore => restore()) }
  }, [profiling])

  const camera = useMemo<CameraNode>(() => ({
    ...originalCamera, projection, depthOfField: dof, focusMode: mode, compositionGuide,
    aperture: 1, fStop: 1.4, blurLevel: 24, blurQuality: 48,
    dofPreviewQuality: quality === 'playback' ? 'balanced' : quality === 'balanced' ? 'balanced' : 'high',
    fieldOfView: 2 * Math.atan(viewport.height / 2 / 1000) * 180 / Math.PI,
    focalLength: 1000, focusPlaneInitialized: true, focusRadius: 55, focusFalloff: 140,
    transform: { ...originalCamera.transform, x: 450, y: 250, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: cameraScale, scaleY: cameraScale },
  }), [dof, mode, quality, compositionGuide, projection, cameraScale])
  const authoredCameraAnim = useMemo<AnimatedValue>(() => ({
    rotationX: cameraTiltX, rotationY: cameraTiltY, rotation: cameraTiltZ,
    focusDistance: 1000 + focusZ, focusPlaneX: focusX, focusPlaneY: focusY, focusPlaneZ: focusZ,
    focusPlaneRotationX: planeX, focusPlaneRotationY: planeY, focusPlaneRotationZ: 0,
    focusX, focusY,
  }), [focusZ, focusX, focusY, planeX, planeY, cameraTiltX, cameraTiltY, cameraTiltZ])
  const cameraAnim = useMemo(() => mergeCameraAnimationPreview(authoredCameraAnim,
    preview?.cameraId === camera.id ? preview.value : undefined), [authoredCameraAnim, camera.id, preview])
  const animated = useMemo<Record<string, AnimatedValue>>(() => ({
    [card]: { rotationY: cardTilt },
    [spatialText]: { rotationY: 20, textProgress, textTimelineProgress: textProgress, textAnimation },
  }), [cardTilt, textProgress])
  const resolved = resolveCamera3D(camera, cameraAnim, viewport)
  const depthRange = [-500, 0, 500].map(x => cameraSpaceDepth({
    x: 450 + x * Math.cos(cardTilt * Math.PI / 180), y: 218,
    z: -x * Math.sin(cardTilt * Math.PI / 180),
  }, resolved))
  const preset = (z: number) => { setSweep(false); setMode('plane'); setFocusZ(z) }
  const commitFocusPosition = (patch: FocusPlanePositionPatch) => {
    setSweep(false); setFocusX(patch.focusPlaneX); setFocusY(patch.focusPlaneY); setFocusZ(patch.focusPlaneZ)
  }

  return <main className="focus-fixture">
    <style>{`
      .focus-fixture { font: 14px Arial, sans-serif; color: #182334; padding: 24px; background: #f8fafc; min-height: 100vh; }
      .focus-fixture h1 { font-size: 24px; font-weight: 700; margin: 0 0 8px; }
      .focus-fixture p { margin: 0 0 16px; color: #536174; }
      .focus-grid { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }
      .focus-controls { width: 260px; display: grid; gap: 12px; }
      .focus-controls button, .focus-controls select { border: 1px solid #bfcada; border-radius: 6px; padding: 8px; background: white; }
      .focus-fixture button[aria-pressed="true"] { background: #d6eaff; }
      .focus-range { display: grid; gap: 5px; }
      .focus-range span { display: flex; justify-content: space-between; }
      .focus-range input { width: 100%; accent-color: #087bec; }
      .focus-preset { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
      .focus-readout { font: 12px/1.7 ui-monospace, monospace; padding: 12px 0; color: #38465a; }
      .focus-canvas { position: relative; width: 900px; height: 500px; border: 1px solid #d3dce8; overflow: hidden; background: #e9ecf2; }
    `}</style>
    <h1>Continuous focus plane</h1>
    <p>One tilted card crosses the lens plane. Fine stripes and text should sharpen only where the surfaces meet.</p>
    <div className="focus-grid">
      <section>
        <div className="focus-canvas" aria-label="Rendered focus comparison">
          <ThreeSceneViewport api={api} layout={layout} camera={camera} cameraAnim={cameraAnim}
            animated={animated} width={900} height={500} sceneFill="#e9ecf2" selectedIds={emptySelection}
            sceneVersion={0} playing={quality === 'playback'} playhead={textProgress * 2.4}
            showHelpers={false} showPlanes exportable finalRender={quality === 'export'}
            renderPixelRatio={2} texturePixelRatio={2} onAvailabilityChange={setAvailable} />
          <CameraCompositionOverlay guide={compositionGuide} width={900} height={500} zoom={1} />
          {guideVisible && <div style={{ position: 'absolute', left: 450, top: 250 }}>
            <FocusPlaneOverlay camera={camera} cameraAnim={cameraAnim} width={900} height={500} zoom={1}
              playing={quality === 'playback'} onCommit={commitFocusPosition} />
          </div>}
        </div>
        <div className="focus-readout" aria-live="polite">
          GPU {available ? 'ready' : 'loading'} · {projection} · {mode === 'screen' ? 'Point' : mode === 'spatial' ? 'Focus plane' : 'Distance'} focus · {quality}<br />
          Card depth (left / centre / right): {depthRange.map(value => Math.round(value)).join(' / ')}<br />
          Focus depth: {Math.round(resolved.focusDistance)} · Plane tilt X/Y: {planeX}° / {planeY}° · Text progress: {textProgress.toFixed(2)}<br />
          Camera rotation X/Y/Z: {cameraTiltX.toFixed(2)}° / {cameraTiltY.toFixed(2)}° / {cameraTiltZ.toFixed(2)}° · Spatial anchor: {resolved.focusWorld.x.toFixed(1)}, {resolved.focusWorld.y.toFixed(1)}, {resolved.focusWorld.z.toFixed(1)}
        </div>
        <p>Check: move focus near ↔ far; align the spatial plane to sharpen the whole card; Point keeps its circular focus region.</p>
        <pre aria-label="Performance capture">{profiling ? 'Measuring playback…' : profileResult}</pre>
      </section>
      <aside className="focus-controls">
        <label>Projection <select aria-label="Projection" value={projection} onChange={event => setProjection(event.target.value as 'perspective' | 'orthographic')}>
          <option value="perspective">Perspective</option><option value="orthographic">Orthographic</option>
        </select></label>
        <button onClick={() => {
          setSweep(false); setProjection('orthographic'); setCameraScale(1.4)
          setCameraTiltX(ISOMETRIC_CAMERA_ROTATION.rotationX)
          setCameraTiltY(ISOMETRIC_CAMERA_ROTATION.rotationY)
          setCameraTiltZ(ISOMETRIC_CAMERA_ROTATION.rotation)
          setMode('spatial'); setGuideVisible(true)
        }}>Isometric view</button>
        <Range label="Camera scale" value={cameraScale} min={0.5} max={2} step={0.05} onChange={setCameraScale} />
        <CameraCompositionGuideField value={compositionGuide} onCommit={setCompositionGuide} />
        <label>Focus mode <select aria-label="Focus mode" value={mode} onChange={event => setMode(event.target.value as CameraNode['focusMode'])}>
          <option value="plane">Distance</option><option value="spatial">Focus plane</option><option value="screen">Point</option>
        </select></label>
        {mode === 'spatial' && <FocusPlaneDistanceField camera={camera} cameraAnim={cameraAnim} viewport={viewport}
          onCommit={commitFocusPosition}
          onPreview={patch => cameraPreviewStore.set(camera.id, patch)}
          onScrubCommit={patch => { commitFocusPosition(patch); cameraPreviewStore.finish(camera.id) }}
          onCancel={() => cameraPreviewStore.clear(camera.id)} />}
        <div className="focus-preset">
          <button onClick={() => preset(320)}>Far focus</button>
          <button onClick={() => preset(0)}>Centre focus</button>
          <button onClick={() => preset(-320)}>Near focus</button>
        </div>
        <Range label="Focus Z" value={focusZ} min={-420} max={420} onChange={value => { setSweep(false); setFocusZ(value) }} />
        <Range label="Focus X" value={focusX} min={100} max={800} onChange={setFocusX} />
        <Range label="Focus Y" value={focusY} min={40} max={460} onChange={setFocusY} />
        <Range label="Plane tilt X" value={planeX} min={-70} max={70} onChange={value => { setMode('spatial'); setPlaneX(value) }} />
        <Range label="Plane tilt Y" value={planeY} min={-70} max={70} onChange={value => { setMode('spatial'); setPlaneY(value) }} />
        <button onClick={() => { setSweep(false); setMode('spatial'); setFocusX(450); setFocusY(218); setFocusZ(0); setPlaneX(0); setPlaneY(cardTilt) }}>Align plane with card</button>
        <button aria-pressed={guideVisible} onClick={() => { setGuideVisible(value => !value); setMode('spatial') }}>{guideVisible ? 'Hide focus plane handles' : 'Show focus plane handles'}</button>
        <Range label="Card tilt Y" value={cardTilt} min={0} max={70} onChange={setCardTilt} />
        <Range label="Camera tilt X" value={cameraTiltX} min={-80} max={80} onChange={setCameraTiltX} />
        <Range label="Camera tilt Y" value={cameraTiltY} min={-80} max={80} onChange={setCameraTiltY} />
        <Range label="Camera roll Z" value={cameraTiltZ} min={-180} max={180} onChange={setCameraTiltZ} />
        <button onClick={() => { setSweep(false); setCameraTiltX(0); setCameraTiltY(0); setCameraTiltZ(0); setCameraScale(1) }}>Reset camera view</button>
        <Range label="Text animation" value={textProgress} min={0} max={1} step={0.01} onChange={setTextProgress} />
        <label>Quality <select aria-label="Quality" value={quality} onChange={event => setQuality(event.target.value)}>
          <option value="high">High preview</option><option value="balanced">Balanced preview</option>
          <option value="playback">Playback</option><option value="export">Export</option>
        </select></label>
        <button aria-pressed={sweep} onClick={() => setSweep(value => !value)}>{sweep ? 'Stop focus sweep' : 'Sweep focus continuously'}</button>
        <label>Sweep target <select aria-label="Sweep target" value={sweepTarget} onChange={event => setSweepTarget(event.target.value as 'focus' | 'camera')}>
          <option value="focus">Focus position</option><option value="camera">Camera orbit</option>
        </select></label>
        <button disabled={profiling} onClick={() => { setQuality('playback'); setSweep(true); setProfiling(true) }}>Measure 5 seconds</button>
        <button aria-pressed={dof} onClick={() => setDof(value => !value)}>{dof ? 'Disable depth of field' : 'Enable depth of field'}</button>
      </aside>
    </div>
  </main>
}

const root = createRoot(document.getElementById('root')!)
root.render(<FocusFixture />)
if (import.meta.hot) import.meta.hot.dispose(() => { root.unmount(); api.doc.destroy() })

// SPDX-License-Identifier: Apache-2.0
/* eslint-disable react-refresh/only-export-components -- Standalone manual fixture owns its React root. */

import '../../src/index.css'
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import * as Y from 'yjs'
import { addKeyframe, getAnimEngine } from '../../src/anim'
import { solveLayout, yogaReady } from '../../src/layout/engine'
import { createSceneAPI } from '../../src/scene/doc'
import { SceneContext } from '../../src/scene/internals'
import { createArrangement } from '../../src/scene/arrangementActions'
import { animatedArrangement } from '../../src/scene/arrangement'
import { ISOMETRIC_CAMERA_VIEWS } from '../../src/scene/cameraProjection'
import { UNDOABLE_GESTURE_ORIGIN } from '../../src/scene/undo'
import { ThreeSceneViewport } from '../../src/render3d/ThreeSceneViewport'
import { useUI } from '../../src/state/ui'
import { ArrangementSection } from '../../src/ui/ArrangementSection'
import { setLastSolvedLayout } from '../../src/ui/hooks/lastSolvedLayout'

// The HTML sets render-window=1 before this module loads. SceneContext skips
// persistence; this page owns an in-memory API and its own animation singleton.
const viewport = { width: 900, height: 540 }
const duration = 4
const selectedIds: string[] = []
const api = createSceneAPI()
api.setMeta({ name: 'Arrangement controls check', canvas: viewport, duration, frameRate: 60 })
const rootId = api.createNode('frame', null, {
  name: 'Fixture scene', size: viewport, clipsContent: false,
  appearance: { opacity: 1, fill: null, stroke: null, cornerRadius: 0, effects: [] },
})
const yoga = await yogaReady
const arrangementId = createArrangement(api, [], solveLayout(yoga, api, rootId, viewport), {}, 'radial')!
const initialArrangement = api.getNode(arrangementId)!.arrangement!
api.setNodeProperty(arrangementId, 'name', 'Blue square orbit')
api.setNodeProperty(arrangementId, 'arrangement', {
  ...initialArrangement, radius: 186, rotationX: 28, rotationY: 18, orientation: 'screen',
})
const solidId = initialArrangement.memberIds[0]!
api.setNodeProperty(solidId, 'name', 'Blue square 1 · solid')
api.setNodeProperty(solidId, 'extrusion', { depth: 32, sideColor: '#174ab3' })
addKeyframe(api, arrangementId, 'arrangement.orbit', 0, 0, 'linear')
addKeyframe(api, arrangementId, 'arrangement.orbit', duration, 360, 'linear')
const cameraId = api.getActiveCamera()!.id
api.setNodeProperty(cameraId, 'projection', 'perspective')
api.setNodeProperty(cameraId, 'transform', {
  ...api.getActiveCamera()!.transform, x: viewport.width / 2, y: viewport.height / 2,
  z: 0, rotationX: 0, rotationY: 0, rotation: 0, scaleX: 1, scaleY: 1,
})
const engine = getAnimEngine()
engine.pause()
engine.attach(api)
engine.setLoopRange({ start: 0, end: duration })
engine.seek(0)
useUI.getState().setSelection([arrangementId])
useUI.getState().setPlaying(false)
useUI.getState().setPlayhead(0)
let revision = 0
const subscribe = (listener: () => void) => {
  const changed = () => { revision += 1; listener() }
  api.doc.on('afterTransaction', changed)
  return () => api.doc.off('afterTransaction', changed)
}
const undo = new Y.UndoManager(api.doc.getMap('scene'), {
  trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]), captureTimeout: 0,
})

type View = 'perspective' | 'orthographic' | typeof ISOMETRIC_CAMERA_VIEWS[number]['id']
function Fixture() {
  const version = useSyncExternalStore(subscribe, () => revision)
  const animated = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  const time = useSyncExternalStore(engine.subscribe, engine.getPlayhead)
  const selection = useUI(state => state.selection)
  const playing = useUI(state => state.playing)
  const [view, setView] = useState<View>('perspective')
  const [grid, setGrid] = useState(false)
  const [available, setAvailable] = useState(false)
  const layout = useMemo(() => {
    void version
    return solveLayout(yoga, api, rootId, viewport)
  }, [version])
  useLayoutEffect(() => {
    setLastSolvedLayout(layout)
    return () => setLastSolvedLayout(null)
  }, [layout])
  useEffect(() => {
    const syncTime = () => useUI.getState().setPlayhead(engine.getPlayhead())
    const off = engine.subscribe(syncTime)
    return () => { off(); engine.pause() }
  }, [])
  const camera = api.getActiveCamera()!
  const chosen = selection[0] ? api.getNode(selection[0]) : null
  const node = chosen ?? api.getNode(arrangementId)
  const controller = node?.kind === 'arrangement' ? node : node?.transformParent ? api.getNode(node.transformParent.nodeId) : null
  const live = controller?.arrangement ? animatedArrangement(controller.arrangement, animated[controller.id]?.arrangement) : null
  const pause = () => { engine.pause(); useUI.getState().setPlaying(false) }
  const seek = (value: number) => { pause(); engine.seek(value); useUI.getState().setPlayhead(value) }
  const changeView = (next: View) => {
    const preset = ISOMETRIC_CAMERA_VIEWS.find(item => item.id === next)
    api.doc.transact(() => {
      api.setNodeProperty(cameraId, 'projection', next === 'perspective' ? 'perspective' : 'orthographic')
      api.setNodeProperty(cameraId, 'transform', {
        ...api.getActiveCamera()!.transform,
        ...(preset?.rotation ?? { rotationX: 0, rotationY: 0, rotation: 0 }),
      })
    }, UNDOABLE_GESTURE_ORIGIN)
    setView(next)
  }
  return <main className="arrangement-fixture">
    <style>{`
      body { margin: 0; overflow: auto; background: #edf1f7; color: #182b46; }
      .arrangement-fixture { padding: 24px; min-width: 1278px; }
      .arrangement-fixture h1 { font-size: 22px; font-weight: 650; margin-bottom: 6px; }
      .arrangement-fixture header p { font-size: 13px; margin-bottom: 18px; }
      .arrangement-fixture .workspace { display: flex; align-items: flex-start; gap: 24px; }
      .arrangement-fixture .stage { position: relative; width: 900px; height: 540px; overflow: hidden; border: 1px solid #cbd5e4; border-radius: 8px; background: #f7f9fd; }
      .arrangement-fixture .stage > div { position: absolute; inset: 0; }
      .arrangement-fixture .toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
      .arrangement-fixture .toolbar button, .arrangement-fixture .toolbar select { padding: 7px 12px; border: 1px solid #cbd5e4; border-radius: 7px; background: white; font-size: 12px; cursor: pointer; }
      .arrangement-fixture .toolbar label { display: flex; align-items: center; gap: 6px; font-size: 12px; }
      .arrangement-fixture aside { width: 306px; max-height: calc(100vh - 130px); overflow-y: auto; padding: 16px; background: white; border: 1px solid #cbd5e4; border-radius: 8px; }
      .arrangement-fixture aside h2 { font-size: 14px; font-weight: 600; margin-bottom: 10px; }
      .arrangement-fixture .readout { margin: 14px 0 8px; font-size: 12px; font-variant-numeric: tabular-nums; }
      .arrangement-fixture .scrub { width: 900px; accent-color: #008bff; }
      .arrangement-fixture .note { max-width: 900px; font-size: 12px; margin-top: 12px; color: #5d6d82; }
    `}</style>
    <header>
      <h1>Native arrangement controls</h1>
      <p>Nine default blue squares. One four-second orbit. This temporary scene does not load or save the editor project.</p>
    </header>
    <div className="workspace">
      <section aria-label="Arrangement preview">
        <div className="toolbar">
          <button onClick={() => {
            if (playing) pause()
            else { engine.play(); useUI.getState().setPlaying(true) }
          }}>{playing ? 'Pause orbit' : 'Play orbit'}</button>
          <button onClick={() => seek(0)}>Start</button>
          <button onClick={() => seek(1)}>Quarter lap</button>
          <label>Camera view<select aria-label="Camera view" value={view} onChange={event => changeView(event.target.value as View)}>
            <option value="perspective">Perspective</option>
            <option value="orthographic">Orthographic · front</option>
            {ISOMETRIC_CAMERA_VIEWS.map(item => <option key={item.id} value={item.id}>Isometric · {item.label}</option>)}
          </select></label>
          <label><input type="checkbox" checked={grid} onChange={event => setGrid(event.target.checked)} />Grid</label>
        </div>
        <div className="stage">
          <ThreeSceneViewport api={api} layout={layout} animated={animated}
            camera={camera} cameraAnim={animated[camera.id]} editorGridSpacing={grid ? 32 : null}
            width={viewport.width} height={viewport.height} sceneFill="#f7f9fd"
            selectedIds={selectedIds} showPlanes showHelpers={false}
            renderPixelRatio={1} texturePixelRatio={1} sceneVersion={version}
            playhead={time} cameraTransitions={false} onAvailabilityChange={setAvailable} />
        </div>
        <p className="readout" role="status">{available ? 'WebGL ready' : 'Starting WebGL…'} · {time.toFixed(2)} s / {duration} s · Orbit {(live?.orbit ?? 0).toFixed(1)}° · {live?.memberIds.length ?? 0} members · {live?.orientation === 'screen' ? 'Face camera' : live?.orientation ?? 'Arrangement dissolved'}</p>
        <input className="scrub" aria-label="Preview time" type="range" min={0} max={duration} step={1 / 60} value={time} onChange={event => seek(Number(event.target.value))} />
        <p className="note">Use Pattern to try the grid, path, or sphere. Orbit moves members along the ring; Rotate X/Y tilts the ring. Card facing → Face camera keeps every card upright in any camera view. The first square has 32 px of depth: choose Follow arrangement to see its walls.</p>
        <div className="toolbar" style={{ marginTop: 14 }}>
          <button onClick={() => { pause(); undo.undo() }}>Undo edit</button>
          <button onClick={() => { pause(); undo.redo() }}>Redo edit</button>
          <button onClick={() => { const first = api.getAllNodeIds().find(id => api.getNode(id)?.kind === 'arrangement'); if (first) useUI.getState().setSelection([first]) }}>Select arrangement</button>
          <button onClick={() => location.reload()}>Reset fixture</button>
        </div>
      </section>
      <aside aria-label="Native arrangement properties">
        <h2>{node?.name ?? 'Arrangement removed'}</h2>
        {node ? <ArrangementSection api={api} node={node} /> : <p>Reset the fixture to restore the arrangement.</p>}
      </aside>
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<SceneContext.Provider value={api}><Fixture /></SceneContext.Provider>)

// SPDX-License-Identifier: Apache-2.0
// Isolated manual interaction fixture; never loads or writes the editor autosave.
import { createRoot } from 'react-dom/client'
import { useMemo, useState, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { createSceneAPI } from '../../src/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '../../src/scene/undo'
import { ISOMETRIC_CAMERA_VIEWS } from '../../src/scene/cameraProjection'
import { solveLayout, yogaReady } from '../../src/layout/engine'
import { ThreeSceneViewport } from '../../src/render3d/ThreeSceneViewport'
import { SolidFaceSelectionOverlay } from '../../src/ui/SolidFaceSelectionOverlay'
import { CameraSelectionOverlay } from '../../src/ui/CameraSelectionOverlay'
import { SolidGridControls } from '../../src/ui/SolidGridControls'
import { SolidPlacementSection } from '../../src/ui/SolidPlacementSection'
import { useUI } from '../../src/state/ui'
import { SceneContext } from '../../src/scene/internals'
import { nodeGeometryPreviewStore } from '../../src/ui/nodeGeometryPreviewStore'
import { nodeGeometryPreviewRect } from '../../src/ui/nodeGeometryPreviewRect'
import { nodeTransformPreviewStore } from '../../src/ui/nodeTransformPreviewStore'
import { createIsometricAsset } from '../../src/ui/isometricAssetAuthoring'
import { createFlowConnection } from '../../src/ui/flowConnectionAuthoring'
const api = createSceneAPI()
api.setMeta({ name: 'Isolated editing check', canvas: { width: 960, height: 540 }, duration: 4, frameRate: 60 })
const rootId = api.createNode('frame', null, { size: { width: 960, height: 540 }, clipsContent: false, appearance: { opacity: 1, fill: null, stroke: null, cornerRadius: 0, effects: [] } })
const block = createIsometricAsset(api, 'block', { center: { x: 340, y: 230 } })
const cylinder = createIsometricAsset(api, 'platform', { center: { x: 640, y: 330 } })
createFlowConnection(api, [block, cylinder])
const cameraId = api.getActiveCamera()!.id
api.setNodeProperty(cameraId, 'projection', 'orthographic')
api.setNodeProperty(cameraId, 'transform', { ...api.getActiveCamera()!.transform, x: 480, y: 270, z: 0, scaleX: 1.3, scaleY: 1.3, ...ISOMETRIC_CAMERA_VIEWS[0].rotation })
let revision = 0
const subscribe = (listener: () => void) => { const changed = () => { revision++; listener() }; api.doc.on('afterTransaction', changed); return () => api.doc.off('afterTransaction', changed) }
const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]), captureTimeout: 0 })
const yoga = await yogaReady
export function Fixture() {
  const version = useSyncExternalStore(subscribe, () => revision)
  const animated = useSyncExternalStore(nodeTransformPreviewStore.subscribe, nodeTransformPreviewStore.getSnapshot)
  const preview = useSyncExternalStore(nodeGeometryPreviewStore.subscribe, nodeGeometryPreviewStore.getSnapshot)
  const [selected, setSelected] = useState(block)
  const [time, setTime] = useState(0)
  const [faces, setFaces] = useState(true)
  const grid = useUI(state => state.solidGridSnapEnabled ? state.solidGridSize : null)
  const layout = useMemo(() => {
    void version
    const solved = solveLayout(yoga, api, rootId, { width: 960, height: 540 })
    for (const [id, value] of Object.entries(preview)) {
      const node = api.getNode(id), rect = solved[id]
      if (node && rect) solved[id] = nodeGeometryPreviewRect(node, rect, value)
    }
    return solved
  }, [version, preview])
  const camera = api.getActiveCamera()!
  const body = api.getChildren(selected)[0]!
  const dims = 'size' in body ? body.size : { width: 0, height: 0 }
  return <>
    <style>{`body{background:#f2f5fb;color:#142848;font:14px system-ui;margin:24px;--color-accent:#0099ff}button{padding:10px 16px;margin:0 8px 12px 0;background:white;border:1px solid #ccd6e5;border-radius:8px;cursor:pointer}h1{font-size:22px}p{max-width:900px}#stage{position:relative;width:960px;height:540px;border:1px solid #ccd6e5;background:#f2f5fb}#stage>div{position:absolute;inset:0}.pointer-events-none{pointer-events:none}.absolute{position:absolute}.inset-0{inset:0}`}</style>
    <h1>Direct face editing and attached flow lines</h1>
    <p>Drag the selected asset’s top or side. Each gesture is one undo; the connection remains attached. This scene is isolated from the editor.</p>
    <button onClick={() => setSelected(block)}>Edit block</button><button onClick={() => setSelected(cylinder)}>Edit cylinder</button><button onClick={() => undo.undo()}>Undo</button><button onClick={() => undo.redo()}>Redo</button><button onClick={() => setTime(time + 0.5)}>Advance flow 0.5s</button>
    <button onClick={() => { const id=api.getChildren(block)[0]!.id; const node=api.getNode(id)!; api.setNodeProperty(id, 'appearance', {...node.appearance, cornerRadius:24}); api.setNodeProperty(id, 'transform', {...node.transform, scaleX:1.1226, scaleY:1.3838}); setSelected(block); setFaces(true) }}>Rounded block</button>
    <button onClick={() => setFaces(!faces)}>{faces ? 'Move asset' : 'Edit faces'}</button>
    <div style={{display:'flex', gap:32, width:960, paddingBottom:12}}><SolidGridControls /><SolidPlacementSection api={api} node={api.getNode(selected)!} /></div>
    <p role="status">{body.name}: width {Number(dims.width).toFixed(2)} · height {Number(dims.height).toFixed(2)} · depth {body.extrusion!.depth.toFixed(2)} · Z {body.transform.z.toFixed(2)} · radius {body.appearance.cornerRadius.toFixed(2)} · scale {body.transform.scaleX.toFixed(4)} / {body.transform.scaleY.toFixed(4)} · flow time {time.toFixed(1)}s · asset X {api.getNode(selected)!.transform.x.toFixed(2)} · Y {api.getNode(selected)!.transform.y.toFixed(2)}</p>
    <div id="stage"><ThreeSceneViewport api={api} layout={layout} animated={animated} camera={camera} cameraAnim={undefined} editorGridSpacing={grid} width={960} height={540} sceneFill="#f2f5fb" selectedIds={[]} showPlanes showHelpers={false} renderPixelRatio={1} texturePixelRatio={1} sceneVersion={version} playhead={time} cameraTransitions={false} />
    {faces ? <SolidFaceSelectionOverlay api={api} layout={layout} animated={animated} camera={camera} selection={[selected]} width={960} height={540} zoom={1} sceneVersion={version} clientToViewport={(x,y) => { const r=document.getElementById('stage')!.getBoundingClientRect(); return {x:x-r.left-1,y:y-r.top-1} }} /> : <CameraSelectionOverlay api={api} solved={layout} animated={animated} camera={camera} cameraAnim={undefined} selectedIds={[selected]} width={960} height={540} zoom={1} sceneVersion={version} clientToViewport={(x,y) => { const r=document.getElementById('stage')!.getBoundingClientRect(); return {x:x-r.left-1,y:y-r.top-1} }} />}</div>
  </>
}
createRoot(document.getElementById('root')!).render(<SceneContext.Provider value={api}><Fixture /></SceneContext.Provider>)

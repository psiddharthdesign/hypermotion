import '../../src/index.css'
import { useState } from 'react'
import { nodeTransformPreviewStore } from '../../src/ui/nodeTransformPreviewStore'
import { useNodeTransformPreviews } from '../../src/ui/hooks/useAnimatedValues'
import { createRoot } from 'react-dom/client'
import { createSceneAPI } from '../../src/scene/doc'
import { SceneContext } from '../../src/scene/internals'
import { SceneLayer } from '../../src/ui/Canvas'
import { composeInheritedAnim } from '../../src/ui/canvasRenderHelpers'
import { ThreeSceneViewport } from '../../src/render3d/ThreeSceneViewport'
import type { SolvedLayout } from '../../src/layout'

const appearance = (color: string) => ({ opacity: 1, fill: { kind: 'solid' as const, color }, stroke: null, cornerRadius: 0, effects: [] })
function fixture(ellipse = false, nested = false) {
  const api = createSceneAPI()
  const root = api.createNode('frame', null, { size: { width: 400, height: 260 }, appearance: appearance('#ffffff') })
  const group = nested ? api.createNode('frame', root, { size: { width: 400, height: 260 }, clipsContent: false, appearance: { ...appearance('#ffffff'), fill: null } }) : root
  const mask = api.createNode(ellipse ? 'ellipse' : 'rect', group, { isMask: true, maskMode: 'alpha', size: { width: 160, height: 140 }, appearance: { ...appearance('#ff00ff'), effects: [{ id: 'mask-blur', kind: 'blur', amount: 0, visible: true }] } })
  const content = api.createNode('frame', group, { clipsContent: false, size: { width: 300, height: 200 }, appearance: appearance('#1689ee') })
  const stripe = api.createNode('rect', content, { size: { width: 40, height: 200 }, appearance: appearance('#ff9900') })
  const layout: SolvedLayout = {
    [root]: { x: 0, y: 0, width: 400, height: 260 },
    [mask]: { x: 100, y: 60, width: 160, height: 140 },
    [content]: { x: 30, y: 20, width: 300, height: 200 },
    [stripe]: { x: 140, y: 20, width: 40, height: 200 },
  }
  api.moveChild(group, mask, 1)
  if (nested) layout[group] = layout[root]!
  return { api, root, mask, content, layout, camera: api.getActiveCamera()! }
}
const fixtures = [fixture(), fixture(true), fixture(false, true)]
const previewIds = fixtures.flatMap(f => Object.keys(f.layout))
export function App() {
  const previews = useNodeTransformPreviews(previewIds)
  const [fallback, setFallback] = useState(false)
  const [contentX, setContentX] = useState(0)
  const [maskX, setMaskX] = useState(0)
  const [rotation, setRotation] = useState(0)
  const [blur, setBlur] = useState(0)
  const [opacity, setOpacity] = useState(1)
  const [final, setFinal] = useState(false)
  const [available, setAvailable] = useState(false)
  return <main style={{ font: '14px system-ui', padding: 20 }}>
    <style>{`button { border: 1px solid #bbb; border-radius: 4px; padding: 4px 8px; margin-right: 6px; } h1 { font-size: 24px; font-weight: 600; margin-bottom: 12px; } h2 { font-size: 16px; font-weight: 600; margin: 12px 0; } p { margin: 12px 0; }`}</style>
    <h1>Masking regression</h1>
    <button onClick={() => setContentX(x => x ? 0 : 100)}>Move content</button>
    <button onClick={() => setMaskX(x => x ? 0 : 60)}>Move mask</button>
    <button onClick={() => setRotation(x => x ? 0 : 25)}>Rotate mask</button>
    <button onClick={() => setFallback(v => !v)}>Toggle DOM fallback</button>
    <button onClick={() => setBlur(v => v ? 0 : 16)}>Toggle mask blur</button>
    <button onClick={() => setOpacity(v => v === 1 ? 0.4 : 1)}>Toggle mask opacity</button>
    <button onClick={() => setFinal(v => !v)}>Toggle export quality</button>
    <button onClick={() => nodeTransformPreviewStore.preview(Object.fromEntries(fixtures.map(f => [f.mask, { x: 90 }])))}>Hold live mask preview</button>
    <button onClick={() => nodeTransformPreviewStore.clear()}>Cancel live preview</button>
    <label>Drag mask <input aria-label="Live mask position" type="range" min="-80" max="140" defaultValue="0"
      onChange={event => nodeTransformPreviewStore.preview(Object.fromEntries(fixtures.map(f => [f.mask, { x: Number(event.target.value) }])))} /></label>
    <p>Live preview: {previews[fixtures[0]!.mask]?.x ?? 'none'} (document position remains 0)</p>
    <p>Content X: {contentX} · Mask X: {maskX} · Mask rotation: {rotation} · Blur: {blur} · Opacity: {opacity} · {final ? 'Export' : 'Preview'} · {fallback ? 'DOM' : 'GPU'} {fallback || available ? 'ready' : 'loading'}</p>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {fixtures.map((f, i) => <section key={i}><h2>{['Rectangle', 'Ellipse', 'Nested rectangle'][i]}</h2>
        <div style={{ position: 'relative', width: 400, height: 260, background: '#fff', border: '1px solid #ddd' }}>
          {fallback ? <SceneContext.Provider value={f.api}><SceneLayer sceneApi={f.api} rootId={f.root}
            solved={f.layout} order={Object.keys(f.layout)} animated={{[f.content]:{x:contentX},[f.mask]:{x:maskX,rotation,opacity,effectBlur:{'mask-blur':blur},...previews[f.mask]}}}
            inherited={composeInheritedAnim(f.api,f.root,{[f.content]:{x:contentX},[f.mask]:{x:maskX,rotation,opacity,effectBlur:{'mask-blur':blur},...previews[f.mask]}},f.layout)} /></SceneContext.Provider> : <ThreeSceneViewport api={f.api} layout={f.layout} camera={f.camera} cameraAnim={{x:200,y:130,z:0}}
            animated={{[f.content]:{x:contentX},[f.mask]:{x:maskX,rotation,opacity,effectBlur:{'mask-blur':blur},...previews[f.mask]}}} width={400} height={260}
            sceneFill="#ffffff" selectedIds={[]} sceneVersion={0} playing={false} playhead={0}
            showPlanes finalRender={final} exportable onAvailabilityChange={setAvailable} />}
        </div>
      </section>)}
    </div>
    <p>The magenta masks must never paint. Blue/orange content must remain inside each silhouette.</p>
  </main>
}
const root = createRoot(document.getElementById('root')!)
root.render(<App />)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createSceneAPI } from '../../src/scene/doc'
import { SceneContext } from '../../src/scene/internals'
import { getAnimEngine } from '../../src/anim'
import { CornerShapeFields } from '../../src/ui/CornerShapeFields'
import { cornerShapePath, resolveCornerAppearance } from '../../src/render/cornerShape'
import { paintBorderBeam } from '../../src/render/beam/paintBorderBeam'
import { useAnimatedValues } from '../../src/ui/hooks/useAnimatedValues'
import { useUI } from '../../src/state/ui'

const api = createSceneAPI()
const nodeId = api.createNode('rect', api.getRoot(), { size: { width: 240, height: 240 }, appearance: {
  opacity: 1, fill: { kind: 'solid', color: '#ffffff' }, stroke: null, effects: [], cornerRadius: 48,
  cornerSmoothing: 0.6, cornerSmoothingEnabled: false,
} })
const nodeIds = [nodeId]
const engine = getAnimEngine()
engine.attach(api)
export function Check() {
  const [version, setVersion] = useState(0)
  const [time, setTime] = useState(0)
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => api.subscribe(() => setVersion(v => v + 1)), [])
  const node = api.getNode(nodeId)!
  useLayoutEffect(() => { engine.seek(time) }, [version, time])
  const animated = useAnimatedValues(nodeIds)[nodeId]
  const shape = resolveCornerAppearance(node.appearance, animated, 240, 240)
  useLayoutEffect(() => {
    const ctx = canvas.current!.getContext('2d')!
    ctx.clearRect(0, 0, 320, 320)
    ctx.save(); ctx.translate(40, 40)
    ctx.fillStyle = '#ffffff'
    ctx.fill(new Path2D(cornerShapePath({ width: 240, height: 240, ...shape })))
    paintBorderBeam(ctx, { kind: 'border-beam', size: 'pulse-inner', colorVariant: 'ocean', fadeIn: 0 }, { width: 240, height: 240, radius: shape.cornerRadius, cornerSmoothing: shape.cornerSmoothing, fill: '#ffffff' }, time + 1)
    ctx.restore()
  })
  return <main style={{ font: '14px system-ui', maxWidth: 420, padding: 24 }}>
    <h1>Corner controls</h1><canvas ref={canvas} width={320} height={320} style={{ background: '#e5e7eb' }} />
    <p>Square · 240 × 240</p>
    <button onClick={() => { useUI.getState().setPlayhead(0); engine.seek(0); setTime(0) }}>Time 0</button>
    <button onClick={() => { useUI.getState().setPlayhead(1); engine.seek(1); setTime(1) }}>Time 1</button>
    <CornerShapeFields node={node} animated={animated} />
    <output aria-label="Resolved corners">{JSON.stringify(shape)}</output>
    <output aria-label="Corner tracks">{JSON.stringify(api.getAllTracks())}</output>
  </main>
}
createRoot(document.getElementById('root')!).render(<SceneContext.Provider value={api}><Check /></SceneContext.Provider>)

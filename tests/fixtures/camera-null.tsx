// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createSceneAPI } from '../../src/scene/doc'
import { addNull, setNullParent } from '../../src/scene/nullObject'
import { getAnimEngine } from '../../src/anim'
import { NullParentSection } from '../../src/ui/NullParentSection'
import { resolveCamera3D } from '../../src/render3d/scene3d'
import { useUI } from '../../src/state/ui'
import type { CameraNode } from '../../src/scene/types'
const api = createSceneAPI()
api.createNode('frame', null, { size: { width: 960, height: 540 } })
const controller = addNull(api)!
const cameraId = api.getActiveCamera()!.id
setNullParent(api, cameraId, controller)
api.setTrack({ id: 'null-x', nodeId: controller, propertyId: 'transform.x', defaultEasing: 'linear', keyframes: [
  { id: 'x-0', time: 0, value: 480 }, { id: 'x-1', time: 1, value: 680 },
] })
const engine = getAnimEngine()
engine.attach(api)
engine.seek(0.5)
useUI.getState().setPlayhead(0.5)
export function CameraNullCheck() {
  const [, setVersion] = useState(0)
  useEffect(() => api.subscribe(() => setVersion(v => v + 1)), [])
  const camera = api.getNode(cameraId) as CameraNode
  const pose = resolveCamera3D(camera, engine.getSnapshot()[cameraId], api.getMeta().canvas)
  const t = api.getNode(controller)!.transform
  return <main style={{ font: '14px system-ui', maxWidth: 600, padding: 24 }}>
    <h1>Camera Null alignment</h1>
    <NullParentSection node={camera} api={api} />
    <p>Camera eye: <output aria-label="Camera eye">{JSON.stringify(pose.position)}</output></p>
    <p>Null pivot: <output aria-label="Null pivot">{JSON.stringify({ x: t.x, y: t.y, z: t.z })}</output></p>
    <button onClick={() => api.setNodeProperty(controller, 'transform', { ...t, rotationY: t.rotationY + 45 })}>Rotate Null 45°</button>
    <button onClick={() => api.setNodeProperty(cameraId, 'transform', { ...camera.transform, rotationX: camera.transform.rotationX + 30 })}>Rotate camera 30°</button>
    <p>Rotation: Null Y {t.rotationY}°, camera X {camera.transform.rotationX}°</p>
    <p>Null tracks: <output>{JSON.stringify(api.getTracksForNode(controller))}</output></p>
  </main>
}
createRoot(document.getElementById('root')!).render(<CameraNullCheck />)

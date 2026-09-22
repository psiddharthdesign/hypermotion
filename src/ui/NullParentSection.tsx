// SPDX-License-Identifier: Apache-2.0
import { useState, useSyncExternalStore } from 'react'
import { Link2, Unlink } from 'lucide-react'
import type { Node, SceneAPI } from '@/scene'
import { getAnimEngine } from '@/anim'
import { alignNullToCamera, canParentToNull, createNullResolver, hasNullTransform, resetNullConnectionOffset, setNullParent } from '@/scene/nullObject'
import { recordKeyframesForPatch, stampToActiveTracksForPatch } from '@/anim/recordKeyframes'
import { currentAnimationAuthorTime } from '@/ui/animationPlayhead'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { useUI } from '@/state/ui'
import { Euler, Matrix4, Vector3 } from 'three'
import { resolveCameraPose } from '@/render3d/cameraPose'
import type { CameraNode } from '@/scene/types'

export function NullParentSection({ node, api }: { node: Node; api: SceneAPI }) {
  const [error, setError] = useState('')
  if (node.id === api.getRoot() || node.kind === 'audio') return null
  const nulls = api.getAllNodeIds().flatMap((id) => {
    const candidate = api.getNode(id)
    return candidate?.kind === 'null' && (candidate.id === node.transformParent?.nodeId || canParentToNull(api, node.id, id)) ? [candidate] : []
  })
  const linked = api.getAllNodeIds().flatMap((id) => {
    const candidate = api.getNode(id)
    return candidate?.transformParent?.nodeId === node.id ? [candidate] : []
  })
  return (
    <section className="space-y-2 border-t border-border pt-3" aria-label="Null connection">
      <div className="flex items-center gap-2 text-[11px] font-medium text-text-muted"><Link2 size={13} />Parent to Null</div>
      <select aria-label="Parent to Null" disabled={node.locked}
        className="w-full rounded-md border border-border bg-panel-raised px-2 py-1.5 text-[12px] text-text"
        value={node.transformParent?.nodeId ?? ''}
        onChange={(event) => {
          const ok = setNullParent(api, node.id, event.target.value || null, getAnimEngine().getSnapshot())
          setError(ok ? '' : 'Cannot connect while the Null has zero scale.')
        }}>
        <option value="">None</option>
        {nulls.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      {node.kind === 'camera' && node.transformParent && <>
        <CameraNullPosition node={node} api={api} />
        <button type="button" disabled={node.locked} className="w-full rounded-md border border-border px-2 py-1.5 text-[12px]"
          onClick={() => api.doc.transact(() => {
            const result = alignNullToCamera(api, node.id, getAnimEngine().getSnapshot())
            if (!result) { setError('Unlock the camera and Null, and use non-zero Null scale to align.'); return }
            const stamp = useUI.getState().recording ? recordKeyframesForPatch : stampToActiveTracksForPatch
            stamp(api, result.id, currentAnimationAuthorTime(), 'transform', result.patch)
            setError('')
          }, UNDOABLE_GESTURE_ORIGIN)}>Align Null to camera</button>
      </>}
      <InheritedRotation node={node} api={api} onError={setError} />
      {error && <p role="alert" className="text-[11px] text-red-400">{error}</p>}
      {node.kind === 'null' && <>
        <p className="text-[11px] text-text-dim">Invisible in exports. Animate this Null to move, rotate, or scale its connected layers and cameras.</p>
        <div className="text-[11px] text-text-muted">{linked.length} connected {linked.length === 1 ? 'object' : 'objects'}</div>
        {linked.map((item) => <div key={item.id} className="flex items-center gap-2 text-[12px]">
          <button className="min-w-0 flex-1 truncate text-left hover:text-accent" onClick={() => useUI.getState().setSelection([item.id])}>{item.name}</button>
          <button disabled={item.locked} aria-label={`Disconnect ${item.name}`} title={`Disconnect ${item.name}`} onClick={() => setNullParent(api, item.id, null, getAnimEngine().getSnapshot())}><Unlink size={13} /></button>
        </div>)}
      </>}
    </section>
  )
}


function CameraNullPosition({ node, api }: { node: CameraNode; api: SceneAPI }) {
  const engine = getAnimEngine()
  const animated = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot)
  const parent = node.transformParent && api.getNode(node.transformParent.nodeId)
  if (parent?.kind !== 'null') return null
  const resolver = createNullResolver(id => api.getNode(id), animated)
  const localEye = resolveCameraPose(node, animated[node.id], api.getMeta().canvas).position
  const eye = new Vector3(localEye.x, localEye.y, localEye.z).applyMatrix4(resolver.delta(node))
  const pivot = new Vector3().applyMatrix4(resolver.world(parent))
  const distance = eye.distanceTo(pivot)
  const point = (v: Vector3) => `X ${v.x.toFixed(1)}, Y ${v.y.toFixed(1)}, Z ${v.z.toFixed(1)}`
  return <div className="space-y-1 text-[11px] text-text-dim">
    <p>Parenting preserves spacing. Rotating the Null uses its pivot; rotating the camera turns it in place.</p>
    <p>Camera world position: {point(eye)}</p>
    <p>Null world pivot: {point(pivot)}</p>
    <p>{distance < 0.01 ? 'Camera and Null pivots coincide.' : `Camera is ${distance.toFixed(1)} px from the Null pivot.`}</p>
  </div>
}


function InheritedRotation({ node, api, onError }: { node: Node; api: SceneAPI; onError: (message: string) => void }) {
  const engine = getAnimEngine()
  const animated = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot)
  if (!hasNullTransform(node)) return null
  const delta = createNullResolver(id => api.getNode(id), animated).delta(node)
  const rotation = new Euler().setFromRotationMatrix(new Matrix4().extractRotation(delta), 'ZYX')
  const degrees = (value: number) => (value * 180 / Math.PI).toFixed(1)
  return <details className="text-[11px] text-text-dim">
    <summary>Inherited rotation: X {degrees(rotation.x)}°, Y {degrees(rotation.y)}°, Z {degrees(rotation.z)}°</summary>
    <p className="my-2">Connections can retain movement, rotation, and scale from an earlier pose. Reset restores the layer’s own transform values and keeps it connected.</p>
    <button type="button" disabled={node.locked} className="w-full rounded-md border border-border px-2 py-1.5 text-[12px]"
      onClick={() => onError(resetNullConnectionOffset(api, node.id, engine.getSnapshot()) ? '' : 'Unlock the layer and use non-zero Null scale to reset.')}>Reset connection offset</button>
  </details>
}

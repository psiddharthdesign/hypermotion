// SPDX-License-Identifier: Apache-2.0
import { useMemo, useRef } from 'react'
import { SquareDashed } from 'lucide-react'
import { Vector3 } from 'three'
import type { CameraNode, NodeId, SceneAPI } from '@/scene'
import { createNullResolver } from '@/scene/nullObject'
import { useAnimatedValues } from '@/ui/hooks/useAnimatedValues'
import { useUI } from '@/state/ui'
import { nodeTransformPreviewStore } from '@/ui/nodeTransformPreviewStore'
import { recordKeyframesForPatch, stampToActiveTracksForPatch } from '@/anim/recordKeyframes'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { projectWorldPoint, resolveCamera3D, viewportPointToRay } from '@/render3d/scene3d'

/** Editor-only point handles. Controller geometry is never part of the rendered scene. */
export function NullObjectOverlay({ api, camera, ids, width, height, zoom }: {
  api: SceneAPI; camera: CameraNode | null; ids: NodeId[]; width: number; height: number; zoom: number
}) {
  const animationIds = useMemo(() => camera ? [...ids, camera.id] : ids, [ids, camera])
  const animated = useAnimatedValues(animationIds)
  const selection = useUI((state) => state.selection)
  const drag = useRef<{
    id: string; clientX: number; clientY: number; start: Vector3;
    screen: { x: number; y: number }; inverse: ReturnType<ReturnType<typeof createNullResolver>['delta']>;
    camera: ReturnType<typeof resolveCamera3D> | null; patch?: { x: number; y: number; z: number }
  } | null>(null)
  const resolver = createNullResolver((id) => api.getNode(id), animated)
  const viewport = { width, height }
  const resolvedCamera = camera ? resolveCamera3D(camera, animated[camera.id], viewport) : null
  return <div data-export-hide="1" className="pointer-events-none absolute" style={{ left: -width / 2, top: -height / 2, width, height }}>
    {ids.map((id) => {
      const node = api.getNode(id)
      if (!node || !node.visible) return null
      const world = new Vector3().applyMatrix4(resolver.world(node))
      const screen = resolvedCamera ? projectWorldPoint(world, resolvedCamera, viewport) : world
      const selected = selection.includes(id)
      const size = 32 / zoom
      const finish = (cancel: boolean) => {
        const gesture = drag.current
        drag.current = null
        if (!cancel && gesture?.patch) {
          const patch = gesture.patch
          const ui = useUI.getState()
          api.doc.transact(() => {
            const current = api.getNode(gesture.id)
            if (!current) return
            api.setNodeProperty(gesture.id, 'transform', { ...current.transform, ...patch })
            if (ui.recording) recordKeyframesForPatch(api, gesture.id, ui.playhead, 'transform', patch)
            else stampToActiveTracksForPatch(api, gesture.id, ui.playhead, 'transform', patch)
          }, UNDOABLE_GESTURE_ORIGIN)
        }
        nodeTransformPreviewStore.finish()
      }
      return <button key={id} type="button" aria-label={`Select ${node.name}`} title={`${node.name} · drag to move`}
        className="pointer-events-auto absolute border-0 bg-transparent p-0"
        style={{ left: screen.x, top: screen.y, width: size, height: size, transform: 'translate(-50%, -50%)', color: selected ? 'var(--color-accent)' : 'var(--color-text-muted)', cursor: node.locked ? 'default' : 'move' }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          useUI.getState().setSelection([id])
          if (node.locked) return
          const delta = resolver.delta(node)
          if (Math.abs(delta.determinant()) < 1e-10) return
          drag.current = { id, clientX: event.clientX, clientY: event.clientY, start: world, screen, inverse: delta.invert(), camera: resolvedCamera }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const gesture = drag.current
          if (!gesture || gesture.id !== id) return
          event.stopPropagation()
          const x = gesture.screen.x + (event.clientX - gesture.clientX) / zoom
          const y = gesture.screen.y + (event.clientY - gesture.clientY) / zoom
          let position = new Vector3(x, y, gesture.start.z)
          if (gesture.camera) {
            const ray = viewportPointToRay(gesture.camera, x, y, viewport)
            if (Math.abs(ray.direction.z) < 1e-8) return
            const distance = (gesture.start.z - ray.origin.z) / ray.direction.z
            position = new Vector3(ray.origin.x, ray.origin.y, ray.origin.z).addScaledVector(new Vector3(ray.direction.x, ray.direction.y, ray.direction.z), distance)
          }
          position.applyMatrix4(gesture.inverse)
          gesture.patch = { x: position.x, y: position.y, z: position.z }
          nodeTransformPreviewStore.preview({ [id]: gesture.patch })
        }}
        onPointerUp={(event) => { event.stopPropagation(); finish(false) }}
        onPointerCancel={() => finish(true)}
        onLostPointerCapture={() => { if (drag.current) finish(true) }}>
        <SquareDashed width={size} height={size} strokeWidth={1.5} />
        {selected && <span className="absolute whitespace-nowrap" style={{ left: size + 4 / zoom, top: 0, fontSize: 11 / zoom }}>{node.name}</span>}
      </button>
    })}
  </div>
}

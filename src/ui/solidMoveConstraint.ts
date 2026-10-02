// SPDX-License-Identifier: Apache-2.0
import { Matrix3, Vector3 } from 'three'
import type { AnimatedValue } from '@/anim'
import { getAnimEngine } from '@/anim'
import type { NodeId, SceneAPI } from '@/scene'
import type { SolvedLayout } from '@/layout'
import { buildWorldPlanes, createPlaneBuildContext, resolveCamera3D, type ResolvedCamera3D } from '@/render3d/scene3d'
import { useUI } from '@/state/ui'
import { getLastSolvedLayout } from './hooks/lastSolvedLayout'
import { selectedSolidNodeIds } from './solidFaceSelection'
import { createSolidPlacementSession, constrainSolidTranslation } from './solidPlacement'

export type SolidMoveConstraint = (delta: { x: number; y: number; z?: number }, bypass?: boolean, snap?: boolean) => { x: number; y: number; z: number }

/** Freeze placement geometry once per gesture, in the layer's incoming parent basis. */
export function createSolidMoveConstraint(api: SceneAPI, nodeId: NodeId, layout?: SolvedLayout | null, animated: Record<NodeId, AnimatedValue> = getAnimEngine().getSnapshot(), camera?: ResolvedCamera3D): SolidMoveConstraint | null {
  if (selectedSolidNodeIds(api, [nodeId]).size === 0) return null
  const solved = layout ?? getLastSolvedLayout()
  const cameraNode = api.getActiveCamera()
  if (!solved || (!camera && !cameraNode)) return null
  const resolved = camera ?? resolveCamera3D(cameraNode!, animated[cameraNode!.id], api.getMeta().canvas)
  const context = createPlaneBuildContext(api)
  const planes = buildWorldPlanes(api, solved, animated, resolved, { context, independentNodes: true })
  const plane = planes.find(p => p.nodeId === nodeId)
  if (!plane) return null
  const bx = plane.motionPathBasisX, by = plane.motionPathBasisY, bz = plane.motionPathBasisZ
  const basis = new Matrix3().set(bx.x, by.x, bz.x, bx.y, by.y, bz.y, bx.z, by.z, bz.z)
  if (Math.abs(basis.determinant()) < 1e-9) return null
  const inverse = basis.clone().invert()
  const session = createSolidPlacementSession(planes, [nodeId], context.nodesById)
  return (delta, bypass = false, snap = true) => {
    const ui = useUI.getState()
    const world = new Vector3(delta.x, delta.y, delta.z ?? 0).applyMatrix3(basis)
    const axes = (['x', 'y', 'z'] as const).filter(axis => Math.abs(bx[axis]) + Math.abs(by[axis]) + (delta.z === undefined ? 0 : Math.abs(bz[axis])) > 1e-7)
    let result = constrainSolidTranslation(session, world, { snapToGrid: snap && ui.solidGridSnapEnabled, gridSize: ui.solidGridSize, axes, bypass })
    const local = new Vector3(result.delta.x, result.delta.y, result.delta.z).applyMatrix3(inverse)
    if (delta.z === undefined && Math.abs(local.z) > 1e-7) {
      // Keep a tilted parent's 2D move in its editing plane. Recheck contact
      // after projecting a snapped point back onto that plane.
      local.z = 0
      const projected = local.clone().applyMatrix3(basis)
      result = constrainSolidTranslation(session, projected, { bypass })
      local.set(result.delta.x, result.delta.y, result.delta.z).applyMatrix3(inverse)
    }
    return { x: local.x, y: local.y, z: local.z }
  }
}

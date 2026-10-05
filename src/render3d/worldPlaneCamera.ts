// SPDX-License-Identifier: Apache-2.0

import type { AnimatedValue } from '@/anim'
import type { Node, NodeId } from '@/scene'
import { animatedArrangement } from '@/scene/arrangement'
import { cameraBasis, type ResolvedCamera3D } from './scene3d'
import type { Vec3 } from './math'

/** Billboarding makes member world geometry depend on the camera pose. */
export function hasCameraFacingArrangements(
  nodes: ReadonlyMap<NodeId, Node>,
  animated: Record<NodeId, AnimatedValue>,
): boolean {
  for (const node of nodes.values()) {
    if (node.kind !== 'arrangement' || !node.visible || !node.arrangement) continue
    if (animatedArrangement(node.arrangement, animated[node.id]?.arrangement).orientation !== 'screen') continue
    if (node.arrangement.memberIds.some(id => nodes.get(id)?.transformParent?.nodeId === node.id)) return true
  }
  return false
}

function sameVector(a: Vec3, b: Vec3): boolean {
  return Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12 && Math.abs(a.z - b.z) < 1e-12
}

/**
 * Ordinary layers retain the camera-independent plane cache. Billboards use
 * the current resolved pose, including gesture previews and Null camera rigs.
 * Focus and post-effect values never invalidate that geometry cache. Compare
 * the actual basis (not just Euler angles) so rig/point-of-interest changes
 * and roll are included. Position also keeps the planes' depth metadata fresh.
 */
export function createWorldPlaneCameraSelector() {
  let previous: ResolvedCamera3D | undefined
  let previousBasis: ReturnType<typeof cameraBasis> | undefined
  return (reference: ResolvedCamera3D, live: ResolvedCamera3D, cameraFacing: boolean): ResolvedCamera3D => {
    if (!cameraFacing) {
      previous = undefined
      previousBasis = undefined
      return reference
    }
    const basis = cameraBasis(live)
    if (previous && previousBasis && sameVector(previous.position, live.position) &&
      sameVector(previousBasis.right, basis.right) && sameVector(previousBasis.down, basis.down) &&
      sameVector(previousBasis.forward, basis.forward)) return previous
    previous = live
    previousBasis = basis
    return live
  }
}

// SPDX-License-Identifier: Apache-2.0

import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { AnimatedValue } from '@/anim'
import type { Node } from '@/scene'
import { extrusionShapeLimitation, normalizeExtrusion, normalizeExtrusionDepth, type Extrusion } from '@/scene/extrusion'
import type { Plane3D } from './scene3d'
import type { ExtrusionGeometryOptions } from './extrusionGeometry'

/** Only complete outlines have a closed body in the first solid-layer implementation. */
export function resolveNodeExtrusion(node: Node, animated?: AnimatedValue): Extrusion | undefined {
  if (node.kind !== 'rect' && node.kind !== 'ellipse') return undefined
  if (extrusionShapeLimitation(node, animated)) return undefined
  const extrusion = normalizeExtrusion(node.extrusion)
  return extrusion ? { ...extrusion, depth: normalizeExtrusionDepth(animated?.extrusionDepth ?? extrusion.depth) } : undefined
}

export function extrusionShapeForPlane(plane: Plane3D): ExtrusionGeometryOptions | null {
  if (!plane.extrusion || (plane.node.kind !== 'rect' && plane.node.kind !== 'ellipse')) return null
  return {
    kind: plane.node.kind, width: plane.rect.width, height: plane.rect.height,
    depth: plane.extrusion.depth, cornerRadius: plane.extrusionCornerRadius,
  }
}

/** Keep picking's affine transform identical to applyPlaneTransform in the renderer. */
export function extrusionWorldMatrix(plane: Plane3D): number[] {
  if (plane.transformMatrix) return new Matrix4().fromArray(plane.transformMatrix)
    .setPosition(plane.center.x, plane.center.y, plane.center.z).toArray()
  const radians = Math.PI / 180
  return new Matrix4().compose(
    new Vector3(plane.center.x, plane.center.y, plane.center.z),
    new Quaternion().setFromEuler(new Euler(plane.rotation.x * radians, plane.rotation.y * radians, plane.rotation.z * radians, 'XYZ')),
    new Vector3(plane.scaleX, plane.scaleY, 1),
  ).toArray()
}

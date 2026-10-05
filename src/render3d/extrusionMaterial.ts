// SPDX-License-Identifier: Apache-2.0

import type { MeshBasicMaterial } from 'three'
import { copyAlphaMasks } from './alphaMaskShader'

/** Share resolved layer compositing while retaining the body's own color and geometry. */
export function syncExtrusionMaterial(source: MeshBasicMaterial, target: MeshBasicMaterial): void {
  let changed = false
  for (const field of [
    'transparent', 'premultipliedAlpha', 'blending',
    'blendEquation', 'blendSrc', 'blendDst',
    'blendEquationAlpha', 'blendSrcAlpha', 'blendDstAlpha',
  ] as const) {
    if (target[field] !== source[field]) {
      Object.assign(target, { [field]: source[field] })
      changed = true
    }
  }
  if ((target.clippingPlanes?.length ?? 0) !== (source.clippingPlanes?.length ?? 0)) changed = true
  target.clippingPlanes = source.clippingPlanes
  target.clipIntersection = source.clipIntersection
  target.opacity = source.opacity
  target.depthTest = source.depthTest
  target.depthWrite = source.depthWrite
  // Mask samples are world-space, so the same mask matrices work for walls
  // without reusing the front cap's UVs or transferring texture ownership.
  copyAlphaMasks(source, target)
  if (changed) target.needsUpdate = true
}

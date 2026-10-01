// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'

export interface BloomCanvasRaster {
  texture: THREE.CanvasTexture
  revision: object
  signature: string
}

/** One canonical canvas per plane; output density never participates in its key. */
export function syncBloomCanvasRaster(
  current: BloomCanvasRaster | undefined,
  revision: object,
  signature: string,
  paint: () => HTMLCanvasElement,
  createTexture: (canvas: HTMLCanvasElement) => THREE.CanvasTexture,
  defer = false,
): BloomCanvasRaster {
  if (current && (defer || current.revision === revision && current.signature === signature)) return current
  const canvas = paint()
  if (current && current.texture.image.width === canvas.width && current.texture.image.height === canvas.height) {
    current.texture.image = canvas
    current.texture.needsUpdate = true
    current.revision = revision
    current.signature = signature
    return current
  }
  current?.texture.dispose()
  return { texture: createTexture(canvas), revision, signature }
}

export interface BloomRasterOverride {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  texture: THREE.Texture
  geometry?: THREE.BufferGeometry
}

/**
 * Geometry must switch before Three builds its render list, not from a mesh's
 * onBeforeRender hook. Keep the base map/atlas intact even if a draw fails.
 */
export function withBloomRasterOverrides(
  overrides: Iterable<BloomRasterOverride>,
  draw: () => void,
): void {
  const originals: Array<{
    mesh: BloomRasterOverride['mesh']
    texture: THREE.Texture | null
    geometry: THREE.BufferGeometry
  }> = []
  try {
    for (const override of overrides) {
      originals.push({ mesh: override.mesh, texture: override.mesh.material.map, geometry: override.mesh.geometry })
      override.mesh.material.map = override.texture
      if (override.geometry) override.mesh.geometry = override.geometry
    }
    draw()
  } finally {
    for (const original of originals) {
      original.mesh.material.map = original.texture
      original.mesh.geometry = original.geometry
    }
  }
}

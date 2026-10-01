// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { syncBloomCanvasRaster, withBloomRasterOverrides } from './bloomRaster'

function canvas(width = 320, height = 160): HTMLCanvasElement {
  return { width, height } as HTMLCanvasElement
}

describe('canonical bloom rasters', () => {
  it('reuses the reference texture across unrelated full-resolution draws', () => {
    const revision = {}
    const paint = vi.fn(() => canvas())
    const createTexture = vi.fn(image => new THREE.CanvasTexture(image))
    const cached = syncBloomCanvasRaster(undefined, revision, 'text:scale=2.5', paint, createTexture)
    const base = new THREE.Texture()
    const material = new THREE.MeshBasicMaterial({ map: base })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material)

    for (const outputRatio of [0.25, 1, 2, 0.25]) {
      // Export's base raster can change freely without entering the canonical
      // cache key, and the source pass must never leave its map on the base.
      const fullResolutionMap = new THREE.CanvasTexture(canvas(320 * outputRatio * 4, 160 * outputRatio * 4))
      material.map = fullResolutionMap
      expect(syncBloomCanvasRaster(cached, revision, 'text:scale=2.5', paint, createTexture)).toBe(cached)
      withBloomRasterOverrides([{ mesh, texture: cached.texture }], () => {
        expect(material.map).toBe(cached.texture)
      })
      expect(material.map).toBe(fullResolutionMap)
      fullResolutionMap.dispose()
    }
    expect(paint).toHaveBeenCalledTimes(1)
    expect(createTexture).toHaveBeenCalledTimes(1)
    cached.texture.dispose()
    mesh.geometry.dispose()
    material.dispose()
    base.dispose()
  })

  it('refreshes paint and scene revisions while retaining same-size GPU storage', () => {
    const firstRevision = {}
    const createTexture = vi.fn(image => new THREE.CanvasTexture(image))
    const first = syncBloomCanvasRaster(undefined, firstRevision, 'text-a', () => canvas(), createTexture)
    const dispose = vi.spyOn(first.texture, 'dispose')
    const image = canvas()
    const version = first.texture.version
    const repainted = syncBloomCanvasRaster(first, firstRevision, 'text-b', () => image, createTexture)
    expect(repainted).toBe(first)
    expect(repainted.texture.image).toBe(image)
    expect(repainted.texture.version).toBeGreaterThan(version)

    const nextRevision = {}
    const sceneImage = canvas()
    expect(syncBloomCanvasRaster(first, nextRevision, 'text-b', () => sceneImage, createTexture)).toBe(first)
    expect(first.texture.image).toBe(sceneImage)
    expect(first.revision).toBe(nextRevision)
    expect(createTexture).toHaveBeenCalledTimes(1)
    expect(dispose).not.toHaveBeenCalled()
    first.texture.dispose()
  })

  it('releases obsolete GPU storage after camera scale or geometry changes', () => {
    const revision = {}
    const createTexture = (image: HTMLCanvasElement) => new THREE.CanvasTexture(image)
    const first = syncBloomCanvasRaster(undefined, revision, 'scale=4', () => canvas(640, 320), createTexture)
    const dispose = vi.spyOn(first.texture, 'dispose')
    const second = syncBloomCanvasRaster(first, revision, 'scale=1', () => canvas(160, 80), createTexture)
    expect(second.texture).not.toBe(first.texture)
    expect(second.texture.image.width).toBe(160)
    expect(dispose).toHaveBeenCalledTimes(1)
    second.texture.dispose()
  })

  it('defers an existing resize preview but always paints a new cache and the committed state', () => {
    const revision = {}
    const paint = vi.fn(() => canvas())
    const createTexture = (image: HTMLCanvasElement) => new THREE.CanvasTexture(image)
    const first = syncBloomCanvasRaster(undefined, revision, 'initial', paint, createTexture, true)
    expect(paint).toHaveBeenCalledTimes(1)
    expect(syncBloomCanvasRaster(first, {}, 'resizing', paint, createTexture, true)).toBe(first)
    expect(paint).toHaveBeenCalledTimes(1)
    syncBloomCanvasRaster(first, {}, 'committed', paint, createTexture)
    expect(paint).toHaveBeenCalledTimes(2)
    first.texture.dispose()
  })
})

describe('canonical bloom atlas draw', () => {
  it.each([false, true])('swaps atlas UV geometry with its map and restores all planes (draw fails: %s)', fail => {
    const normalTexture = new THREE.Texture()
    const atlasTexture = new THREE.Texture()
    const sourceTexture = new THREE.Texture()
    const sourceAtlas = new THREE.Texture()
    const normal = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: normalTexture }))
    const text = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: atlasTexture }))
    const originalGeometry = text.geometry
    const sourceGeometry = new THREE.BufferGeometry()
    const materialVersion = text.material.version
    const draw = () => withBloomRasterOverrides([
      { mesh: normal, texture: sourceTexture },
      { mesh: text, texture: sourceAtlas, geometry: sourceGeometry },
    ], () => {
      expect(normal.material.map).toBe(sourceTexture)
      expect(text.material.map).toBe(sourceAtlas)
      expect(text.geometry).toBe(sourceGeometry)
      if (fail) throw new Error('source draw failed')
    })
    if (fail) expect(draw).toThrow('source draw failed')
    else draw()
    expect(normal.material.map).toBe(normalTexture)
    expect(text.material.map).toBe(atlasTexture)
    expect(text.geometry).toBe(originalGeometry)
    expect(text.material.version).toBe(materialVersion)
    for (const texture of [normalTexture, atlasTexture, sourceTexture, sourceAtlas]) texture.dispose()
    for (const geometry of [normal.geometry, originalGeometry, sourceGeometry]) geometry.dispose()
    normal.material.dispose()
    text.material.dispose()
  })
})

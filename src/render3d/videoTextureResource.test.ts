// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { ensureVideoTexture } from './videoTextureResource'

function fixture() {
  let callback: (() => void) | undefined
  const video = {
    get src(): string { throw new Error('Must not serialize native video source every frame') },
    pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn(),
    requestVideoFrameCallback: vi.fn((cb: () => void) => { callback = cb; return 1 }),
    cancelVideoFrameCallback: vi.fn(),
  } as unknown as HTMLVideoElement
  return { video, decode: () => callback!() }
}

describe('video texture continuity during property animation', () => {
  it('reuses the decoder across 120 transform/opacity updates without uploading stale frames', () => {
    const { video, decode } = fixture()
    const create = vi.fn(() => video)
    const record = { texture: new THREE.CanvasTexture(), textureKind: 'canvas' as 'canvas' | 'video' }
    expect(ensureVideoTexture(record, 'data:video/webm;base64,test', create)).toBe(true)
    const texture = record.texture
    const version = texture.version
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: texture, transparent: true }))
    for (let i = 0; i < 120; i++) {
      mesh.material.opacity = i / 120
      mesh.position.set(i, i / 2, i / 3)
      mesh.rotation.x = i / 100
      expect(ensureVideoTexture(record, 'data:video/webm;base64,test', create)).toBe(false)
    }
    expect(create).toHaveBeenCalledOnce()
    expect(record.texture).toBe(texture)
    expect(texture.version).toBe(version)
    expect(video.pause).not.toHaveBeenCalled()
    expect(video.load).not.toHaveBeenCalled()
    decode()
    expect(texture.version).toBe(version + 1)
    texture.dispose()
    mesh.material.dispose()
    mesh.geometry.dispose()
  })

  it('releases the old decoder only when the source is replaced', () => {
    const first = fixture().video
    const second = fixture().video
    const record = { texture: new THREE.CanvasTexture(), textureKind: 'canvas' as 'canvas' | 'video' }
    ensureVideoTexture(record, 'first', () => first)
    const oldTexture = record.texture
    expect(ensureVideoTexture(record, 'second', () => second)).toBe(true)
    expect(record.texture).not.toBe(oldTexture)
    expect(first.pause).toHaveBeenCalledOnce()
    expect(first.cancelVideoFrameCallback).toHaveBeenCalledOnce()
    expect(first.removeAttribute).toHaveBeenCalledWith('src')
    record.texture.dispose()
  })
})

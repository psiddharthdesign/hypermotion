// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collectRender3dImageSources,
  preloadRender3dImageSources,
} from './imageTextureCache'

class FakeImage extends EventTarget {
  static created: FakeImage[] = []

  crossOrigin: string | null = null
  decoding = ''
  complete = false
  naturalWidth = 0
  naturalHeight = 0
  onload: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  private source = ''

  constructor() {
    super()
    FakeImage.created.push(this)
  }

  get src(): string {
    return this.source
  }

  set src(value: string) {
    this.source = value
    if (value.includes('pending')) return
    queueMicrotask(() => {
      this.complete = true
      const failed = value.includes('broken')
      this.naturalWidth = failed ? 0 : 1600
      this.naturalHeight = failed ? 0 : 900
      const event = new Event(failed ? 'error' : 'load')
      if (failed) this.onerror?.(event)
      else this.onload?.(event)
      this.dispatchEvent(event)
    })
  }

  async decode(): Promise<void> {}
}

describe('render3d image texture readiness', () => {
  beforeEach(() => {
    FakeImage.created = []
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal('window', new EventTarget())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('deduplicates sources and waits for their natural dimensions', async () => {
    await preloadRender3dImageSources(
      ['data:image/png;base64,ready-one', 'data:image/png;base64,ready-one'],
      100,
    )

    expect(FakeImage.created).toHaveLength(1)
    expect(FakeImage.created[0]?.naturalWidth).toBe(1600)
  })

  it('rejects a broken bitmap instead of exporting a placeholder', async () => {
    await expect(
      preloadRender3dImageSources(
        ['data:image/png;base64,broken-source'],
        100,
      ),
    ).rejects.toThrow('Unable to load image source data:image/png data URL')
  })

  it('invalidates textures again after the complete preload barrier', async () => {
    const source = 'data:image/png;base64,ready-invalidation'
    await preloadRender3dImageSources([source], 100)
    let invalidations = 0
    window.addEventListener('hypermotion:render3d-image-loaded', () => {
      invalidations += 1
    })

    await preloadRender3dImageSources([source], 100)

    expect(invalidations).toBe(1)
  })

  it('times out when a bitmap never settles', async () => {
    await expect(
      preloadRender3dImageSources(
        ['data:image/png;base64,pending-source'],
        10,
      ),
    ).rejects.toThrow('Timed out while decoding 1 image source')
  })

  it('collects reachable image nodes, image fills, and camera backgrounds once', () => {
    const nodes = {
      root: {
        kind: 'frame',
        children: ['image', 'fill', 'duplicate'],
        appearance: { fill: null },
      },
      image: {
        kind: 'image',
        src: 'image-node.png',
        children: [],
        appearance: { fill: null },
      },
      fill: {
        kind: 'rect',
        children: [],
        appearance: {
          fill: { kind: 'image', src: 'image-fill.png', fit: 'cover' },
        },
      },
      duplicate: {
        kind: 'image',
        src: 'image-node.png',
        children: [],
        appearance: { fill: null },
      },
      camera: {
        kind: 'camera',
        children: [],
        background: {
          kind: 'image',
          src: 'camera-background.png',
          fit: 'cover',
        },
        appearance: { fill: null },
      },
      workspace: {
        kind: 'image',
        src: 'unreachable-workspace.png',
        children: [],
        appearance: { fill: null },
      },
    }
    const api = {
      getAllNodeIds: () => Object.keys(nodes),
      getNode: (id: string) => nodes[id as keyof typeof nodes] ?? null,
    }

    expect(
      new Set(collectRender3dImageSources(api as never, ['root', 'camera'])),
    ).toEqual(
      new Set([
        'image-node.png',
        'image-fill.png',
        'camera-background.png',
      ]),
    )
  })
})

// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomFont } from '@/scene/types'
import {
  buildFontFaceUrl,
  isFontRegistered,
  registerFont,
  unregisterFont,
} from './registration'

interface FakeFace {
  family: string
  source: ArrayBuffer
  descriptors: { weight: string; style: string; display: string }
  load(): Promise<FakeFace>
}

let faceSet: Set<FakeFace>
let loadFails = false

function font(overrides: Partial<CustomFont> = {}): CustomFont {
  return {
    id: 'font-1',
    name: 'Inter-Bold.woff2',
    family: 'Inter',
    weight: 700,
    style: 'normal',
    format: 'woff2',
    bytes: new Uint8Array([1, 2, 3, 4]),
    ...overrides,
  }
}

beforeEach(() => {
  faceSet = new Set<FakeFace>()
  loadFails = false
  vi.stubGlobal(
    'FontFace',
    class {
      family: string
      source: ArrayBuffer
      descriptors: FakeFace['descriptors']
      constructor(family: string, source: ArrayBuffer, descriptors: FakeFace['descriptors']) {
        this.family = family
        this.source = source
        this.descriptors = descriptors
      }
      load(): Promise<unknown> {
        return loadFails ? Promise.reject(new Error('corrupt')) : Promise.resolve(this)
      }
    },
  )
  vi.stubGlobal('document', {
    fonts: {
      add: (face: FakeFace) => faceSet.add(face),
      delete: (face: FakeFace) => faceSet.delete(face),
    },
  })
})

afterEach(async () => {
  await unregisterFont(font())
  await unregisterFont(font({ id: 'font-2' }))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('font registration', () => {
  it('adds a loaded face carrying the scene font descriptors', async () => {
    const inter = font()
    await expect(registerFont(inter)).resolves.toBe(true)
    expect(isFontRegistered(inter)).toBe(true)
    const [face] = [...faceSet]
    expect(face?.family).toBe('Inter')
    expect(face?.descriptors).toEqual({ weight: '700', style: 'normal', display: 'block' })
    expect(new Uint8Array(face!.source)).toEqual(inter.bytes)
  })

  it('replaces the prior face registered under the same id', async () => {
    await registerFont(font())
    await registerFont(font({ family: 'Inter Tight' }))
    expect(faceSet.size).toBe(1)
    expect([...faceSet][0]?.family).toBe('Inter Tight')
  })

  it('keeps distinct ids side by side', async () => {
    await registerFont(font())
    await registerFont(font({ id: 'font-2', family: 'Mono' }))
    expect(faceSet.size).toBe(2)
    expect(isFontRegistered(font({ id: 'font-2' }))).toBe(true)
  })

  it('reports failure and stays unregistered when the face will not load', async () => {
    loadFails = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const inter = font()
    await expect(registerFont(inter)).resolves.toBe(false)
    expect(isFontRegistered(inter)).toBe(false)
    expect(faceSet.size).toBe(0)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('unregisters a face and tolerates a second call', async () => {
    const inter = font()
    await registerFont(inter)
    await unregisterFont(inter)
    expect(faceSet.size).toBe(0)
    expect(isFontRegistered(inter)).toBe(false)
    await expect(unregisterFont(inter)).resolves.toBeUndefined()
  })

  it('does nothing outside a document that exposes FontFaceSet', async () => {
    vi.stubGlobal('document', {})
    const inter = font()
    await expect(registerFont(inter)).resolves.toBe(false)
    await expect(unregisterFont(inter)).resolves.toBeUndefined()
    expect(isFontRegistered(inter)).toBe(false)
  })
})

describe('font blob urls', () => {
  it('tags the blob with the mime type matching the font format', () => {
    const types: Array<[CustomFont['format'], string]> = [
      ['woff2', 'font/woff2'],
      ['woff', 'font/woff'],
      ['truetype', 'font/ttf'],
      ['opentype', 'font/otf'],
    ]
    for (const [format, mime] of types) {
      vi.stubGlobal('URL', { createObjectURL: (blob: Blob) => `blob:${blob.type}` })
      expect(buildFontFaceUrl(font({ format }))).toBe(`blob:${mime}`)
    }
  })
})

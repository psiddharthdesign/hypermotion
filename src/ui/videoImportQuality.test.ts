// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canDecodeVideoFile } from './videoCompatibility'
import { normalizeVideoFileForBrowser } from './importMedia'

vi.mock('./videoCompatibility', () => ({ canDecodeVideoFile: vi.fn() }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })

describe('video import quality', () => {
  it('keeps supported source bytes untouched, including during self-repair', async () => {
    const normalizeVideo = vi.fn()
    vi.stubGlobal('window', { hypermotion: { media: { normalizeVideo } } })
    vi.mocked(canDecodeVideoFile).mockResolvedValue(true)
    const file = new File(['original bytes'], '4k60.mp4', { type: 'video/mp4' })
    const result = await normalizeVideoFileForBrowser(file)
    expect(result.file).toBe(file)
    expect(result.normalized).toBe(false)
    expect(normalizeVideo).not.toHaveBeenCalled()
  })

  it('converts only sources the browser cannot decode', async () => {
    vi.mocked(canDecodeVideoFile).mockResolvedValue(false)
    const normalizeVideo = vi.fn().mockResolvedValue({
      name: 'compatible.webm', type: 'video/webm',
      bytes: new Uint8Array([1, 2, 3]), normalized: true,
    })
    vi.stubGlobal('window', { hypermotion: { media: { normalizeVideo } } })
    const result = await normalizeVideoFileForBrowser(new File(['source'], 'clip.mov'))
    expect(normalizeVideo).toHaveBeenCalledOnce()
    expect(result.normalized).toBe(true)
    expect(result.file.type).toBe('video/webm')
  })
})

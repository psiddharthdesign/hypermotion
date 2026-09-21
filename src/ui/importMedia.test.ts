// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canDecodeVideoFile,
  normalizeVideoFileForBrowser,
  resolveAudioImportTarget,
  resolveMediaImportStartTime,
} from './importMedia'

describe('video source preservation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function mockVideo(outcome: 'decoded' | 'unsupported' | 'timeout') {
    const video = {
      readyState: 2,
      duration: 0,
      videoWidth: 3776,
      videoHeight: 2160,
      onloadeddata: null as null | (() => void),
      onerror: null as null | (() => void),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(() => queueMicrotask(() => {
        if (outcome === 'decoded') video.onloadeddata?.()
        if (outcome === 'unsupported') video.onerror?.()
      })),
    }
    vi.stubGlobal('document', { createElement: () => video })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video-probe')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    return { video, revoke }
  }

  it('keeps a decodable original unchanged and never calls the converter', async () => {
    const { video, revoke } = mockVideo('decoded')
    const convert = vi.fn()
    vi.stubGlobal('window', { hypermotion: { media: { normalizeVideo: convert } } })
    const original = new File(['source bytes'], 'original.mp4', { type: 'video/mp4' })
    const result = await normalizeVideoFileForBrowser(original)
    expect(result.file).toBe(original)
    expect(result.normalized).toBe(false)
    expect(convert).not.toHaveBeenCalled()
    expect(video.removeAttribute).toHaveBeenCalledWith('src')
    expect(revoke).toHaveBeenCalledWith('blob:video-probe')
  })

  it('converts only when the browser cannot decode a frame', async () => {
    mockVideo('unsupported')
    const convert = vi.fn().mockResolvedValue({
      name: 'original-compatible.webm', type: 'video/webm',
      bytes: new Uint8Array([1, 2, 3]), normalized: true,
    })
    vi.stubGlobal('window', { hypermotion: { media: { normalizeVideo: convert } } })
    const original = new File(['source bytes'], 'original.mov', { type: 'video/quicktime' })
    const result = await normalizeVideoFileForBrowser(original)
    expect(convert).toHaveBeenCalledWith(expect.objectContaining({ name: original.name }))
    expect(result.normalized).toBe(true)
    expect(result.file.type).toBe('video/webm')
  })

  it('releases the decoder and object URL if the probe stalls', async () => {
    vi.useFakeTimers()
    const { video, revoke } = mockVideo('timeout')
    const result = canDecodeVideoFile(new File([''], 'stalled.mp4'))
    const rejected = expect(result).rejects.toThrow('Video checking took too long')
    await vi.advanceTimersByTimeAsync(30_000)
    await rejected
    expect(video.pause).toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledWith('blob:video-probe')
  })
})

describe('audio import ownership', () => {
  it('keeps parentless audio on the Master timeline', () => {
    expect(resolveAudioImportTarget(null)).toEqual({
      parent: null,
      workspaceOnly: true,
      ownership: 'master',
    })
  })

  it('creates parented audio as a scene-local overlay', () => {
    expect(resolveAudioImportTarget('scene-root')).toEqual({
      parent: 'scene-root',
      workspaceOnly: false,
      ownership: 'scene-overlay',
    })
  })
})

describe('media import timeline placement', () => {
  it('uses a finite non-negative Scene start time', () => {
    expect(resolveMediaImportStartTime(2.75)).toBe(2.75)
    expect(resolveMediaImportStartTime(-1)).toBe(0)
    expect(resolveMediaImportStartTime(Number.NaN)).toBe(0)
    expect(resolveMediaImportStartTime(undefined)).toBe(0)
  })
})

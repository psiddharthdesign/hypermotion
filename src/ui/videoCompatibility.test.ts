// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canDecodeVideoFile } from './videoCompatibility'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function setup() {
  const video = {
    readyState: 2, videoWidth: 3840, videoHeight: 2160, duration: 2,
    currentTime: 0, src: '', muted: false, playsInline: false, preload: '',
    onloadeddata: null as (() => void) | null,
    onseeked: null as (() => void) | null,
    onerror: null as (() => void) | null,
    pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(),
  }
  vi.stubGlobal('document', { createElement: () => video })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  return { video, revoke }
}

describe('original video decode probe', () => {
  it('accepts a decoded and seekable full-resolution source and releases it', async () => {
    const { video, revoke } = setup()
    const result = canDecodeVideoFile(new File([], '4k.mp4'))
    video.onloadeddata!()
    expect(video.currentTime).toBe(0.12)
    video.onseeked!()
    expect(await result).toBe(true)
    expect(revoke).toHaveBeenCalledWith('blob:test')
    expect(video.removeAttribute).toHaveBeenCalledWith('src')
    expect(video.onloadeddata).toBeNull()
  })

  it('rejects unsupported codecs without leaving a decoder alive', async () => {
    const { video, revoke } = setup()
    const result = canDecodeVideoFile(new File([], 'unsupported.mov'))
    video.onerror!()
    expect(await result).toBe(false)
    expect(revoke).toHaveBeenCalledOnce()
  })

  it('does not accept metadata alone or wait indefinitely for a frame', async () => {
    vi.useFakeTimers()
    const { video, revoke } = setup()
    video.readyState = 1
    const result = canDecodeVideoFile(new File([], 'stalled.mp4'))
    video.onloadeddata!()
    const rejection = expect(result).rejects.toThrow('took too long')
    await vi.advanceTimersByTimeAsync(30000)
    await rejection
    expect(revoke).toHaveBeenCalledOnce()
  })
})

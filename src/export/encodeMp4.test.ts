// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMp4Encoder } from './encodeMp4'

const FOUR_K = { width: 3840, height: 2160, fps: 60 }
type Probe = (config: VideoEncoderConfig) => Promise<VideoEncoderSupport>

function mockWebCodecs(probe: Probe = async config => ({ supported: true, config })) {
  const supported = vi.fn(probe)
  const configure = vi.fn<(config: VideoEncoderConfig) => void>()
  const encode = vi.fn<(frame: VideoFrame, options?: VideoEncoderEncodeOptions) => void>()
  const closedFrames: VideoFrameInit[] = []
  class MockVideoEncoder {
    static isConfigSupported = supported
    encodeQueueSize = 0
    configure = configure
    encode = encode
    flush = async () => undefined
    close = () => undefined
  }
  class MockVideoFrame {
    private init: VideoFrameInit
    constructor(_canvas: HTMLCanvasElement, init: VideoFrameInit) { this.init = init }
    close() { closedFrames.push(this.init) }
  }
  vi.stubGlobal('VideoEncoder', MockVideoEncoder)
  vi.stubGlobal('VideoFrame', MockVideoFrame)
  return { supported, configure, encode, closedFrames }
}

afterEach(() => vi.unstubAllGlobals())

describe('MP4 gradient preservation', () => {
  it('keeps the original bitrate path and encode options unless requested', async () => {
    const codecs = mockWebCodecs()
    const encoder = await createMp4Encoder(FOUR_K)
    expect(codecs.supported).toHaveBeenCalledOnce()
    expect(codecs.configure).toHaveBeenCalledWith({
      codec: 'avc1.640034',
      width: 3840,
      height: 2160,
      framerate: 60,
      bitrate: 49_766_400,
      hardwareAcceleration: 'prefer-hardware',
    })
    await encoder.addFrame({} as HTMLCanvasElement, 0)
    expect(codecs.encode.mock.calls[0][1]).toEqual({ keyFrame: true })
  })

  it('uses supported manual QP 12 while preserving frame timing and keyframes', async () => {
    const codecs = mockWebCodecs()
    const encoder = await createMp4Encoder({ ...FOUR_K, preserveGradients: true })
    expect(codecs.supported).toHaveBeenCalledOnce()
    expect(codecs.configure).toHaveBeenCalledWith({
      codec: 'avc1.640034',
      width: 3840,
      height: 2160,
      framerate: 60,
      bitrateMode: 'quantizer',
      latencyMode: 'realtime',
      hardwareAcceleration: 'prefer-hardware',
    })
    for (const frame of [0, 1, 60]) await encoder.addFrame({} as HTMLCanvasElement, frame)
    expect(codecs.encode.mock.calls.map(call => call[1])).toEqual([
      { keyFrame: true, avc: { quantizer: 12 } },
      { keyFrame: false, avc: { quantizer: 12 } },
      { keyFrame: true, avc: { quantizer: 12 } },
    ])
    expect(codecs.closedFrames).toEqual([
      { timestamp: 0, duration: 16_667 },
      { timestamp: 16_667, duration: 16_667 },
      { timestamp: 1_000_020, duration: 16_667 },
    ])
  })

  it('honors an explicit bitrate instead of enabling quantizer mode', async () => {
    const codecs = mockWebCodecs()
    const encoder = await createMp4Encoder({
      ...FOUR_K, preserveGradients: true, bitrate: 80_000_000,
    })
    expect(codecs.supported).toHaveBeenCalledOnce()
    expect(codecs.configure.mock.calls[0][0]).toMatchObject({ bitrate: 80_000_000 })
    expect(codecs.configure.mock.calls[0][0]).not.toHaveProperty('bitrateMode')
    await encoder.addFrame({} as HTMLCanvasElement, 1)
    expect(codecs.encode.mock.calls[0][1]).toEqual({ keyFrame: false })
  })

  it('tries the remaining acceleration preferences for manual quantization', async () => {
    const codecs = mockWebCodecs(async config => ({
      supported: config.hardwareAcceleration === 'prefer-software', config,
    }))
    await createMp4Encoder({ ...FOUR_K, preserveGradients: true })
    expect(codecs.supported.mock.calls.map(([config]) => config.hardwareAcceleration)).toEqual([
      'prefer-hardware', 'no-preference', 'prefer-software',
    ])
    expect(codecs.configure.mock.calls[0][0]).toMatchObject({
      bitrateMode: 'quantizer', hardwareAcceleration: 'prefer-software',
    })
  })

  it.each(['unsupported', 'throws', 'ignored'] as const)(
    'falls back to the original bitrate configuration when manual QP is %s',
    async rejection => {
      const codecs = mockWebCodecs(async config => {
        if (config.bitrateMode !== 'quantizer') return { supported: true, config }
        if (rejection === 'throws') throw new TypeError('Unknown bitrate mode')
        if (rejection === 'unsupported') return { supported: false, config }
        // Older WebCodecs implementations report support but omit unknown
        // members from the normalized result. They cannot accept per-frame QP.
        const recognized = { ...config }
        delete recognized.bitrateMode
        return { supported: true, config: recognized }
      })
      const encoder = await createMp4Encoder({ ...FOUR_K, preserveGradients: true })
      expect(codecs.supported).toHaveBeenCalledTimes(4)
      const selected = codecs.configure.mock.calls[0][0]
      expect(selected).toMatchObject({ bitrate: 49_766_400, hardwareAcceleration: 'prefer-hardware' })
      expect(selected).not.toHaveProperty('bitrateMode')
      expect(selected).not.toHaveProperty('latencyMode')
      await encoder.addFrame({} as HTMLCanvasElement, 0)
      expect(codecs.encode.mock.calls[0][1]).toEqual({ keyFrame: true })
    },
  )

  it('keeps the original unsupported-codec error after both paths are exhausted', async () => {
    const codecs = mockWebCodecs(async config => ({ supported: false, config }))
    await expect(createMp4Encoder({ ...FOUR_K, preserveGradients: true }))
      .rejects.toThrow("H.264 / MP4 can't encode 3840×2160")
    expect(codecs.supported).toHaveBeenCalledTimes(6)
    expect(codecs.configure).not.toHaveBeenCalled()
  })
})

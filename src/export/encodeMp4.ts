// SPDX-License-Identifier: Apache-2.0

import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

/**
 * MP4 encoder built on WebCodecs + mp4-muxer.
 *
 * WebCodecs gives us native H.264 encoding in Chrome/Edge/Arc — no
 * FFmpeg.wasm download, no worker boilerplate, no codec-blob ship.
 * mp4-muxer takes the encoded EncodedVideoChunks and writes them into
 * a real MP4 container with a `moov` box at the start (`fastStart:
 * 'in-memory'`) so the file plays in QuickTime / Finder preview / web
 * browsers without re-muxing.
 *
 * Bitrate scales with pixel count — 4K at 8 Mbps would look
 * compressed; we use `roughly 0.1 bits per pixel per frame` which
 * gives 4K ~50Mbps, 1080p ~12Mbps, 720P ~5.5Mbps. That's right in line
 * with what Jitter and After Effects export at on default settings.
 *
 * Codec string: avc1.42E01F = H.264 Baseline Profile, Level 3.1.
 * Wide compatibility (QuickTime, web video tags, social uploads); fine
 * for 1080p. For 4K bumps to 5.1 (avc1.640033) so the level matches
 * the resolution and players don't reject the file.
 */

export interface Mp4EncoderOptions {
  width: number
  height: number
  fps: number
  /** Bits per second — defaults to ~0.1 bpp × pixels × fps. */
  bitrate?: number
}

export interface Mp4Encoder {
  /**
   * Encode one frame. `index` is the 0-based frame number; we use it to
   * emit a keyframe every second so seeking the resulting MP4 doesn't
   * have to decode from frame 0.
   */
  addFrame(canvas: HTMLCanvasElement, index: number): Promise<void>
  /** Drain the encoder, finalize the MP4 box, return the file blob. */
  finish(): Promise<Blob>
}

export async function createMp4Encoder(opts: Mp4EncoderOptions): Promise<Mp4Encoder> {
  const { width, height, fps } = opts
  const pixels = width * height
  const bitrate = opts.bitrate ?? Math.max(2_000_000, Math.round(pixels * fps * 0.1))

  const codec = pickH264Codec(width, height, fps)

  // Probe the chosen codec. WebCodecs may reject for two reasons:
  //   1. The GPU's hardware H.264 encoder doesn't handle this combo —
  //      common at 4K+ on Intel iGPUs and some older Apple Silicon
  //      paths. Apple's VideoToolbox notably refuses non-16:9 4K (e.g.
  //      3840×2880, the 4:3 cousin) on Mx hardware encoder.
  //   2. The codec string genuinely isn't supported (browser too old).
  //
  // For (1), software encoding works — slower but always there.
  // Cycle through three accel preferences and use the first that
  // accepts. Only if EVERY preference rejects do we surface an error.
  const baseConfig = {
    codec,
    width,
    height,
    bitrate,
    framerate: fps,
  }
  const accelPrefs: Array<
    'prefer-hardware' | 'prefer-software' | 'no-preference'
  > = ['prefer-hardware', 'no-preference', 'prefer-software']
  let chosenAccel: (typeof accelPrefs)[number] | null = null
  for (const accel of accelPrefs) {
    const probed = await VideoEncoder.isConfigSupported({
      ...baseConfig,
      hardwareAcceleration: accel,
    })
    if (probed.supported) {
      chosenAccel = accel
      break
    }
  }
  if (!chosenAccel) {
    // Tailor the suggestion. H.264 has hard caps that vary by Level
    // (the trailing two hex digits of the codec string). On Chromium
    // for macOS the practical ceiling for MP4 is roughly 4K @ 16:9
    // (3840×2160) — Level 5.2. Non-standard aspect ratios at 4K
    // (e.g. 3840×2880 / 4:3) exceed coded-area limits even though
    // each dimension on its own is fine.
    const is16x9 = Math.abs(width / height - 16 / 9) < 0.01
    const suggestSize = is16x9
      ? 'a smaller resolution'
      : `a 16:9 canvas (e.g. 3840×2160 for 4K, 1920×1080 for HD), or 2K (${Math.round((width / Math.max(width, height)) * 2560)}×${Math.round((height / Math.max(width, height)) * 2560)} for your aspect)`
    throw new Error(
      `H.264 / MP4 can't encode ${width}×${height} on this system. H.264 caps out around ` +
        `4K at 16:9; your aspect ratio doesn't fit the codec's profile sizes. ` +
        `Two ways forward: switch the Export format to WebM (no resolution limits — VP9 ` +
        `encoder accepts arbitrary sizes), or pick ${suggestSize}.`,
    )
  }

  const target = new ArrayBufferTarget()
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width,
      height,
      frameRate: fps,
    },
    fastStart: 'in-memory',
  })

  let encoderError: Error | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e instanceof Error ? e : new Error(String(e))
    },
  })

  encoder.configure({
    ...baseConfig,
    hardwareAcceleration: chosenAccel,
  })

  const frameDurationUs = Math.round(1_000_000 / fps)

  return {
    async addFrame(canvas, index) {
      if (encoderError) throw encoderError
      // VideoFrame from a canvas — no extra readback required, the
      // browser keeps it on GPU when it can.
      const frame = new VideoFrame(canvas, {
        timestamp: index * frameDurationUs,
        duration: frameDurationUs,
      })
      // Force a keyframe every `fps` frames (≈ once per second) so
      // scrubbing the output MP4 doesn't have to decode from frame 0.
      const keyFrame = index % fps === 0
      encoder.encode(frame, { keyFrame })
      frame.close()
      // Don't let the encoder queue grow without bound — back-pressure
      // ourselves by waiting if the encoder is more than 2 seconds of
      // frames behind the producer.
      if (encoder.encodeQueueSize > fps * 2) {
        await new Promise<void>((resolve) => {
          const id = window.setInterval(() => {
            if (encoder.encodeQueueSize <= fps) {
              window.clearInterval(id)
              resolve()
            }
          }, 16)
        })
      }
    },
    async finish() {
      if (encoderError) throw encoderError
      await encoder.flush()
      encoder.close()
      muxer.finalize()
      if (encoderError) throw encoderError
      return new Blob([target.buffer], { type: 'video/mp4' })
    },
  }
}

/**
 * Browser support probe. WebCodecs is in Chrome / Edge / Arc since
 * 2022; not in Safari < 16.4 and not in Firefox at time of writing.
 */
export function isMp4ExportSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.VideoEncoder === 'function' &&
    typeof window.VideoFrame === 'function'
  )
}

/**
 * Pick the lowest H.264 level whose `MaxFS` (max coded picture size in
 * pixels) and `MaxMBPS` (max sample rate per second) both fit the
 * requested resolution + fps.
 *
 * Why this matters: WebCodecs `VideoEncoder.configure({ codec })`
 * inspects the level number embedded in the codec string and rejects
 * the configuration if the content exceeds it. The previous version
 * of this helper picked levels too low (Level 3.2 for 1080p, which
 * tops out at 1280×720), and `encoder.encode()` failed on the first
 * frame. The numbers below come from H.264 spec Annex A, Table A-1,
 * with coded area expressed in pixels (MaxFS × 256 macroblock pixels)
 * and pixel rate in pixels/second.
 *
 * High Profile (`avc1.6400xx`) is used throughout. All consumer
 * playback (QuickTime, browsers, ffmpeg, VLC) supports it. The third
 * byte (`00`) carries no constraint flags. The trailing two bytes are
 * the level_idc as hex.
 */
function pickH264Codec(width: number, height: number, fps: number): string {
  // H.264 encodes whole macroblocks (16×16). A 1080-tall frame is
  // actually 1088 in coded area, which is why a Level-3.2 cap of
  // 1310720 fails 1920×1080 (it pads to 1920×1088 = 2088960).
  const mbW = Math.ceil(width / 16)
  const mbH = Math.ceil(height / 16)
  const codedArea = mbW * mbH * 256
  const codedRate = codedArea * fps

  const levels: Array<{ hex: string; maxArea: number; maxRate: number }> = [
    { hex: '1F', maxArea: 921_600, maxRate: 27_648_000 }, // L3.1 — 720p30
    { hex: '20', maxArea: 1_310_720, maxRate: 55_296_000 }, // L3.2 — 720p60
    { hex: '28', maxArea: 2_097_152, maxRate: 62_914_560 }, // L4.0 — 1080p30
    { hex: '2A', maxArea: 2_228_224, maxRate: 133_693_440 }, // L4.2 — 1080p60
    { hex: '32', maxArea: 5_652_480, maxRate: 150_994_944 }, // L5.0 — 1440p30
    { hex: '33', maxArea: 9_437_184, maxRate: 251_658_240 }, // L5.1 — 4K30
    { hex: '34', maxArea: 9_437_184, maxRate: 530_841_600 }, // L5.2 — 4K60
    // Level 6.x covers everything larger than 4K — vertical UI scenes,
    // 8K boards, anything with an unusual aspect like 3840×2880. Width
    // cap is 8192 and height cap is 4320 across all 6.x sublevels;
    // they differ only in MaxBR and MaxMBPS. We pick the lowest 6.x
    // sublevel that fits the requested pixel rate so we don't ask the
    // encoder for more headroom than necessary (some GPUs only
    // implement up to 6.1).
    { hex: '3C', maxArea: 35_651_584, maxRate: 1_069_547_520 }, // L6.0 — 8K30
    { hex: '3D', maxArea: 35_651_584, maxRate: 2_139_095_040 }, // L6.1 — 8K60
    { hex: '3E', maxArea: 35_651_584, maxRate: 4_278_190_080 }, // L6.2 — 8K120
  ]
  for (const l of levels) {
    if (codedArea <= l.maxArea && codedRate <= l.maxRate) {
      return `avc1.6400${l.hex}`
    }
  }
  // Anything beyond Level 6.2 is past the H.264 spec entirely; fall
  // back to L6.2 and let the encoder reject with a clean error if the
  // GPU can't go that high.
  return 'avc1.64003E'
}
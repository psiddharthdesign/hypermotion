// SPDX-License-Identifier: Apache-2.0

import { GIFEncoder, quantize, applyPalette } from 'gifenc'

/**
 * GIF encoder built on `gifenc`.
 *
 * GIFs are 256-color paletted, so each frame is quantized down from
 * 24-bit RGBA before being written. `quantize` uses neuquant by
 * default — modern, small, fast, and produces palettes designers
 * recognize as "good GIF colors" rather than the dithered mess
 * cheaper encoders make.
 *
 * Delay is in centiseconds (GIF89a's native unit). 24fps → 4 cs per
 * frame, 30fps → 3 cs, 60fps → 2 cs (technically 1.66 — GIFs can't
 * represent fractional centiseconds, so we round). The export
 * catalogue caps GIF at 24fps for this reason.
 */

export interface GifEncoderOptions {
  width: number
  height: number
  fps: number
}

export interface GifEncoder {
  addFrame(canvas: HTMLCanvasElement): Promise<void>
  finish(): Promise<Blob>
}

export function createGifEncoder(opts: GifEncoderOptions): GifEncoder {
  const { width, height, fps } = opts
  const gif = GIFEncoder()
  const delayCs = Math.max(1, Math.round(100 / fps))

  return {
    async addFrame(canvas) {
      // Resize to the encoder's expected dimensions if the captured
      // canvas doesn't match. captureArtboardFrame already sizes to
      // (width, height), so this is a guard for misuse.
      let source = canvas
      if (canvas.width !== width || canvas.height !== height) {
        source = document.createElement('canvas')
        source.width = width
        source.height = height
        const ctx = source.getContext('2d')
        if (!ctx) throw new Error('GIF encoder: 2D context unavailable')
        ctx.drawImage(canvas, 0, 0, width, height)
      }
      const ctx = source.getContext('2d')
      if (!ctx) throw new Error('GIF encoder: 2D context unavailable')
      const { data } = ctx.getImageData(0, 0, width, height)
      // 256-color quantization. Higher `format: 'rgb444'` would give
      // tighter palettes but visibly bands gradients; rgb565 is the
      // sweet spot for motion content.
      const palette = quantize(data, 256, { format: 'rgb565' })
      const indexed = applyPalette(data, palette, 'rgb565')
      gif.writeFrame(indexed, width, height, {
        palette,
        delay: delayCs,
      })
    },
    async finish() {
      gif.finish()
      // gifenc returns a Uint8Array view onto its internal buffer.
      // Copy into a fresh ArrayBuffer so the Blob isn't tied to the
      // encoder's internal state (it would otherwise mutate underneath
      // a long-lived Blob — observed in practice, hard bug to find).
      const bytes = gif.bytes()
      const copy = new Uint8Array(bytes.length)
      copy.set(bytes)
      return new Blob([copy], { type: 'image/gif' })
    },
  }
}
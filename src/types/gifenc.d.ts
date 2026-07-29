// SPDX-License-Identifier: Apache-2.0

declare module 'gifenc' {
  type PixelData = Uint8Array | Uint8ClampedArray
  type PixelFormat = 'rgb565' | 'rgb444' | 'rgba4444'
  type PaletteColor = [number, number, number] | [number, number, number, number]
  type Palette = PaletteColor[]

  interface QuantizeOptions {
    format?: PixelFormat
    oneBitAlpha?: boolean | number
    clearAlpha?: boolean
    clearAlphaThreshold?: number
    clearAlphaColor?: number
  }

  interface Encoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: {
        palette?: Palette
        delay?: number
      },
    ): void
    finish(): void
    bytes(): Uint8Array<ArrayBuffer>
  }

  export function GIFEncoder(options?: {
    auto?: boolean
    initialCapacity?: number
  }): Encoder

  export function quantize(
    rgba: PixelData,
    maxColors: number,
    options?: QuantizeOptions,
  ): Palette

  export function applyPalette(
    rgba: PixelData,
    palette: Palette,
    format?: PixelFormat,
  ): Uint8Array<ArrayBuffer>
}

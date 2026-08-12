// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  detectNativeBitmapMetadata,
  detectNativeBitmapPixelFormat,
  expectedBitmapByteLength,
  pickBitmapMetadata,
} from './captureBitmap'

describe('detectNativeBitmapPixelFormat', () => {
  it('detects RGBA from an opaque red pixel', () => {
    expect(
      detectNativeBitmapPixelFormat(Uint8Array.from([255, 0, 0, 255])),
    ).toBe('rgba')
  })

  it('detects BGRA from an opaque red pixel', () => {
    expect(
      detectNativeBitmapPixelFormat(Uint8Array.from([0, 0, 255, 255])),
    ).toBe('bgra')
  })

  it('rejects malformed or ambiguous probe pixels', () => {
    expect(() =>
      detectNativeBitmapPixelFormat(Uint8Array.from([255, 0, 0])),
    ).toThrow(/expected 4/i)
    expect(() =>
      detectNativeBitmapPixelFormat(Uint8Array.from([64, 0, 64, 255])),
    ).toThrow(/could not classify/i)
  })
})

describe('detectNativeBitmapMetadata', () => {
  it('detects Display-P3 RGBA and BGRA red pixels with rounding tolerance', () => {
    expect(
      detectNativeBitmapMetadata(Uint8Array.from([233, 50, 35, 255])),
    ).toEqual({ pixelFormat: 'rgba', colorSpace: 'display-p3' })
    expect(
      detectNativeBitmapMetadata(Uint8Array.from([35, 50, 233, 255])),
    ).toEqual({ pixelFormat: 'bgra', colorSpace: 'display-p3' })
  })
})

describe('pickBitmapMetadata', () => {
  it('keeps the first calibrated profile for a capture session', () => {
    const displayP3 = { pixelFormat: 'bgra', colorSpace: 'display-p3' } as const
    const srgb = { pixelFormat: 'rgba', colorSpace: 'srgb' } as const
    expect(pickBitmapMetadata(undefined, displayP3)).toBe(displayP3)
    expect(pickBitmapMetadata(displayP3, srgb)).toBe(displayP3)
  })
})

describe('expectedBitmapByteLength', () => {
  it('returns four bytes per pixel', () => {
    expect(expectedBitmapByteLength(1920, 1080)).toBe(8_294_400)
  })

  it('rejects invalid dimensions', () => {
    expect(() => expectedBitmapByteLength(0, 1080)).toThrow(/invalid/i)
    expect(() => expectedBitmapByteLength(1.5, 1080)).toThrow(/invalid/i)
  })
})

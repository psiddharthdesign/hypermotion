// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { captureBitmapToRgba } from './captureBitmap'

describe('captureBitmapToRgba', () => {
  it('keeps RGBA channels unchanged', () => {
    const data = new Uint8Array([255, 16, 8, 128, 4, 3, 2, 1])
    expect(
      [
        ...captureBitmapToRgba({
          data,
          width: 2,
          height: 1,
          pixelFormat: 'rgba',
          colorSpace: 'srgb',
        }),
      ],
    ).toEqual([255, 16, 8, 128, 4, 3, 2, 1])
  })

  it('swaps BGRA red and blue channels in place', () => {
    const data = new Uint8Array([8, 16, 255, 128, 2, 3, 4, 1])
    const rgba = captureBitmapToRgba({
      data,
      width: 2,
      height: 1,
      pixelFormat: 'bgra',
      colorSpace: 'srgb',
    })
    expect([...rgba]).toEqual([255, 16, 8, 128, 4, 3, 2, 1])
    expect([...data]).toEqual([255, 16, 8, 128, 4, 3, 2, 1])
  })

  it('rejects dimensions that do not match the byte buffer', () => {
    expect(() =>
      captureBitmapToRgba({
        data: new Uint8Array(4),
        width: 2,
        height: 1,
        pixelFormat: 'rgba',
        colorSpace: 'srgb',
      }),
    ).toThrow('expected 8, received 4')
  })

  it('rejects invalid dimensions', () => {
    expect(() =>
      captureBitmapToRgba({
        data: new Uint8Array(0),
        width: 0,
        height: 1,
        pixelFormat: 'rgba',
        colorSpace: 'srgb',
      }),
    ).toThrow('Invalid capture bitmap width')
  })
})

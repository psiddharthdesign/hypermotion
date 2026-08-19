// SPDX-License-Identifier: Apache-2.0

export type CapturePixelFormat = 'rgba' | 'bgra'
export type CaptureColorSpace = 'srgb' | 'display-p3'

export interface CaptureBitmapPayload {
  data: Uint8Array
  width: number
  height: number
  pixelFormat: CapturePixelFormat
  colorSpace: CaptureColorSpace
}

/** Convert Electron's platform-native bitmap bytes to browser RGBA bytes. */
export function captureBitmapToRgba(
  payload: CaptureBitmapPayload,
): Uint8ClampedArray<ArrayBuffer> {
  const width = normalizedDimension(payload.width, 'width')
  const height = normalizedDimension(payload.height, 'height')
  const expected = width * height * 4
  if (payload.data.byteLength !== expected) {
    throw new Error(
      `Invalid capture bitmap length: expected ${expected}, received ${payload.data.byteLength}.`,
    )
  }

  // IPC gives this capture an owned byte buffer. Reuse it so BGRA conversion
  // does not allocate another full-size frame on the hot export path.
  const bytes: Uint8ClampedArray<ArrayBuffer> =
    payload.data.buffer instanceof ArrayBuffer
      ? new Uint8ClampedArray(
          payload.data.buffer,
          payload.data.byteOffset,
          payload.data.byteLength,
        )
      : Uint8ClampedArray.from(payload.data)

  if (payload.pixelFormat === 'bgra') {
    for (let offset = 0; offset < bytes.length; offset += 4) {
      const blue = bytes[offset]!
      bytes[offset] = bytes[offset + 2]!
      bytes[offset + 2] = blue
    }
  } else if (payload.pixelFormat !== 'rgba') {
    throw new Error(
      `Unsupported capture pixel format: ${String(payload.pixelFormat)}.`,
    )
  }

  return bytes
}

function normalizedDimension(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid capture bitmap ${label}: ${String(value)}.`)
  }
  return value
}

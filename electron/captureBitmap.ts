// SPDX-License-Identifier: Apache-2.0

export type NativeBitmapPixelFormat = 'rgba' | 'bgra'
export type NativeBitmapColorSpace = 'srgb' | 'display-p3'

export interface NativeBitmapMetadata {
  pixelFormat: NativeBitmapPixelFormat
  colorSpace: NativeBitmapColorSpace
}

export function pickBitmapMetadata(
  cached: NativeBitmapMetadata | undefined,
  calibrated: NativeBitmapMetadata,
): NativeBitmapMetadata {
  return cached ?? calibrated
}

const RED_PIXEL_CANDIDATES: readonly {
  bytes: readonly [number, number, number, number]
  metadata: NativeBitmapMetadata
}[] = [
  {
    bytes: [255, 0, 0, 255],
    metadata: { pixelFormat: 'rgba', colorSpace: 'srgb' },
  },
  {
    bytes: [0, 0, 255, 255],
    metadata: { pixelFormat: 'bgra', colorSpace: 'srgb' },
  },
  {
    // HTML's sRGB-red → Display-P3 conversion is approximately 234, 51, 35.
    bytes: [234, 51, 35, 255],
    metadata: { pixelFormat: 'rgba', colorSpace: 'display-p3' },
  },
  {
    bytes: [35, 51, 234, 255],
    metadata: { pixelFormat: 'bgra', colorSpace: 'display-p3' },
  },
]

/** Classify a CSS-red pixel captured from the actual render WebContents. */
export function detectNativeBitmapMetadata(
  knownRedPixel: Uint8Array,
): NativeBitmapMetadata {
  if (knownRedPixel.byteLength !== 4) {
    throw new Error(
      `Native bitmap probe returned ${knownRedPixel.byteLength} bytes; expected 4.`,
    )
  }

  let best:
    | { score: number; metadata: NativeBitmapMetadata }
    | undefined
  for (const candidate of RED_PIXEL_CANDIDATES) {
    const score = candidate.bytes.reduce(
      (total, expected, index) =>
        total + Math.abs(expected - knownRedPixel[index]!),
      0,
    )
    if (!best || score < best.score) {
      best = { score, metadata: candidate.metadata }
    }
  }

  // The capture is uncompressed and the probe is opaque. Allow a few values
  // of rounding variance, but reject antialiasing or an unexpected profile.
  if (!best || best.score > 12) {
    throw new Error(
      `Native bitmap probe could not classify red pixel (${[...knownRedPixel].join(', ')}).`,
    )
  }
  return best.metadata
}

/**
 * Detect Electron's platform-native four-channel bitmap order from a known
 * opaque red pixel. Electron documents `NativeImage.toBitmap()` as
 * platform-dependent, so callers must not assume BGRA (macOS/Windows) or RGBA.
 */
export function detectNativeBitmapPixelFormat(
  knownRedPixel: Uint8Array,
): NativeBitmapPixelFormat {
  return detectNativeBitmapMetadata(knownRedPixel).pixelFormat
}

export function expectedBitmapByteLength(width: number, height: number): number {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(`Invalid native bitmap dimensions ${width}×${height}.`)
  }

  const byteLength = width * height * 4
  if (!Number.isSafeInteger(byteLength)) {
    throw new Error(`Native bitmap dimensions ${width}×${height} are too large.`)
  }
  return byteLength
}

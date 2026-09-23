// SPDX-License-Identifier: Apache-2.0

/** Bound allocation density, not authored size or glow values. */
export function beamRasterScale(width: number, height: number, requested = 1): number {
  const w = Math.max(1, width), h = Math.max(1, height)
  return Math.min(requested, 4096 / w, 4096 / h, Math.sqrt(4_000_000 / w / h))
}

/** Equivalent to compositing `strength` copies, including fractional gains.
 * A lookup table keeps work independent of the strength, even at high values.
 * RGB stays intact, so intensity adds color coverage instead of bleaching it.
 */
export function amplifyBeamAlpha(pixels: Uint8ClampedArray, strength: number): void {
  const alpha = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) alpha[i] = 255 * (1 - Math.pow(1 - i / 255, strength))
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = alpha[pixels[i]]
}

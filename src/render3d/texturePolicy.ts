// SPDX-License-Identifier: Apache-2.0

import type { Rect } from '@/layout'

const MAX_TEXTURE_SCALE = 2
const MAX_TEXTURE_DIMENSION = 4096
const MAX_EDITOR_FRAMEBUFFER_DIMENSION = 4096
const MAX_EDITOR_FRAMEBUFFER_PIXELS = 12_000_000
const MAX_PLAYBACK_FRAMEBUFFER_PIXELS = 2_500_000
const VIEWPORT_PIXEL_RATIO_BUCKETS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const

export interface CachedPlaneTextureState {
  textureKind: 'canvas' | 'video'
  textureRevision: object | null
  textureSignature: string
}

/**
 * Match the editor framebuffer to the scene's on-screen footprint. A 4K
 * artboard viewed at 25% should not allocate an 8K Retina render target.
 * Quantized buckets keep wheel zoom smooth by avoiding a GPU reallocation on
 * every individual scroll event.
 */
export function viewportPixelRatioForZoom(
  zoom: number,
  devicePixelRatio =
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
  canvasWidth = 0,
  canvasHeight = 0,
): number {
  const safeZoom = Number.isFinite(zoom) ? Math.max(0.01, zoom) : 1
  const safeDpr = Number.isFinite(devicePixelRatio)
    ? Math.max(0.25, devicePixelRatio)
    : 1
  const target = Math.max(0.25, Math.min(2, safeZoom * safeDpr))
  const zoomBucket = VIEWPORT_PIXEL_RATIO_BUCKETS.reduce((closest, bucket) =>
    Math.abs(bucket - target) < Math.abs(closest - target) ? bucket : closest,
  )
  const safeWidth = Number.isFinite(canvasWidth) ? Math.max(0, canvasWidth) : 0
  const safeHeight = Number.isFinite(canvasHeight) ? Math.max(0, canvasHeight) : 0
  if (safeWidth <= 0 || safeHeight <= 0) return zoomBucket

  // A 3840×2160 artboard at 71% on a Retina display previously selected the
  // 1.5 bucket and ran every DOF tap over a 5760×3240 framebuffer. Keep editor
  // previews at a bounded 4K-class target; export still passes its explicit
  // output ratio and is unaffected by this policy.
  const framebufferCap = Math.min(
    MAX_EDITOR_FRAMEBUFFER_DIMENSION / safeWidth,
    MAX_EDITOR_FRAMEBUFFER_DIMENSION / safeHeight,
    Math.sqrt(MAX_EDITOR_FRAMEBUFFER_PIXELS / (safeWidth * safeHeight)),
  )
  const boundedTarget = Math.max(0.25, Math.min(zoomBucket, framebufferCap))
  return (
    [...VIEWPORT_PIXEL_RATIO_BUCKETS]
      .reverse()
      .find((bucket) => bucket <= boundedTarget) ?? 0.25
  )
}

/**
 * Bound the realtime drawing buffer independently of paused-preview quality.
 * A full-resolution 4K framebuffer multiplied by text blur/DOF taps can block
 * the compositor even when JavaScript is comfortably inside its frame budget.
 * Playback therefore uses the closest lower density bucket at or below a
 * ~2.5 MP target, then restores the authored zoom density as soon as it stops.
 * Export never calls this policy and remains full quality.
 */
export function playbackPixelRatio(
  previewPixelRatio: number,
  canvasWidth: number,
  canvasHeight: number,
): number {
  const safeRatio = Number.isFinite(previewPixelRatio)
    ? Math.max(0.25, Math.min(2, previewPixelRatio))
    : 1
  const safeWidth = Number.isFinite(canvasWidth) ? Math.max(1, canvasWidth) : 1
  const safeHeight = Number.isFinite(canvasHeight) ? Math.max(1, canvasHeight) : 1
  const pixelCapRatio = Math.sqrt(
    MAX_PLAYBACK_FRAMEBUFFER_PIXELS / (safeWidth * safeHeight),
  )
  const target = Math.max(0.25, Math.min(safeRatio, pixelCapRatio))
  return (
    [...VIEWPORT_PIXEL_RATIO_BUCKETS]
      .reverse()
      .find((bucket) => bucket <= target) ?? 0.25
  )
}

/**
 * Match the plane texture to the WebGL framebuffer's device-pixel density.
 * The old DPR×2 policy produced a ~4096×3369 bitmap for the 1104×908 Figma
 * frame even though the renderer itself runs at DPR. That cost four times
 * the pixels and then immediately downsampled them again.
 */
export function textureScaleForRect(
  rect: Pick<Rect, 'width' | 'height'>,
  devicePixelRatio =
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
): number {
  const desired = Math.min(
    MAX_TEXTURE_SCALE,
    Math.max(1, devicePixelRatio),
  )
  const maxSide = Math.max(1, Math.ceil(Math.max(rect.width, rect.height)))
  return Math.max(1, Math.min(desired, MAX_TEXTURE_DIMENSION / maxSide))
}

/** Workspace-only view changes reuse the existing bitmap. */
export function shouldRasterizePlaneTexture(
  isVideo: boolean,
  cached: CachedPlaneTextureState | undefined,
  textureRevision: object,
  textureSignature: string,
): boolean {
  if (isVideo) return false
  return (
    !cached ||
    cached.textureKind !== 'canvas' ||
    cached.textureRevision !== textureRevision ||
    cached.textureSignature !== textureSignature
  )
}

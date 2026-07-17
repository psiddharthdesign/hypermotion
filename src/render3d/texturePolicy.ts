// SPDX-License-Identifier: Apache-2.0

import type { Rect } from '@/layout'

const MAX_TEXTURE_SCALE = 2
const MAX_TEXTURE_DIMENSION = 4096

export interface CachedPlaneTextureState {
  textureKind: 'canvas' | 'video'
  textureRevision: object | null
  textureSignature: string
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

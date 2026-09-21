// SPDX-License-Identifier: Apache-2.0
import type { VideoNode } from '@/scene'

export function resolveVideoCrop(crop?: VideoNode['crop']) {
  const finite = (value: number | undefined, fallback: number) =>
    Number.isFinite(value) ? value! : fallback
  return {
    x: Math.max(0, Math.min(1, finite(crop?.x, 0.5))),
    y: Math.max(0, Math.min(1, finite(crop?.y, 0.5))),
    zoom: Math.max(1, Math.min(10, finite(crop?.zoom, 1))),
  }
}

/** Source UV range matching CSS object-fit/object-position, including letterboxing. */
export function videoFitUv(
  sourceWidth: number, sourceHeight: number,
  width: number, height: number,
  fit: VideoNode['fit'], crop?: VideoNode['crop'],
) {
  const { x, y, zoom } = resolveVideoCrop(crop)
  const iw = Math.max(1, sourceWidth || width)
  const ih = Math.max(1, sourceHeight || height)
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const scale = fit === 'cover' ? Math.max(w / iw, h / ih)
    : fit === 'contain' ? Math.min(w / iw, h / ih) : 1
  const repeatX = w / ((fit === 'fill' ? w : iw * scale) * zoom)
  const repeatY = h / ((fit === 'fill' ? h : ih * scale) * zoom)
  return { repeatX, repeatY, offsetX: (1 - repeatX) * x, offsetY: (1 - repeatY) * y }
}

export function videoResizeSize(width: number, height: number, nextW: number, nextH: number) {
  const scaleX = nextW / Math.max(1, width)
  const scaleY = nextH / Math.max(1, height)
  const scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY
  const safeScale = Math.max(1 / Math.max(1, width), 1 / Math.max(1, height), scale)
  return { width: width * safeScale, height: height * safeScale }
}

// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'

export const RENDER_FORMATS = ['mp4', 'webm', 'gif'] as const
export const RENDER_QUALITIES = ['comp', '720p', '2k', '4k'] as const

export type RenderFormat = (typeof RENDER_FORMATS)[number]
export type RenderQuality = (typeof RENDER_QUALITIES)[number]

export function isRenderFormat(value: unknown): value is RenderFormat {
  return typeof value === 'string' && RENDER_FORMATS.includes(value as RenderFormat)
}

export function isRenderQuality(value: unknown): value is RenderQuality {
  return typeof value === 'string' && RENDER_QUALITIES.includes(value as RenderQuality)
}

export function inferRenderFormatFromPath(filePath: string): RenderFormat {
  const cleanPath = filePath.split(/[?#]/, 1)[0] ?? filePath
  const ext = path.extname(cleanPath).toLowerCase().slice(1)
  return isRenderFormat(ext) ? ext : 'mp4'
}

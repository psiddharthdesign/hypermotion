// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'

export const RENDER_FORMATS = ['mp4', 'webm', 'gif'] as const
export const RENDER_QUALITIES = ['comp', '720p', '2k', '4k'] as const

export type RenderFormat = (typeof RENDER_FORMATS)[number]
export type RenderQuality = (typeof RENDER_QUALITIES)[number]

const RENDER_FORMAT_SET: ReadonlySet<RenderFormat> = new Set(RENDER_FORMATS)
const RENDER_QUALITY_SET: ReadonlySet<RenderQuality> = new Set(RENDER_QUALITIES)

export function isRenderFormat(value: unknown): value is RenderFormat {
  return typeof value === 'string' && RENDER_FORMAT_SET.has(value as RenderFormat)
}

export function isRenderQuality(value: unknown): value is RenderQuality {
  return typeof value === 'string' && RENDER_QUALITY_SET.has(value as RenderQuality)
}

export function inferRenderFormatFromPath(filePath: string): RenderFormat {
  const cleanPath = (filePath.split(/[?#]/, 1)[0] ?? filePath).trim()
  const normalizedPath = cleanPath.replace(/\\/g, '/')
  const basename = path.basename(normalizedPath)
  const ext = (
    path.extname(normalizedPath) || (basename.startsWith('.') ? basename : '')
  )
    .toLowerCase()
    .slice(1)
  return isRenderFormat(ext) ? ext : 'mp4'
}

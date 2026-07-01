// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'

export const RENDER_FORMATS = ['mp4', 'webm', 'gif'] as const
export const RENDER_QUALITIES = ['comp', '720p', '2k', '4k'] as const

export type RenderFormat = (typeof RENDER_FORMATS)[number]
export type RenderQuality = (typeof RENDER_QUALITIES)[number]

export function isRenderFormat(value: unknown): value is RenderFormat {
  return isStringMember(RENDER_FORMATS, value)
}

export function isRenderQuality(value: unknown): value is RenderQuality {
  return isStringMember(RENDER_QUALITIES, value)
}

export function inferRenderFormatFromPath(filePath: string): RenderFormat {
  const cleanPath = (filePath.split(/[?#]/, 1)[0] ?? filePath).trim()
  const ext = path.extname(cleanPath).toLowerCase().slice(1)
  return isRenderFormat(ext) ? ext : 'mp4'
}

function isStringMember<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === 'string' && values.includes(value)
}

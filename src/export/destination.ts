// SPDX-License-Identifier: Apache-2.0

import type { ExportFormatId } from './formats'

export interface ExportDestinationBridge {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}

export interface ExportWriteResult {
  ok: boolean
  path?: string
  error?: string
}

export interface ExportDestinationSelection {
  directory: string
  title: string
}

const KNOWN_EXPORT_EXTENSION = /\.(?:mp4|webm|gif)$/i
const INVALID_FILENAME_PUNCTUATION = /[<>:"/\\|?*]/g

function replaceFilenameControlCharacters(value: string): string {
  let result = ''
  for (const character of value) {
    result += character.charCodeAt(0) < 32 ? ' ' : character
  }
  return result
}

function cleanExportTitle(value: string): string {
  return replaceFilenameControlCharacters(value.trim())
    .replace(KNOWN_EXPORT_EXTENSION, '')
    .replace(INVALID_FILENAME_PUNCTUATION, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
}

/**
 * Keep the Title field extension-free so Format remains the single source of
 * truth. Invalid filesystem punctuation is removed before the title reaches
 * the render pipeline or the native writer.
 */
export function sanitizeExportTitle(
  value: string,
  fallback = 'export',
): string {
  const cleaned = cleanExportTitle(value)
  if (cleaned) return cleaned

  const safeFallback = cleanExportTitle(fallback)
  return safeFallback || 'export'
}

export function resolveExportFileName(
  title: string,
  format: ExportFormatId,
): string {
  return `${sanitizeExportTitle(title)}.${format}`
}

export async function getDefaultExportDirectory(
  bridge: ExportDestinationBridge,
): Promise<string> {
  const result = await bridge.invoke('export:get-default-directory')
  return typeof result === 'string' ? result : ''
}

export async function chooseExportDirectory(
  bridge: ExportDestinationBridge,
  currentDirectory: string,
  title: string,
  format: ExportFormatId,
): Promise<ExportDestinationSelection | null> {
  const result = await bridge.invoke('export:choose-directory', {
    defaultPath: currentDirectory || undefined,
    suggestedName: resolveExportFileName(title, format),
  })
  if (
    !result ||
    typeof result !== 'object' ||
    typeof (result as { directory?: unknown }).directory !== 'string' ||
    typeof (result as { fileName?: unknown }).fileName !== 'string'
  ) {
    return null
  }
  const selection = result as { directory: string; fileName: string }
  return {
    directory: selection.directory,
    title: sanitizeExportTitle(selection.fileName, title),
  }
}

export async function writeExportBlob(
  bridge: ExportDestinationBridge,
  directory: string,
  fileName: string,
  blob: Blob,
): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const result = (await bridge.invoke('export:write-file', {
    directory,
    fileName,
    bytes,
  })) as ExportWriteResult

  if (!result?.ok || !result.path) {
    throw new Error(result?.error || 'The exported file could not be saved.')
  }
  return result.path
}

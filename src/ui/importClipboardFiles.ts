// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import type { NodeId } from '@/scene'
import { importImageFiles, isImageFile } from '@/ui/importImage'
import { importMediaFiles, isMediaFile } from '@/ui/importMedia'
import { mergeImportOutcomes, type ImportOutcome } from '@/ui/importResult'

export interface ClipboardFilePayload {
  name: string
  type: string
  bytes: Uint8Array | ArrayBuffer | number[]
}

export async function importClipboardFiles(
  files: File[],
  api: SceneAPI,
  parent: NodeId | null,
  opts?: { dropPos?: { x: number; y: number }; workspaceOnly?: boolean },
): Promise<ImportOutcome> {
  const imageFiles = files.filter(isImageFile)
  const mediaFiles = files.filter((file) => !isImageFile(file) && isMediaFile(file))
  const empty: ImportOutcome = { ids: [], failures: [] }
  if (imageFiles.length === 0 && mediaFiles.length === 0) return empty

  return mergeImportOutcomes(
    imageFiles.length > 0
      ? await importImageFiles(imageFiles, api, parent, opts)
      : empty,
    mediaFiles.length > 0
      ? await importMediaFiles(mediaFiles, api, parent, opts)
      : empty,
  )
}

export function filesFromClipboardEvent(e: ClipboardEvent): File[] {
  const files = Array.from(e.clipboardData?.files ?? [])
  if (files.length > 0) return files

  return Array.from(e.clipboardData?.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
}

export async function readElectronClipboardFiles(): Promise<File[]> {
  const bridge = window.hypermotion?.clipboard
  if (!bridge?.readFiles) return []
  const payloads = await bridge.readFiles()
  return payloadsToFiles(payloads)
}

function payloadsToFiles(payloads: ClipboardFilePayload[]): File[] {
  return payloads.map((payload) => {
    const bytes =
      payload.bytes instanceof ArrayBuffer
        ? new Uint8Array(payload.bytes)
        : payload.bytes instanceof Uint8Array
          ? payload.bytes
          : new Uint8Array(payload.bytes)
    const copy = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    return new File([copy], payload.name, { type: payload.type || '' })
  })
}

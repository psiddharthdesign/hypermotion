// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import type { NodeId } from '@/scene'
import { importImageFiles, isImageFile } from '@/ui/importImage'
import { importMediaFiles, isMediaFile } from '@/ui/importMedia'

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
): Promise<NodeId[]> {
  const imageFiles = files.filter(isImageFile)
  const mediaFiles = files.filter((file) => !isImageFile(file) && isMediaFile(file))
  if (imageFiles.length === 0 && mediaFiles.length === 0) return []

  const ids: NodeId[] = []
  if (imageFiles.length > 0) {
    ids.push(...(await importImageFiles(imageFiles, api, parent, opts)))
  }
  if (mediaFiles.length > 0) {
    ids.push(...(await importMediaFiles(mediaFiles, api, parent, opts)))
  }
  return ids
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

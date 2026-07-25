// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import type { Transform } from '@/scene'

/**
 * Read a dropped/opened file as a base64 data URL via `FileReader`.
 *
 * Image and media import both stash the bytes directly on the node's `.src`
 * as a data URL for MVP, so the Yjs doc stays self-contained and "save to
 * disk → reopen" works with zero asset plumbing. Rejects on unreadable files.
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const r = reader.result
      if (typeof r === 'string') resolve(r)
      else reject(new Error('FileReader returned non-string'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

/**
 * Clamp a media asset's natural size to a sane initial size and center it on
 * the drop point (or the artboard center).
 *
 * A 4000×3000 phone photo or a 1080×1920 phone video would otherwise dwarf a
 * normal artboard; any dimension larger than 80% of the artboard's matching
 * side is scaled down proportionally. The user can still resize up via the
 * handles. Returns the initial `size` and a `transform` centered on `dropPos`
 * in canvas space when provided, otherwise on the artboard center.
 */
export function fitMediaIntoArtboard(
  api: SceneAPI,
  naturalWidth: number,
  naturalHeight: number,
  dropPos?: { x: number; y: number },
): { size: { width: number; height: number }; transform: Transform } {
  const meta = api.getMeta()
  const maxW = meta.canvas.width * 0.8
  const maxH = meta.canvas.height * 0.8
  let w = naturalWidth
  let h = naturalHeight
  const ratio = Math.min(maxW / w, maxH / h, 1)
  if (ratio < 1) {
    w = Math.round(w * ratio)
    h = Math.round(h * ratio)
  }

  const cx = dropPos?.x ?? meta.canvas.width / 2
  const cy = dropPos?.y ?? meta.canvas.height / 2
  return {
    size: { width: w, height: h },
    transform: {
      x: Math.round(cx - w / 2),
      y: Math.round(cy - h / 2),
      z: 0,
      rotation: 0,
      rotationX: 0,
      rotationY: 0,
      scaleX: 1,
      scaleY: 1,
    },
  }
}

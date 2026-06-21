// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import type { NodeId, Transform } from '@/scene'

/**
 * Import an image file into the scene as a new ImageNode.
 *
 * Flow:
 *   1. Read the file as a base64 data URL via FileReader. For MVP we
 *      stash the data URL directly in `ImageNode.src`, which means the
 *      Yjs doc carries the pixels — heavier saves, but the doc stays
 *      self-contained so "save to disk → reopen" Just Works with zero
 *      asset plumbing. The R2-backed content-addressed store lands when
 *      collab ships.
 *   2. Decode the data URL through a hidden `new Image()` so we know the
 *      natural pixel dimensions. Without this we'd have to guess, and
 *      guessing breaks "drag in a 400×200 hero at the scene's center".
 *   3. Clamp the initial size so a 4000×3000 phone photo doesn't become
 *      a layer eight times the artboard. We scale any dimension larger
 *      than 80% of the artboard's matching side proportionally down.
 *      The user can still resize up via the handles.
 *   4. Create the node as a child of `parent` (usually the scene root)
 *      with its transform centered on `dropPos` if provided, otherwise
 *      on the artboard center.
 *
 * Returns the new node's id so the caller can select it.
 *
 * Rejects on unreadable files (empty / corrupt / unsupported format).
 * The UI catches and logs; we don't surface a toast yet — a user-facing
 * error channel is on the list but not a blocker for import-any-PNG MVP.
 */
export async function importImageFile(
  file: File,
  api: SceneAPI,
  parent: NodeId | null,
  opts?: { dropPos?: { x: number; y: number }; workspaceOnly?: boolean },
): Promise<NodeId> {
  const dataUrl = await readFileAsDataUrl(file)
  const { width: natW, height: natH } = await decodeNaturalSize(dataUrl)

  // Clamp to a sane initial size. The artboard's width/height come from
  // scene meta; we only check against it when a proper number is
  // available (the root frame always has numeric sizes, so this is
  // effectively unconditional in practice).
  const meta = api.getMeta()
  const maxW = meta.canvas.width * 0.8
  const maxH = meta.canvas.height * 0.8
  let w = natW
  let h = natH
  const ratio = Math.min(maxW / w, maxH / h, 1)
  if (ratio < 1) {
    w = Math.round(w * ratio)
    h = Math.round(h * ratio)
  }

  // Center on dropPos (canvas-space), else on the artboard center.
  const cx = opts?.dropPos?.x ?? meta.canvas.width / 2
  const cy = opts?.dropPos?.y ?? meta.canvas.height / 2
  const transform: Transform = {
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
    z: 0,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    scaleX: 1,
    scaleY: 1,
  }

  const id = api.createNode('image', parent, {
    name: file.name.replace(/\.[^.]+$/, '') || 'Image',
    size: { width: w, height: h },
    transform,
    src: dataUrl,
    fit: 'cover',
    workspaceOnly: opts?.workspaceOnly ?? false,
  } as Parameters<SceneAPI['createNode']>[2])

  return id
}

/**
 * Drop-handler helper: accept a FileList and import every image in it
 * sequentially. Non-image files are silently skipped (safer than
 * rejecting the whole drop — users routinely drop a folder that
 * contains both images and an incidental .DS_Store).
 */
export async function importImageFiles(
  files: FileList | File[],
  api: SceneAPI,
  parent: NodeId | null,
  opts?: { dropPos?: { x: number; y: number }; workspaceOnly?: boolean },
): Promise<NodeId[]> {
  const ids: NodeId[] = []
  const list = Array.from(files).filter(isImageFile)
  for (const file of list) {
    try {
      const id = await importImageFile(file, api, parent, opts)
      ids.push(id)
    } catch (err) {
      // Swallow per-file errors so one bad file doesn't abort the batch.
      // Surface via console for now — replace with a toast when a real
      // toast system exists.
      console.warn('[importImageFiles] failed to import', file.name, err)
    }
  }
  return ids
}

export function isImageFile(file: File): boolean {
  // Prefer MIME type; fall back to extension because some drag sources
  // (especially from archives) strip the type. PNG/JPEG/WebP/GIF/SVG
  // covers everything the browser will natively decode in an <img>.
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(file.name)
}

function readFileAsDataUrl(file: File): Promise<string> {
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

function decodeNaturalSize(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      // naturalWidth/naturalHeight are 0 for SVGs without intrinsic
      // dimensions. Fall back to a 400×300 box so the user at least
      // sees something they can resize — better than a 0×0 ghost.
      const width = img.naturalWidth || 400
      const height = img.naturalHeight || 300
      resolve({ width, height })
    }
    img.onerror = () => reject(new Error('image decode failed'))
    img.src = dataUrl
  })
}

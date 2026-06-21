// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import type { NodeId, Transform } from '@/scene'

/**
 * Import an audio / video file into the scene.
 *
 * Why this lives alongside `importImage.ts` rather than inside it:
 * image import has to decode a still frame via `new Image()` to get
 * the intrinsic pixel size; media import uses `HTMLVideoElement` /
 * `HTMLAudioElement` + `loadedmetadata` to discover duration and (for
 * video) the natural display size. Different decode path, different
 * defaults, different Inspector surface — cleaner as its own module.
 *
 * MVP storage strategy: we stash the file as a base64 data URL on
 * `.src`. Heavy for big videos but keeps the Yjs doc self-contained
 * so "save → reopen" works with zero asset plumbing. Content-addressed
 * R2 storage lands with collab. Warn when files exceed a soft ceiling
 * so the user knows why their doc got slow.
 */

const DATA_URL_SOFT_CEILING_MB = 25

export async function importVideoFile(
  file: File,
  api: SceneAPI,
  parent: NodeId | null,
  opts?: { dropPos?: { x: number; y: number }; workspaceOnly?: boolean },
): Promise<NodeId> {
  const dataUrl = await readFileAsDataUrl(file)
  const { width: natW, height: natH, duration } = await decodeVideoMeta(dataUrl)

  // Clamp initial size the same way image import does — the phone-video
  // case (1080×1920) would otherwise dwarf a normal artboard.
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

  warnIfLarge(file)

  const id = api.createNode('video', parent, {
    name: file.name.replace(/\.[^.]+$/, '') || 'Video',
    size: { width: w, height: h },
    transform,
    src: dataUrl,
    fit: 'cover',
    duration,
    trimEnd: duration,
    muted: true,
    volume: 1,
    startTime: 0,
    trimStart: 0,
    loop: false,
    workspaceOnly: opts?.workspaceOnly ?? false,
  } as Parameters<SceneAPI['createNode']>[2])

  return id
}

export async function importAudioFile(
  file: File,
  api: SceneAPI,
  _parent: NodeId | null,
  _opts?: { dropPos?: { x: number; y: number }; workspaceOnly?: boolean },
): Promise<NodeId> {
  const dataUrl = await readFileAsDataUrl(file)
  const { duration } = await decodeAudioMeta(dataUrl)

  const transform: Transform = {
    // Audio is a sound-timeline asset, not an artboard object. Keep a
    // neutral transform for schema compatibility; the editor controls
    // timing through startTime / trim fields instead.
    x: 0,
    y: 0,
    z: 0,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    scaleX: 1,
    scaleY: 1,
  }

  warnIfLarge(file)

  const id = api.createNode('audio', null, {
    name: file.name.replace(/\.[^.]+$/, '') || 'Audio',
    size: { width: 1, height: 1 },
    transform,
    src: dataUrl,
    duration,
    trimEnd: duration,
    volume: 1,
    muted: false,
    startTime: 0,
    trimStart: 0,
    loop: false,
    workspaceOnly: true,
  } as Parameters<SceneAPI['createNode']>[2])

  return id
}

/**
 * Drop-handler helper: accept a FileList and import every audio/video
 * file. Non-media files are silently skipped (matches the image path
 * — users routinely drop folders with incidental files).
 */
export async function importMediaFiles(
  files: FileList | File[],
  api: SceneAPI,
  parent: NodeId | null,
  opts?: { dropPos?: { x: number; y: number }; workspaceOnly?: boolean },
): Promise<NodeId[]> {
  const ids: NodeId[] = []
  for (const file of Array.from(files)) {
    try {
      if (isVideoFile(file)) {
        ids.push(await importVideoFile(file, api, parent, opts))
      } else if (isAudioFile(file)) {
        ids.push(await importAudioFile(file, api, parent, opts))
      }
    } catch (err) {
      console.warn('[importMediaFiles] failed to import', file.name, err)
    }
  }
  return ids
}

export function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true
  return /\.(mp4|webm|mov|m4v|ogv|ogg)$/i.test(file.name)
}

export function isAudioFile(file: File): boolean {
  if (file.type.startsWith('audio/')) return true
  return /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus)$/i.test(file.name)
}

export function isMediaFile(file: File): boolean {
  return isVideoFile(file) || isAudioFile(file)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

/**
 * Decode enough of a video to discover `videoWidth / videoHeight /
 * duration`. We use `loadedmetadata` (metadata-only, fast) rather than
 * `loadeddata` (first frame, slower). `preload="metadata"` nudges the
 * browser down the cheaper path.
 *
 * Fallbacks: a stream that reports 0-width (some webm VP9 encodes, or
 * a container with no intrinsic dimensions) gets a 640×360 default so
 * the user has something they can resize. Duration reports Infinity
 * on some streaming containers — we clamp to a reasonable 0 in that
 * case so downstream playback code doesn't divide by Infinity.
 */
function decodeVideoMeta(
  dataUrl: string,
): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.onloadedmetadata = () => {
      const width = video.videoWidth || 640
      const height = video.videoHeight || 360
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      resolve({ width, height, duration })
    }
    video.onerror = () => reject(new Error('video decode failed'))
    video.src = dataUrl
  })
}

function decodeAudioMeta(dataUrl: string): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio')
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0
      resolve({ duration })
    }
    audio.onerror = () => reject(new Error('audio decode failed'))
    audio.src = dataUrl
  })
}

function warnIfLarge(file: File): void {
  const mb = file.size / (1024 * 1024)
  if (mb > DATA_URL_SOFT_CEILING_MB) {
    console.warn(
      `[importMedia] ${file.name} is ${mb.toFixed(1)}MB. ` +
        `The doc embeds media as base64 for MVP; expect slow saves. ` +
        `Switch to an external asset store after collab lands.`,
    )
  }
}

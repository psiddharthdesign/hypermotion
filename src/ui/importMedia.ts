// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import type { NodeId, Transform } from '@/scene'
import {
  toImportFailure,
  type ImportFailure,
  type ImportOutcome,
} from '@/ui/importResult'

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
export const VIDEO_PLAYBACK_PROXY_WARNING =
  'Video was converted to a Hyper Motion WebM playback proxy for browser-safe playback.'

export async function importVideoFile(
  file: File,
  api: SceneAPI,
  parent: NodeId | null,
  opts?: { dropPos?: { x: number; y: number }; workspaceOnly?: boolean },
): Promise<NodeId> {
  const normalized = await normalizeVideoFileForBrowser(file)
  const dataUrl = await readMediaFileAsDataUrl(normalized.file)
  const { width: natW, height: natH, duration } = await decodeVideoMeta(dataUrl)
  const poster = await captureVideoPoster(dataUrl, duration).catch(() => '')

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
    name: normalized.file.name.replace(/\.[^.]+$/, '') || 'Video',
    size: { width: w, height: h },
    position: 'absolute',
    transform,
    appearance: {
      opacity: 1,
      fill: null,
      stroke: null,
      cornerRadius: 0,
      effects: [],
    },
    src: dataUrl,
    poster,
    fit: 'cover',
    duration,
    trimEnd: duration,
    muted: true,
    volume: 1,
    playbackRate: 1,
    startTime: 0,
    trimStart: 0,
    loop: false,
    importWarning: normalized.normalized ? VIDEO_PLAYBACK_PROXY_WARNING : undefined,
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
  const dataUrl = await readMediaFileAsDataUrl(file)
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
    appearance: {
      opacity: 1,
      fill: null,
      stroke: null,
      cornerRadius: 0,
      effects: [],
    },
    src: dataUrl,
    duration,
    trimEnd: duration,
    volume: 1,
    playbackRate: 1,
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
 *
 * Decode failures are collected per file rather than aborting the
 * batch, and returned so the caller can surface them.
 */
export async function importMediaFiles(
  files: FileList | File[],
  api: SceneAPI,
  parent: NodeId | null,
  opts?: { dropPos?: { x: number; y: number }; workspaceOnly?: boolean },
): Promise<ImportOutcome> {
  const ids: NodeId[] = []
  const failures: ImportFailure[] = []
  for (const file of Array.from(files)) {
    try {
      if (isVideoFile(file)) {
        ids.push(await importVideoFile(file, api, parent, opts))
      } else if (isAudioFile(file)) {
        ids.push(await importAudioFile(file, api, parent, opts))
      }
    } catch (err) {
      console.warn('[importMediaFiles] failed to import', file.name, err)
      failures.push(toImportFailure(file.name, err))
    }
  }
  return { ids, failures }
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

export function readMediaFileAsDataUrl(file: File): Promise<string> {
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

export async function normalizeVideoFileForBrowser(
  file: File,
): Promise<{ file: File; normalized: boolean }> {
  const bridge = window.hypermotion?.media
  if (!bridge?.normalizeVideo) {
    console.warn('[importMedia] video normalization bridge unavailable')
    return { file, normalized: false }
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    console.info(
      `[importMedia] normalizing video ${file.name} (${file.size} bytes)`,
    )
    const result = await bridge.normalizeVideo({
      name: file.name,
      type: file.type,
      bytes,
    })
    if (!result.normalized) {
      console.warn('[importMedia] video normalization returned original file')
      return { file, normalized: false }
    }
    const normalizedBytes =
      result.bytes instanceof Uint8Array
        ? result.bytes
        : new Uint8Array(result.bytes)
    const copy = normalizedBytes.buffer.slice(
      normalizedBytes.byteOffset,
      normalizedBytes.byteOffset + normalizedBytes.byteLength,
    ) as ArrayBuffer
    const normalizedFile = new File([copy], result.name, {
      type: result.type || 'video/mp4',
    })
    console.info(
      `[importMedia] normalized video ready ${normalizedFile.name} (${normalizedFile.size} bytes)`,
    )
    return { file: normalizedFile, normalized: true }
  } catch (err) {
    console.warn('[importMedia] video normalization failed', err)
    return { file, normalized: false }
  }
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
export function decodeVideoMeta(
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

export function decodeAudioMeta(dataUrl: string): Promise<{ duration: number }> {
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

export function captureVideoPoster(
  dataUrl: string,
  duration: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    const cleanup = () => {
      video.onloadedmetadata = null
      video.onseeked = null
      video.onerror = null
    }
    video.onloadedmetadata = () => {
      try {
        video.currentTime = previewTimeForDuration(duration)
      } catch {
        // A few containers reject early seeks until data arrives; the
        // canvas renderer still has a live video element as fallback.
      }
    }
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth || 640
        canvas.height = video.videoHeight || 360
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('2d context unavailable')
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        cleanup()
        resolve(canvas.toDataURL('image/jpeg', 0.86))
      } catch (err) {
        cleanup()
        reject(err)
      }
    }
    video.onerror = () => {
      cleanup()
      reject(new Error('video poster decode failed'))
    }
    video.src = dataUrl
  })
}

function previewTimeForDuration(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0.12) return 0
  return Math.min(0.12, duration / 2)
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

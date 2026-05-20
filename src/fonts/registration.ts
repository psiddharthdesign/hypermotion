// SPDX-License-Identifier: Apache-2.0

import type { CustomFont } from '@/scene/types'

/**
 * FontFace registration — register / unregister a CustomFont with the
 * browser's document.fonts FontFaceSet so it becomes available to
 * `measureText`, CSS `font-family`, and the rest of the rendering
 * pipeline.
 *
 * Identity is `(family, weight, style)`. The browser's FontFaceSet
 * deduplicates on that tuple, so re-registering an identical (family,
 * weight, style) replaces the old entry — useful when the user
 * re-uploads a fixed file.
 *
 * Why FontFace and not @font-face: we have the bytes in memory, not at
 * a URL. The FontFace constructor accepts ArrayBuffer / BufferSource
 * directly, skipping any blob-URL dance. Bytes are owned by JS, freed
 * when the FontFace is removed and the closure releases the buffer.
 */

const registered = new Map<string, FontFace>()

/** Map an internal font id to the FontFace handle, for unregistration. */
function keyFor(font: CustomFont): string {
  return font.id
}

/**
 * Register a CustomFont's bytes with document.fonts. Returns true on
 * success, false on parse error (corrupt file, unsupported format).
 *
 * Awaits the FontFace `load()` so callers can synchronously trust that
 * measureText against this family will return correct metrics after
 * resolution. Without the await, the face is "loading" and metrics
 * fall back until the parse finishes.
 */
export async function registerFont(font: CustomFont): Promise<boolean> {
  if (typeof document === 'undefined' || !('fonts' in document)) return false

  // Replace any prior registration for this id — common when the user
  // re-uploads a fix.
  await unregisterFont(font)

  try {
    // FontFace accepts ArrayBuffer or BufferSource; pass the bytes
    // directly. Browser parses the woff2/woff/ttf/otf and registers
    // glyph metrics in its internal table.
    //
    // We copy into a fresh Uint8Array so the buffer typing is a plain
    // ArrayBuffer (not ArrayBuffer | SharedArrayBuffer, which is what
    // .buffer.slice produces under SharedArrayBuffer-aware lib
    // settings). The FontFace constructor signature insists on the
    // narrower type.
    const copy = new Uint8Array(font.bytes.byteLength)
    copy.set(font.bytes)
    const face = new FontFace(font.family, copy.buffer, {
      weight: String(font.weight),
      style: font.style,
      display: 'block', // measureText needs the real face, not a fallback
    })
    await face.load()
    document.fonts.add(face)
    registered.set(keyFor(font), face)
    return true
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[fonts] failed to register "${font.family}" (${font.weight} ${font.style}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return false
  }
}

/**
 * Remove a CustomFont from document.fonts. No-op if not registered.
 * Async to match registerFont's signature; the actual remove is
 * synchronous but waiting for it is harmless.
 */
export async function unregisterFont(font: CustomFont): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  const key = keyFor(font)
  const face = registered.get(key)
  if (!face) return
  try {
    document.fonts.delete(face)
  } catch {
    /* ignore — already removed */
  }
  registered.delete(key)
}

export function isFontRegistered(font: CustomFont): boolean {
  return registered.has(keyFor(font))
}

/**
 * Future use: if we ever need to surface a `font-family: url(...)` to
 * a stylesheet or external embed (Lottie export?), produce a blob URL
 * from the bytes. Not used by registerFont — FontFace takes bytes
 * directly. Caller is responsible for `URL.revokeObjectURL`.
 */
export function buildFontFaceUrl(font: CustomFont): string {
  const blob = new Blob([font.bytes as BlobPart], {
    type: mimeFor(font.format),
  })
  return URL.createObjectURL(blob)
}

function mimeFor(format: CustomFont['format']): string {
  switch (format) {
    case 'woff2':
      return 'font/woff2'
    case 'woff':
      return 'font/woff'
    case 'truetype':
      return 'font/ttf'
    case 'opentype':
      return 'font/otf'
  }
}

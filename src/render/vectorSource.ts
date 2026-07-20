// SPDX-License-Identifier: Apache-2.0

import type { VectorNode } from '@/scene'
import { sanitizeSvgSource } from '@/scene/vector'
import type { VectorTrimState } from './vectorPaint'

interface CachedSource {
  svg: string
  dataUrl: string
}

const preservedSourceCache = new Map<string, CachedSource | null>()
const MAX_PRESERVED_SOURCE_CACHE_ENTRIES = 96

function cachePreservedSource(key: string, value: CachedSource | null): void {
  // Imported SVG source can be several megabytes. Keep the render-boundary
  // sanitizer cache deliberately small so opening many documents cannot retain
  // every historical source string for the lifetime of the editor process.
  if (!preservedSourceCache.has(key) && preservedSourceCache.size >= MAX_PRESERVED_SOURCE_CACHE_ENTRIES) {
    const oldest = preservedSourceCache.keys().next().value
    if (typeof oldest === 'string') preservedSourceCache.delete(oldest)
  }
  preservedSourceCache.set(key, value)
}

/**
 * Complex imported vectors keep a sanitized source image alongside their
 * editable approximation. Use that source only while the full, untrimmed
 * artwork is requested. Trim Paths and direct editing intentionally use the
 * canonical point graph so the result remains deterministic and animatable.
 */
export function shouldRenderPreservedVectorSource(
  node: VectorNode,
  trim: VectorTrimState,
): boolean {
  return (
    node.importFidelity === 'preserved' &&
    typeof node.source?.originalSvg === 'string' &&
    node.source.originalSvg.trim().length > 0 &&
    Math.abs(trim.end - trim.start) >= 0.999999
  )
}

/**
 * Re-sanitize at the render boundary. Saved `.hype` files and CLI-authored
 * scenes are untrusted inputs, so importer-time sanitization alone is not a
 * sufficient security boundary.
 */
export function getPreservedVectorSource(
  node: VectorNode,
  trim: VectorTrimState,
): CachedSource | null {
  if (!shouldRenderPreservedVectorSource(node, trim)) return null
  const original = node.source!.originalSvg!
  const cacheKey = `${node.id}\u0000${original}`
  if (preservedSourceCache.has(cacheKey)) {
    return preservedSourceCache.get(cacheKey) ?? null
  }
  try {
    const svg = sanitizeSvgSource(original, {
      idNamespace: `hm-source-${node.id}`,
    }).svg
    const result = {
      svg,
      // An SVG loaded through <img> is an inert image document: scripts and
      // event handlers cannot run. Percent encoding also avoids base64's
      // Unicode edge cases while remaining fully self-contained.
      dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    }
    cachePreservedSource(cacheKey, result)
    return result
  } catch {
    cachePreservedSource(cacheKey, null)
    return null
  }
}

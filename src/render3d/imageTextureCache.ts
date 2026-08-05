// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene'

export const IMAGE_TEXTURE_LOADED_EVENT =
  'hypermotion:render3d-image-loaded'

const imageCache = new Map<string, HTMLImageElement>()
const decodedImageSources = new Set<string>()

/**
 * Return the shared bitmap used by the WebGL plane painter.
 *
 * Keeping one image per source avoids decoding the same embedded screenshot
 * for every plane repaint. The load event invalidates ThreeSceneViewport's
 * texture revision so a placeholder is replaced as soon as the bitmap is
 * ready.
 */
export function getCachedTextureImage(src: string): HTMLImageElement {
  const cached = imageCache.get(src)
  if (cached) return cached

  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.decoding = 'async'
  image.onload = () => dispatchTextureLoadedEvent()
  image.onerror = () => dispatchTextureLoadedEvent()

  // Cache before assigning src. Data URLs can settle quickly enough that a
  // second caller in the same turn would otherwise create a duplicate image.
  imageCache.set(src, image)
  image.src = src
  return image
}

/** Collect bitmap sources that the 3D canvas paints directly. */
export function collectRender3dImageSources(
  api: Pick<SceneAPI, 'getAllNodeIds' | 'getNode'>,
  rootNodeIds?: readonly string[],
): string[] {
  const sources = new Set<string>()
  const pending = [...(rootNodeIds ?? api.getAllNodeIds())]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const id = pending.shift()
    if (!id || visited.has(id)) continue
    visited.add(id)
    const node = api.getNode(id)
    if (!node) continue
    if (node.kind === 'image' && node.src.trim()) sources.add(node.src)
    const fill = node.appearance.fill
    if (fill?.kind === 'image' && fill.src.trim()) sources.add(fill.src)
    if (
      node.kind === 'camera' &&
      node.background?.kind === 'image' &&
      node.background.src.trim()
    ) {
      sources.add(node.background.src)
    }
    pending.push(...node.children)
  }
  return [...sources]
}

/**
 * Start loading every source and resolve only after each bitmap is decoded.
 *
 * Export uses this before its first captured frame. A failed or timed-out
 * source is surfaced as an export error instead of silently baking the
 * neutral image placeholder into the finished video.
 */
export async function preloadRender3dImageSources(
  sources: readonly string[],
  timeoutMs = 15_000,
): Promise<void> {
  const uniqueSources = [...new Set(sources.filter((src) => src.trim()))]
  if (uniqueSources.length === 0) return

  let timeout: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(
        new Error(
          `Timed out while decoding ${uniqueSources.length} image source${
            uniqueSources.length === 1 ? '' : 's'
          } for export.`,
        ),
      )
    }, Math.max(1, timeoutMs))
  })

  try {
    await Promise.race([
      Promise.all(
        uniqueSources.map((src) =>
          waitForTextureImage(getCachedTextureImage(src), src),
        ),
      ),
      timeoutPromise,
    ])
    // A source may have loaded before ThreeSceneViewport's passive effect
    // subscribed to the cache event. Always invalidate once more after the
    // complete preload barrier so the next paint cannot retain a placeholder.
    dispatchTextureLoadedEvent()
  } finally {
    if (timeout !== null) clearTimeout(timeout)
  }
}

/** Wait for any images discovered lazily during the latest scene paint. */
export function waitForCachedRender3dImages(
  timeoutMs = 5_000,
): Promise<void> {
  return preloadRender3dImageSources([...imageCache.keys()], timeoutMs)
}

function waitForTextureImage(
  image: HTMLImageElement,
  src: string,
): Promise<void> {
  if (decodedImageSources.has(src)) return Promise.resolve()
  if (image.complete) return finishAndRememberImageDecode(image, src)

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      image.removeEventListener('load', onLoad)
      image.removeEventListener('error', onError)
    }
    const onLoad = () => {
      cleanup()
      void finishAndRememberImageDecode(image, src).then(resolve, reject)
    }
    const onError = () => {
      cleanup()
      reject(new Error(`Unable to load image source ${describeSource(src)}.`))
    }
    image.addEventListener('load', onLoad)
    image.addEventListener('error', onError)

    // The image may have settled between the initial complete check and the
    // listener registration. Re-check in the same task to close that race.
    if (image.complete) {
      cleanup()
      void finishAndRememberImageDecode(image, src).then(resolve, reject)
    }
  })
}

async function finishAndRememberImageDecode(
  image: HTMLImageElement,
  src: string,
): Promise<void> {
  await finishImageDecode(image, src)
  decodedImageSources.add(src)
}

async function finishImageDecode(
  image: HTMLImageElement,
  src: string,
): Promise<void> {
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new Error(`Unable to decode image source ${describeSource(src)}.`)
  }
  if (typeof image.decode !== 'function') return
  try {
    await image.decode()
  } catch {
    // Chromium can reject decode() for an already-decoded image. Natural
    // dimensions are the reliable final readiness signal in that case.
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      throw new Error(`Unable to decode image source ${describeSource(src)}.`)
    }
  }
}

function describeSource(src: string): string {
  if (src.startsWith('data:')) {
    const delimiter = src.indexOf(';')
    return delimiter > 5 ? `${src.slice(0, delimiter)} data URL` : 'data URL'
  }
  return JSON.stringify(src.length > 160 ? `${src.slice(0, 157)}...` : src)
}

function dispatchTextureLoadedEvent(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(IMAGE_TEXTURE_LOADED_EVENT))
}

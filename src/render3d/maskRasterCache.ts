// SPDX-License-Identifier: Apache-2.0
import type { AnimatedValue } from '@/anim'
import type { Rect } from '@/layout'
import type { Node } from '@/scene'

/** Local mask pixels are independent of positioning and composited opacity. */
export function maskRasterKey(node: Node, rect: Rect, anim?: AnimatedValue, time = 0): string {
  const paintAnimation = { ...anim }
  for (const property of ['x', 'y', 'z', 'rotation', 'rotationX', 'rotationY', 'scaleX', 'scaleY', 'anchorX', 'anchorY', 'anchorZ', 'opacity'] as const) delete paintAnimation[property]
  return JSON.stringify([
    { ...node, transform: undefined, appearance: { ...node.appearance, opacity: undefined } },
    rect.width, rect.height, paintAnimation, time,
  ])
}

/**
 * SceneAPI returns new node objects on reads. Compare painted values instead
 * of object identity, so grouped/DOM masks reuse their blur during a drag.
 * Limit retained RGBA pixels (~64 MB) and keep only the latest paint per mask.
 */
export function createMaskRasterCache<T>(pixelBudget = 16_777_216) {
  const entries = new Map<string, { key: string; value: T; pixels: number }>()
  let pixels = 0
  return {
    get(id: string, key: string): T | undefined {
      const entry = entries.get(id)
      if (!entry || entry.key !== key) return undefined
      entries.delete(id)
      entries.set(id, entry)
      return entry.value
    },
    set(id: string, key: string, value: T, size: number) {
      pixels -= entries.get(id)?.pixels ?? 0
      entries.delete(id)
      entries.set(id, { key, value, pixels: size })
      pixels += size
      // Retain one oversized mask to avoid rebuilding it every frame.
      while (entries.size > 1 && (pixels > pixelBudget || entries.size > 16)) {
        const oldest = entries.keys().next().value!
        pixels -= entries.get(oldest)!.pixels
        entries.delete(oldest)
      }
    },
    clear() { entries.clear(); pixels = 0 },
  }
}

// SPDX-License-Identifier: Apache-2.0

import { useEffect } from 'react'
import { useSceneAPI, useSceneVersion } from '@/scene'
import { registerFont, unregisterFont, isFontRegistered } from '@/fonts'
import { notifyFontLoaded } from '@/ui/fonts/googleFonts'

/**
 * React hook that keeps the browser's FontFaceSet in sync with the
 * scene's `customFonts` map. Mount ONCE at the App shell root.
 *
 * What it does on every scene mutation:
 *
 *   1. Snapshots the current `customFonts` set.
 *   2. Registers any fonts that are in the scene but not yet in the
 *      FontFaceSet.
 *   3. (TODO when needed) unregisters fonts that have been removed
 *      from the scene. Not done in MVP — leaving a stale FontFace
 *      registered is harmless (no node uses it) and avoids a churn
 *      cycle on every undo / redo.
 *   4. After each register, calls `notifyFontLoaded()` so useLayout
 *      re-solves with the new font's true metrics.
 *
 * Library fonts (IndexedDB) are deliberately NOT registered here —
 * they only show in the Inspector picker. The user selecting a
 * library font copies it into the scene (which then fires this
 * hook), and only then does the font become live for measurement.
 * Keeps library size unbounded without polluting document.fonts.
 */
export function useCustomFonts(): void {
  const api = useSceneAPI()
  const version = useSceneVersion()

  useEffect(() => {
    let cancelled = false
    const fonts = api.getAllCustomFonts()

    void (async () => {
      for (const font of fonts) {
        if (cancelled) return
        if (isFontRegistered(font)) continue
        const ok = await registerFont(font)
        if (cancelled) return
        if (ok) {
          // Notify layout to re-solve with the new font's real metrics.
          // Without this, text nodes using this family would stay sized
          // for fallback widths until something else triggered a solve.
          notifyFontLoaded()
        }
      }
    })()

    return () => {
      cancelled = true
    }
    // Re-run on every scene mutation. `api` is stable across renders;
    // `version` bumps when any scene field changes (cheap because
    // registerFont skips already-registered fonts via isFontRegistered).
  }, [api, version])
}

/**
 * Force-unregister a font. Useful when the user removes a font from
 * the scene AND wants the FontFace dropped from the browser too —
 * primarily a debug aid. The default useCustomFonts behavior leaves
 * stale faces registered.
 */
export async function unregisterCustomFont(
  font: Parameters<typeof unregisterFont>[0],
): Promise<void> {
  await unregisterFont(font)
  notifyFontLoaded()
}

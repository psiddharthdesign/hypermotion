// SPDX-License-Identifier: Apache-2.0

/**
 * Google Fonts loader.
 *
 * The text tool needs a deeper typography bench than the system-font
 * stacks we shipped with. We pull in a curated slice of Google Fonts —
 * enough to cover "display / sans / serif / mono / script" categories
 * without drowning the dropdown in 1,500 families.
 *
 * How loading works:
 *
 *  1. When the user picks a Google font in the Inspector, we call
 *     `loadGoogleFont(family)`. It appends a single `<link>` tag per
 *     family to `<head>`, which pulls in `@font-face` rules for the
 *     weights we care about. Subsequent calls for the same family are
 *     no-ops (we dedupe by a data attribute on the link).
 *
 *  2. `document.fonts.load(cssFontString)` resolves once the font file
 *     is actually downloaded and registered. We await that and then
 *     notify listeners so the layout engine can re-solve (otherwise
 *     the Yoga measure function would return widths based on whatever
 *     fallback was rendered while the network request was in flight).
 *
 *  3. `subscribeFontLoaded(fn)` lets `useLayout` bump its version when
 *     a font finishes loading. This is the cheapest way to force a
 *     re-measure without running a synthetic scene mutation through
 *     Yjs (which would create an undo-history entry for nothing).
 *
 * Why a link tag and not FontFace() directly: Google's CSS endpoint
 * handles the woff2 / woff / local-source fallback chain, user-agent
 * sniffing, and character subset selection for us. Doing it ourselves
 * reinvents all that for no gain.
 */

import { useEffect, useState } from 'react'
import { useSceneAPI, useSceneVersion, type Node, type NodeId } from '@/scene'

export interface GoogleFontSpec {
  /** Family string stored on the node. Plain family name, no fallbacks. */
  value: string
  /** Human label shown in the dropdown. */
  label: string
  /** Category grouping for the picker. */
  category: 'sans' | 'serif' | 'mono' | 'display' | 'handwriting'
}

/**
 * Curated list. Chosen for coverage across the common motion-design
 * use cases: clean UI sans (Inter, Manrope), friendly sans (Poppins,
 * Nunito), brand display (Space Grotesk, DM Sans), editorial serif
 * (Playfair Display, Lora), utilitarian serif (Roboto Slab, Merriweather),
 * mono (JetBrains Mono, Space Mono), and a couple of scripts for hero
 * shots. Expand by adding entries; no other file needs to change.
 */
export const GOOGLE_FONTS: GoogleFontSpec[] = [
  // Sans
  { value: 'Inter', label: 'Inter', category: 'sans' },
  { value: 'Roboto', label: 'Roboto', category: 'sans' },
  { value: 'Manrope', label: 'Manrope', category: 'sans' },
  { value: 'Poppins', label: 'Poppins', category: 'sans' },
  { value: 'Nunito', label: 'Nunito', category: 'sans' },
  { value: 'Work Sans', label: 'Work Sans', category: 'sans' },
  { value: 'DM Sans', label: 'DM Sans', category: 'sans' },
  { value: 'Outfit', label: 'Outfit', category: 'sans' },
  { value: 'Plus Jakarta Sans', label: 'Plus Jakarta Sans', category: 'sans' },
  { value: 'Space Grotesk', label: 'Space Grotesk', category: 'sans' },
  { value: 'Montserrat', label: 'Montserrat', category: 'sans' },
  { value: 'Open Sans', label: 'Open Sans', category: 'sans' },
  { value: 'Lato', label: 'Lato', category: 'sans' },
  { value: 'Figtree', label: 'Figtree', category: 'sans' },
  { value: 'Geist', label: 'Geist', category: 'sans' },
  // Display
  { value: 'Bricolage Grotesque', label: 'Bricolage Grotesque', category: 'display' },
  { value: 'Unbounded', label: 'Unbounded', category: 'display' },
  { value: 'Archivo', label: 'Archivo', category: 'display' },
  { value: 'Syne', label: 'Syne', category: 'display' },
  // Serif
  { value: 'Playfair Display', label: 'Playfair Display', category: 'serif' },
  { value: 'Lora', label: 'Lora', category: 'serif' },
  { value: 'Merriweather', label: 'Merriweather', category: 'serif' },
  { value: 'Roboto Slab', label: 'Roboto Slab', category: 'serif' },
  { value: 'Fraunces', label: 'Fraunces', category: 'serif' },
  { value: 'DM Serif Display', label: 'DM Serif Display', category: 'serif' },
  { value: 'EB Garamond', label: 'EB Garamond', category: 'serif' },
  { value: 'Instrument Serif', label: 'Instrument Serif', category: 'serif' },
  // Mono
  { value: 'JetBrains Mono', label: 'JetBrains Mono', category: 'mono' },
  { value: 'Space Mono', label: 'Space Mono', category: 'mono' },
  { value: 'IBM Plex Mono', label: 'IBM Plex Mono', category: 'mono' },
  { value: 'Geist Mono', label: 'Geist Mono', category: 'mono' },
  // Handwriting
  { value: 'Caveat', label: 'Caveat', category: 'handwriting' },
  { value: 'Pacifico', label: 'Pacifico', category: 'handwriting' },
]

/**
 * Quick lookup: is this family a Google font we know about? Used by
 * Inspector to decide which dropdown the current value belongs to
 * (system stacks vs Google fonts).
 */
const GOOGLE_FAMILY_SET = new Set(GOOGLE_FONTS.map((f) => f.value))
export function isGoogleFont(family: string): boolean {
  // The family might be stored as a CSS stack "Inter, sans-serif" — in
  // that case take the first token. Strip wrapping quotes either way.
  const first = family.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') ?? ''
  return GOOGLE_FAMILY_SET.has(first)
}

/**
 * The weights we request per family. Matches FONT_WEIGHTS in Inspector:
 * 100–900 in 100-step increments. Not every family ships every weight,
 * but Google's API returns whatever it has; the browser will synthesize
 * missing ones from the nearest available face.
 */
const WEIGHT_LIST = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const

const loadingFamilies = new Map<string, Promise<void>>()
const loadedFamilies = new Set<string>()

/**
 * Subscribers to "a font just finished downloading". The layout engine
 * uses this to trigger a fresh measurement pass; the dropdown uses it
 * to clear a "loading" spinner.
 */
type Listener = () => void
const listeners = new Set<Listener>()
export function subscribeFontLoaded(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
function notify(): void {
  for (const fn of listeners) fn()
}

/**
 * Public hook for OTHER font sources (custom-font registrations from
 * `src/fonts/`) to trigger the same layout re-solve `notify()` does
 * for Google font loads. Just re-emits the same event; subscribers
 * (useLayout via useFontLoadVersion, the Inspector picker, etc.)
 * can't tell which source fired.
 */
export function notifyFontLoaded(): void {
  notify()
}

/**
 * Construct the Google Fonts CSS v2 URL for the given family. Requests
 * all weights in a single fetch (Google collapses them into one CSS
 * response with multiple @font-face blocks).
 */
function cssUrl(family: string): string {
  const encoded = family.replace(/ /g, '+')
  const weights = WEIGHT_LIST.join(';')
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@${weights}&display=swap`
}

/**
 * Wait for Google's stylesheet before asking the Font Loading API for a
 * face. Calling `document.fonts.load()` before the stylesheet has parsed can
 * resolve with an empty array: there was no matching @font-face yet, but the
 * old loader treated that as success and permanently kept fallback metrics.
 */
async function ensureStylesheetLoaded(family: string): Promise<void> {
  const attr = 'data-gf-family'
  let link = document.querySelector<HTMLLinkElement>(
    `link[${attr}="${family}"]`,
  )
  const needsAppend = !link

  if (!link) {
    link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = cssUrl(family)
    link.setAttribute(attr, family)
  }

  // `sheet` is populated once an existing stylesheet has loaded. This also
  // covers hot reloads, where the link survives but this module's state does
  // not.
  if (link.sheet) return

  const ready = new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      link.removeEventListener('load', onLoad)
      link.removeEventListener('error', onError)
    }
    const onLoad = (): void => {
      cleanup()
      resolve()
    }
    const onError = (): void => {
      cleanup()
      reject(new Error(`Failed to load Google Fonts stylesheet for ${family}`))
    }

    link.addEventListener('load', onLoad)
    link.addEventListener('error', onError)
  })

  if (needsAppend) document.head.appendChild(link)

  try {
    await ready
  } catch (error) {
    // An errored <link> will not emit another load event. Remove it so a later
    // call creates a fresh request instead of getting stuck on the dead node.
    link.remove()
    throw error
  }
}

async function loadGoogleFontOnce(family: string): Promise<void> {
  try {
    await ensureStylesheetLoaded(family)

    if ('fonts' in document) {
      // Wait for every requested weight, then publish one layout invalidation
      // for the family. The previous per-weight notification could trigger
      // nine Yoga solves and nine WebGL texture refreshes in the same task.
      const loadedWeights = await Promise.all(
        WEIGHT_LIST.map(async (weight): Promise<boolean> => {
          try {
            const faces = await document.fonts.load(
              `${weight} 16px "${family}"`,
            )
            if (faces.length === 0) return false
            return true
          } catch {
            return false
          }
        }),
      )

      // A stylesheet can load while its faces fail (network/CSP), and
      // FontFaceSet.load can resolve early with no matches. Only cache the
      // family when every requested weight produced a real face; otherwise a
      // later call retries the incomplete load.
      if (loadedWeights.every(Boolean)) loadedFamilies.add(family)
      if (loadedWeights.some(Boolean)) notify()
    } else {
      // Old browsers without the Font Loading API — stylesheet readiness is
      // the strongest signal available.
      loadedFamilies.add(family)
      notify()
    }
  } catch {
    // Network down, or CSP blocked the stylesheet. Keeping the family out of
    // loadedFamilies lets a later call retry.
  }
}

/**
 * Ensure `family` is loaded. Safe to call repeatedly — concurrent callers
 * share one promise, and subsequent calls return immediately after a fully
 * successful load.
 *
 * Resolves after all requested weights have either loaded or failed. Failed
 * and empty-face attempts are not cached, so callers can retry later.
 */
export function loadGoogleFont(family: string): Promise<void> {
  if (loadedFamilies.has(family)) return Promise.resolve()
  if (!GOOGLE_FAMILY_SET.has(family)) return Promise.resolve()
  if (typeof document === 'undefined') return Promise.resolve()

  const existing = loadingFamilies.get(family)
  if (existing) return existing

  const attempt = loadGoogleFontOnce(family)
  const tracked = attempt.finally(() => {
    if (loadingFamilies.get(family) === tracked) {
      loadingFamilies.delete(family)
    }
  })
  loadingFamilies.set(family, tracked)
  return tracked
}

/**
 * React hook: a monotonic counter that bumps each time ANY Google font
 * finishes loading. Useful as a dep in `useMemo` / `useEffect` to force
 * a re-solve once type metrics become available.
 */
export function useFontLoadVersion(): number {
  const [v, setV] = useState(0)
  useEffect(() => subscribeFontLoaded(() => setV((x) => x + 1)), [])
  return v
}

/**
 * Walk the scene on mount (and after every scene mutation) and pre-load
 * any Google Fonts referenced by text nodes. Without this, opening a
 * persisted scene would render its Google-font text in the fallback
 * face until the user happened to select the node in the Inspector.
 *
 * Cheap to run: `loadGoogleFont` is idempotent, and in normal use the
 * set of unique families across a scene is tiny (< 10). We collect
 * them into a Set so a scene with 50 text nodes in "Inter" still only
 * issues one network request.
 */
export function useEagerLoadSceneFonts(): void {
  const api = useSceneAPI()
  const version = useSceneVersion()

  useEffect(() => {
    const seen = new Set<string>()
    const rootId = api.getRoot()
    if (!rootId) return

    const visit = (id: NodeId): void => {
      const node: Node | null = api.getNode(id)
      if (!node) return
      if (node.kind === 'text') {
        const first = node.fontFamily
          .split(',')[0]
          ?.trim()
          .replace(/^['"]|['"]$/g, '') ?? ''
        if (first && !seen.has(first) && GOOGLE_FAMILY_SET.has(first)) {
          seen.add(first)
          void loadGoogleFont(first)
        }
      }
      for (const child of api.getChildren(id)) visit(child.id)
    }

    visit(rootId)
  }, [api, version])
}

// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState } from 'react'
import type { Yoga } from 'yoga-layout/load'
import type { NodeId } from '@/scene'
import { useSceneAPI, useSceneVersion } from '@/scene'
import { solveLayout, yogaReady, type ContainerSize, type SolvedLayout } from '@/layout'
import { useFontLoadVersion } from '@/ui/fonts/googleFonts'

/**
 * Compute the solved layout for a subtree of the scene.
 *
 * Returns `null` while Yoga WASM is still loading — the Canvas panel
 * uses that to show a brief "preparing" state on first mount. After
 * the first resolve, Yoga is cached at module scope in @/layout and
 * this hook produces a fresh SolvedLayout synchronously per render.
 *
 * Dirty policy (v1): re-solve on every scene mutation.
 *
 *   - `useSceneVersion` bumps once per transaction (not per frame),
 *     so this is nowhere near "every tick". Normal editing causes
 *     at most a few solves per second.
 *   - A more aggressive policy — diff the last snapshot against
 *     LAYOUT_AFFECTING_PROPERTIES and skip solves that only moved
 *     transform/opacity — is easy to add later, but only worth it
 *     if a profile shows the solve dominating. For now, simpler.
 *
 * Not used on the animation hot path. The anim engine writes
 * transform/opacity as post-layout offsets; it never triggers a
 * relayout per frame. Layout-property keyframes (gap, padding,
 * variant) will go through a dedicated FLIP path, not this hook.
 */
export function useLayout(
  rootId: NodeId | null,
  container: ContainerSize,
): SolvedLayout | null {
  const api = useSceneAPI()
  const version = useSceneVersion()
  // Google fonts finishing their network load shifts text metrics, so
  // the solved layout has to be redone without any scene mutation. The
  // font-load version counter provides exactly that trigger.
  const fontVersion = useFontLoadVersion()
  const [yoga, setYoga] = useState<Yoga | null>(null)
  const [yogaError, setYogaError] = useState<Error | null>(null)

  // Load WASM once. yogaReady is memoized at module scope in @/layout,
  // so even if many components call useLayout, only one fetch happens.
  useEffect(() => {
    let cancelled = false
    yogaReady
      .then((y) => {
        if (!cancelled) setYoga(y)
      })
      .catch((err: unknown) => {
        // A rejected WASM load leaves `yoga` null forever, which renders
        // as an editor stuck on its "preparing" state. Re-throw through
        // the ErrorBoundary instead of leaving the user to guess.
        if (!cancelled) {
          setYogaError(err instanceof Error ? err : new Error(String(err)))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Re-solve when Yoga becomes available, when the scene mutates
  // (version), when the caller targets a different root, or when the
  // container resizes. Container is spread into primitive deps so a
  // caller that reconstructs the object inline doesn't force a resolve.
  const solved = useMemo(() => {
    if (!yoga || !rootId) return null
    return solveLayout(yoga, api, rootId, container)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yoga, api, rootId, container.width, container.height, version, fontVersion])

  if (yogaError) throw yogaError
  return solved
}
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Yoga } from 'yoga-layout/load'
import type { NodeId } from '@/scene'
import { useSceneAPI, useSceneVersion } from '@/scene'
import { solveLayout, yogaReady, type ContainerSize, type SolvedLayout } from '@/layout'
import { getAnimEngine } from '@/anim'
import { useFontLoadVersion } from '@/ui/fonts/googleFonts'
import {
  nodeLayoutPreviewStore,
  sceneAPIWithNodeLayoutPreviews,
} from '@/ui/nodeLayoutPreviewStore'
import {
  canPatchAnimatedLayout,
  createAnimatedLayoutSnapshotSelector,
  patchAnimatedLayout,
  sceneAPIWithAnimatedLayout,
} from '@/ui/animatedLayout'

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
 *   - Size and typography scrubs keep the authored layout frozen and paint
 *     only a selected-node proxy. Release produces one authoritative solve.
 *   - Layout controls (gap, padding, and related container values) publish to
 *     a dedicated rAF-coalesced preview lane. Yoga reads that read-only facade
 *     at display rate while the durable scene stays untouched until release.
 *   - A more aggressive policy — diff the last snapshot against
 *     LAYOUT_AFFECTING_PROPERTIES and skip solves that only moved
 *     transform/opacity — is easy to add later, but only worth it
 *     if a profile shows the solve dominating. For now, simpler.
 *
 * Width/height, gap, padding, and direction tracks are the deliberate
 * exceptions to the normal post-layout animation path. Free-positioned
 * size-only leaves patch their solved rect directly; flow children and layout
 * containers re-solve so siblings and descendants remain correct. Transform,
 * opacity, paint, and other animation fields stay filtered out and do not
 * invalidate layout.
 */
export function useLayout(
  rootId: NodeId | null,
  container: ContainerSize,
): SolvedLayout | null {
  const api = useSceneAPI()
  const version = useSceneVersion()
  const layoutPreview = useSyncExternalStore(
    nodeLayoutPreviewStore.subscribe,
    nodeLayoutPreviewStore.getSnapshot,
    nodeLayoutPreviewStore.getSnapshot,
  )
  const previewApi = useMemo(
    () => sceneAPIWithNodeLayoutPreviews(api, layoutPreview),
    [api, layoutPreview],
  )
  const animationEngine = getAnimEngine()
  const selectAnimatedLayout = useMemo(
    () => createAnimatedLayoutSnapshotSelector(),
    [],
  )
  const getAnimatedLayout = useMemo(
    () => () => selectAnimatedLayout(animationEngine.getSnapshot()),
    [animationEngine, selectAnimatedLayout],
  )
  const animatedLayout = useSyncExternalStore(
    animationEngine.subscribe,
    getAnimatedLayout,
    getAnimatedLayout,
  )
  // Google fonts finishing their network load shifts text metrics, so
  // the solved layout has to be redone without any scene mutation. The
  // font-load version counter provides exactly that trigger.
  const fontVersion = useFontLoadVersion()
  const [yoga, setYoga] = useState<Yoga | null>(null)

  // Load WASM once. yogaReady is memoized at module scope in @/layout,
  // so even if many components call useLayout, only one fetch happens.
  useEffect(() => {
    let cancelled = false
    yogaReady.then((y) => {
      if (!cancelled) setYoga(y)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Keep the authoritative, non-animated solve cached. This remains stable
  // across playback frames and gives free-positioned leaf resize tracks a
  // cheap rect-only path below.
  const authoredLayout = useMemo(() => {
    if (!yoga || !rootId) return null
    return solveLayout(yoga, previewApi, rootId, container)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    yoga,
    previewApi,
    rootId,
    container.width,
    container.height,
    version,
    fontVersion,
  ])

  // A leaf under layout:none cannot reflow anything, so patch just its box.
  // Flex/grid children and animated containers still receive a complete Yoga
  // solve, preserving fill/hug semantics and sibling movement.
  return useMemo(() => {
    if (!authoredLayout || !yoga || !rootId) return authoredLayout
    if (Object.keys(animatedLayout).length === 0) return authoredLayout
    if (canPatchAnimatedLayout(previewApi, animatedLayout)) {
      return patchAnimatedLayout(authoredLayout, animatedLayout)
    }
    // Track values replace authored values, but an active inspector scrub is
    // the newest user intent and must paint above the track until release.
    // The durable commit then stamps the active track and clears the preview.
    const animatedApi = sceneAPIWithAnimatedLayout(api, animatedLayout)
    const liveApi = sceneAPIWithNodeLayoutPreviews(animatedApi, layoutPreview)
    return solveLayout(yoga, liveApi, rootId, {
      width: container.width,
      height: container.height,
    })
  }, [
    animatedLayout,
    authoredLayout,
    container.height,
    container.width,
    api,
    layoutPreview,
    previewApi,
    rootId,
    yoga,
  ])
}

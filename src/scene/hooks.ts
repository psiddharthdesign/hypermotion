// SPDX-License-Identifier: Apache-2.0

import { useContext, useEffect, useState } from 'react'
import type { SceneAPI } from '@/scene/doc'
import { SceneContext } from '@/scene/internals'

/**
 * Read the SceneAPI from context. Throws if used outside <SceneProvider>.
 */
export function useSceneAPI(): SceneAPI {
  const api = useContext(SceneContext)
  if (!api) throw new Error('useSceneAPI must be used within <SceneProvider>')
  return api
}

/**
 * Subscribe to scene mutations via a monotonic version counter.
 *
 * The returned number bumps on every scene change; most components
 * ignore the value and just let it drive a re-render, then read the
 * specific data they care about directly from the API.
 *
 * Deliberately coarse: every mutation re-renders every subscriber.
 * Fine for panel-scale reactivity. Upgrade to per-node subscriptions
 * only when render cost actually shows up in a profile.
 */
export function useSceneVersion(): number {
  const api = useSceneAPI()
  const [version, setVersion] = useState(api.getVersion())
  useEffect(() => api.subscribe(() => setVersion(api.getVersion())), [api])
  return version
}
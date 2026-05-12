// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState, type ReactNode } from 'react'
import type { SceneAPI } from '@/scene/doc'
import { SceneContext, apiReady } from '@/scene/internals'

/**
 * React bindings around the scene API.
 *
 * Only exports the provider component — the hooks live in hooks.ts
 * and the singletons in internals.ts. This split keeps Vite's
 * Fast Refresh happy (a file must export only components OR only
 * non-components; mixed files force a full reload on every edit).
 *
 * The Y.Doc, IndexedDB provider, and seeding decision all happen at
 * module scope inside internals.ts — see the comment there for why.
 * By the time this component mounts, `apiReady` is already awaiting
 * sync and will resolve once the doc is hydrated (and seeded if it
 * was empty).
 */
export function SceneProvider({
  children,
  fallback,
}: {
  children: ReactNode
  fallback?: ReactNode
}) {
  const [api, setApi] = useState<SceneAPI | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    apiReady
      .then((a) => {
        if (!cancelled) setApi(a)
      })
      .catch((err) => {
        // Without this catch, apiReady rejection would just print an
        // unhandled-promise warning in the console and leave the
        // SceneProvider stuck on its loading fallback forever — what
        // showed up as "blank page." Surface the error in render so
        // the user / debugger sees it.
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    // Throwing here pushes the error into the nearest ErrorBoundary,
    // which renders the message + stack trace.
    throw error
  }
  if (!api) return <>{fallback ?? null}</>
  return <SceneContext.Provider value={api}>{children}</SceneContext.Provider>
}
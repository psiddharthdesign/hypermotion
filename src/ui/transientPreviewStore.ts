// SPDX-License-Identifier: Apache-2.0

/**
 * Display-rate transient value store shared by the timeline's drag previews.
 *
 * Keyframe, chapter, and trail-profile drags all deliver hundreds of pointer
 * packets per second. Writing every packet into the Yjs scene document
 * invalidates the whole editor tree, restarts animation snapshots, and floods
 * undo history. Each of those previews instead keeps its packets out of the
 * document in a store like this one: pointer packets are coalesced to at most
 * one publish per `requestAnimationFrame`, and only the subscribers whose keys
 * actually moved repaint.
 *
 * The store is intentionally generic over the key type `K` and value type `V`.
 * Callers stay responsible for turning their domain input (drag deltas,
 * chapter arrays, spline values) into the next visible `Map<K, V>` via the
 * `produce` closure passed to `schedule`; that closure runs at publish time so
 * the newest packet wins.
 */
export interface TransientPreviewStore<K, V> {
  /**
   * Queue the latest preview. Pointer packets are coalesced to one paint; the
   * `produce` closure is only invoked when the queued packet is published.
   */
  schedule: (produce: () => Map<K, V>) => void
  /** Publish a queued packet immediately (used just before the durable commit). */
  flush: () => void
  /** Keep the final preview for one paint, then release it to durable data. */
  finish: () => void
  /** Drop a cancelled gesture immediately. */
  cancel: () => void
  get: (key: K) => V | undefined
  getRevision: () => number
  subscribe: (key: K, listener: () => void) => () => void
  subscribeAll: (listener: () => void) => () => void
}

/**
 * Create a transient preview store.
 *
 * `hasChanged` decides whether a published value differs from the currently
 * visible one and therefore needs to notify its key's subscribers. It defaults
 * to reference identity, which is correct for primitive values and for values
 * that are recreated on every packet.
 */
export function createTransientPreviewStore<K, V>(
  hasChanged: (previous: V | undefined, next: V) => boolean = (a, b) => a !== b,
): TransientPreviewStore<K, V> {
  let visible = new Map<K, V>()
  let pending: (() => Map<K, V>) | null = null
  let frame: number | null = null
  let finishFrame: number | null = null
  let revision = 0
  const listeners = new Map<K, Set<() => void>>()
  const allListeners = new Set<() => void>()

  const notify = (keys: Set<K>) => {
    if (keys.size === 0) return
    revision++
    const called = new Set<() => void>()
    for (const listener of allListeners) {
      called.add(listener)
      listener()
    }
    for (const key of keys) {
      for (const listener of listeners.get(key) ?? []) {
        if (called.has(listener)) continue
        called.add(listener)
        listener()
      }
    }
  }

  const clearVisible = () => {
    if (visible.size === 0) return
    const changed = new Set(visible.keys())
    visible = new Map()
    notify(changed)
  }

  const publishPending = () => {
    if (!pending) return
    const next = pending()
    pending = null
    const changed = new Set<K>()
    for (const [key, value] of next) {
      if (hasChanged(visible.get(key), value)) changed.add(key)
    }
    for (const key of visible.keys()) {
      if (!next.has(key)) changed.add(key)
    }
    visible = next
    notify(changed)
  }

  return {
    schedule: (produce) => {
      pending = produce
      if (finishFrame !== null) {
        cancelAnimationFrame(finishFrame)
        finishFrame = null
      }
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        publishPending()
      })
    },
    flush: () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      publishPending()
    },
    finish: () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      publishPending()
      if (finishFrame !== null) cancelAnimationFrame(finishFrame)
      // The document subscription gets the committed data first. Holding this
      // final visual value until the next paint avoids a one-frame jump back
      // to the stale prop while React reconciles that scene update.
      finishFrame = requestAnimationFrame(() => {
        finishFrame = null
        clearVisible()
      })
    },
    cancel: () => {
      if (frame !== null) cancelAnimationFrame(frame)
      if (finishFrame !== null) cancelAnimationFrame(finishFrame)
      frame = null
      finishFrame = null
      pending = null
      clearVisible()
    },
    get: (key) => visible.get(key),
    getRevision: () => revision,
    subscribe: (key, listener) => {
      let bucket = listeners.get(key)
      if (!bucket) {
        bucket = new Set()
        listeners.set(key, bucket)
      }
      bucket.add(listener)
      return () => {
        bucket!.delete(listener)
        if (bucket!.size === 0) listeners.delete(key)
      }
    },
    subscribeAll: (listener) => {
      allListeners.add(listener)
      return () => allListeners.delete(listener)
    },
  }
}

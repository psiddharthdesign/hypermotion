// SPDX-License-Identifier: Apache-2.0

import type { TextMotionPath, TextStaggerCurve } from '@/anim'
import type { NodeId } from '@/scene'

export interface TextStaggerCurvePreviewStore {
  preview: (
    nodeIds: readonly NodeId[],
    value: TextStaggerCurvePreviewValue,
  ) => void
  flush: () => void
  finish: () => void
  cancel: () => void
  getPreview: (nodeId: NodeId) => TextStaggerCurvePreviewValue | undefined
  getRevision: () => number
  subscribe: (nodeId: NodeId, listener: () => void) => () => void
  subscribeAll: (listener: () => void) => () => void
}

export interface TextStaggerCurvePreviewValue {
  curve?: TextStaggerCurve
  motionPath?: TextMotionPath
  duration?: number
}

interface PendingCurvePreview {
  nodeIds: readonly NodeId[]
  value: TextStaggerCurvePreviewValue
}

/**
 * Display-rate trail-profile edits kept outside the Yjs scene document.
 * Pointer packets publish at most once per paint; only pointer-up persists the
 * final spline, so live tuning remains smooth and produces one undo step.
 */
export function createTextStaggerCurvePreviewStore(): TextStaggerCurvePreviewStore {
  let visible = new Map<NodeId, TextStaggerCurvePreviewValue>()
  let pending: PendingCurvePreview | null = null
  let frame: number | null = null
  let finishFrame: number | null = null
  let revision = 0
  const listeners = new Map<NodeId, Set<() => void>>()
  const allListeners = new Set<() => void>()

  const notify = (ids: Set<NodeId>) => {
    if (ids.size === 0) return
    revision++
    const called = new Set<() => void>()
    for (const listener of allListeners) {
      called.add(listener)
      listener()
    }
    for (const id of ids) {
      for (const listener of listeners.get(id) ?? []) {
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
    const next = new Map<NodeId, TextStaggerCurvePreviewValue>()
    for (const nodeId of pending.nodeIds) next.set(nodeId, pending.value)
    pending = null
    const changed = new Set<NodeId>()
    for (const [nodeId, value] of next) {
      if (visible.get(nodeId) !== value) changed.add(nodeId)
    }
    for (const nodeId of visible.keys()) {
      if (!next.has(nodeId)) changed.add(nodeId)
    }
    visible = next
    notify(changed)
  }

  return {
    preview: (nodeIds, value) => {
      pending = { nodeIds, value }
      if (finishFrame !== null) cancelAnimationFrame(finishFrame)
      finishFrame = null
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
    getPreview: (nodeId) => visible.get(nodeId),
    getRevision: () => revision,
    subscribe: (nodeId, listener) => {
      let bucket = listeners.get(nodeId)
      if (!bucket) {
        bucket = new Set()
        listeners.set(nodeId, bucket)
      }
      bucket.add(listener)
      return () => {
        bucket!.delete(listener)
        if (bucket!.size === 0) listeners.delete(nodeId)
      }
    },
    subscribeAll: (listener) => {
      allListeners.add(listener)
      return () => allListeners.delete(listener)
    },
  }
}

export const textStaggerCurvePreviewStore =
  createTextStaggerCurvePreviewStore()

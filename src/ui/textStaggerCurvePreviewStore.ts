// SPDX-License-Identifier: Apache-2.0

import type { TextMotionPath, TextStaggerCurve } from '@/anim'
import type { NodeId } from '@/scene'
import { createTransientPreviewStore } from '@/ui/transientPreviewStore'

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

/**
 * Display-rate trail-profile edits kept outside the Yjs scene document.
 * Pointer packets publish at most once per paint; only pointer-up persists the
 * final spline, so live tuning remains smooth and produces one undo step.
 */
export function createTextStaggerCurvePreviewStore(): TextStaggerCurvePreviewStore {
  const core = createTransientPreviewStore<NodeId, TextStaggerCurvePreviewValue>()
  return {
    preview: (nodeIds, value) =>
      core.schedule(() => {
        const next = new Map<NodeId, TextStaggerCurvePreviewValue>()
        for (const nodeId of nodeIds) next.set(nodeId, value)
        return next
      }),
    flush: core.flush,
    finish: core.finish,
    cancel: core.cancel,
    getPreview: (nodeId) => core.get(nodeId),
    getRevision: core.getRevision,
    subscribe: core.subscribe,
    subscribeAll: core.subscribeAll,
  }
}

export const textStaggerCurvePreviewStore =
  createTextStaggerCurvePreviewStore()

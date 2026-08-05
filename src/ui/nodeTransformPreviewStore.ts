// SPDX-License-Identifier: Apache-2.0

import type { Node, NodeId, SceneAPI } from '@/scene'
import type { AnimatedValue } from '@/anim'
import { evaluateLayerMotionPath } from '@/anim/layerMotionPath'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

export interface NodeTransformPreview {
  x: number
  y: number
}

/**
 * Any renderer-facing property that can be previewed without touching Yjs.
 * The historic store name is retained because transforms remain its primary
 * caller, but Inspector sliders also use the same lightweight lane for
 * opacity, corners, anchors, and motion-path progress.
 */
export type NodeVisualPreview = AnimatedValue

export interface NodeTransformDragOrigin {
  /** Effective value currently painted, including an active motion path. */
  display: NodeTransformPreview
  /** Static transform to persist after applying the pointer delta. */
  static: NodeTransformPreview
  /** Track value to stamp after applying the pointer delta. */
  author: NodeTransformPreview
}

interface NodeTransformAnimationValue {
  x?: number
  y?: number
  motionPathProgress?: number
}

/** Keep painted, static, and authored-track coordinate spaces distinct. */
export function nodeTransformDragOrigin(
  node: Node,
  animated: NodeTransformAnimationValue | undefined,
): NodeTransformDragOrigin {
  const pathOffset =
    node.motionPath && animated?.motionPathProgress !== undefined
      ? evaluateLayerMotionPath(node.motionPath, animated.motionPathProgress)
      : { x: 0, y: 0 }
  const display = {
    x: animated?.x ?? node.transform.x,
    y: animated?.y ?? node.transform.y,
  }
  return {
    display,
    static: { x: node.transform.x, y: node.transform.y },
    author: {
      x: display.x - pathOffset.x,
      y: display.y - pathOffset.y,
    },
  }
}

export type NodeTransformPreviewSnapshot = Readonly<
  Record<NodeId, NodeVisualPreview>
>

export type NodeTransformCommitSnapshot = Readonly<
  Record<NodeId, NodeTransformPreview>
>

export interface NodeTransformPreviewStore {
  getSnapshot: () => NodeTransformPreviewSnapshot
  subscribe: (listener: () => void) => () => void
  preview: (values: NodeTransformPreviewSnapshot) => void
  /** Publish the final packet now, then release it after one durable-data paint. */
  finish: () => void
  clear: () => void
}

const EMPTY_PREVIEW = Object.freeze({}) as NodeTransformPreviewSnapshot

/**
 * Display-rate layer transforms kept outside the durable scene document.
 *
 * Pointer hardware can publish substantially faster than the display. Keeping
 * only the latest packet and publishing it once per animation frame lets the
 * WebGL/selection leaves follow the pointer without invalidating Yoga, every
 * scene subscriber, and undo history for every raw input event.
 */
export function createNodeTransformPreviewStore(): NodeTransformPreviewStore {
  let visible = EMPTY_PREVIEW
  let pending: NodeTransformPreviewSnapshot | null = null
  let frame: number | null = null
  let finishFrame: number | null = null
  const listeners = new Set<() => void>()

  const publish = (next: NodeTransformPreviewSnapshot) => {
    if (visible === next) return
    visible = next
    for (const listener of listeners) listener()
  }

  const publishPending = () => {
    if (!pending) return
    const next = pending
    pending = null
    publish(next)
  }

  return {
    getSnapshot: () => visible,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    preview: (values) => {
      pending = values
      if (finishFrame !== null) cancelAnimationFrame(finishFrame)
      finishFrame = null
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        publishPending()
      })
    },
    finish: () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      publishPending()
      if (finishFrame !== null) cancelAnimationFrame(finishFrame)
      finishFrame = requestAnimationFrame(() => {
        finishFrame = null
        publish(EMPTY_PREVIEW)
      })
    },
    clear: () => {
      if (frame !== null) cancelAnimationFrame(frame)
      if (finishFrame !== null) cancelAnimationFrame(finishFrame)
      frame = null
      finishFrame = null
      pending = null
      publish(EMPTY_PREVIEW)
    },
  }
}

export const nodeTransformPreviewStore = createNodeTransformPreviewStore()

/**
 * Persist the final gesture in one undoable Yjs transaction.
 *
 * `onCommit` stays inside the same transaction so auto-key / active-track
 * authoring and the static transform remain one user-visible undo step.
 */
export function commitNodeTransformPreviews(
  api: SceneAPI,
  values: NodeTransformCommitSnapshot,
  onCommit?: (nodeId: NodeId, value: NodeTransformPreview) => void,
): void {
  const entries = Object.entries(values)
  if (entries.length === 0) return
  api.doc.transact(() => {
    for (const [nodeId, value] of entries) {
      const node = api.getNode(nodeId)
      if (!node) continue
      api.setNodeProperty(nodeId, 'transform', {
        ...node.transform,
        x: value.x,
        y: value.y,
      })
      onCommit?.(nodeId, value)
    }
  }, UNDOABLE_GESTURE_ORIGIN)
}

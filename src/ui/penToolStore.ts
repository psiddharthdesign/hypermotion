// SPDX-License-Identifier: Apache-2.0

import type { VectorDocument, VectorPosition } from '@/scene'

/**
 * State for one in-progress Pen tool path — held here, NOT in the scene
 * document, until the path is finished (closed, or ended open) or
 * cancelled. Nothing is written to Yjs/undo history while drawing;
 * cancelling (Escape) just clears this and nothing ever happened.
 */
export interface PenSession {
  itemId: string
  firstPointId: string
  lastPointId: string
  /** Segment ending at `lastPointId` — the one a drag on that point mirrors an incoming handle onto. `null` right after placing the path's first point (nothing to mirror yet). */
  incomingSegmentId: string | null
  document: VectorDocument
  /** Set by `dragVectorPenAnchor` while dragging the just-placed point; consumed by the next `appendVectorPenPoint`/`closeVectorPenPath` call, then cleared. */
  pendingOutgoingHandle: VectorPosition | null
  /** Live cursor position (canvas-space, same space as the session's points), for the overlay's rubber-band preview line. `null` before the pointer has moved at all. */
  cursor: VectorPosition | null
}

export interface PenToolStore {
  getSnapshot: () => PenSession | null
  subscribe: (listener: () => void) => () => void
  start: (session: PenSession) => void
  update: (session: PenSession) => void
  setCursor: (cursor: VectorPosition) => void
  clear: () => void
}

export function createPenToolStore(): PenToolStore {
  let current: PenSession | null = null
  const listeners = new Set<() => void>()

  const publish = () => {
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start: (session) => {
      current = session
      publish()
    },
    update: (session) => {
      current = session
      publish()
    },
    setCursor: (cursor) => {
      if (!current) return
      current = { ...current, cursor }
      publish()
    },
    clear: () => {
      if (!current) return
      current = null
      publish()
    },
  }
}

export const penToolStore = createPenToolStore()

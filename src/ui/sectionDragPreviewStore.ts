// SPDX-License-Identifier: Apache-2.0

import type { Section } from '@/scene'
import type { SceneAPI } from '@/scene/doc'

export interface SectionDragPreviewStore {
  preview: (sections: readonly Section[]) => void
  flush: () => void
  finish: () => void
  cancel: () => void
  getSection: (sectionId: string, fallback: Section) => Section
  subscribe: (sectionId: string, listener: () => void) => () => void
}

/**
 * Display-rate chapter positions kept outside the Yjs scene document.
 *
 * Chapter edge/body drags can deliver hundreds of pointer packets and may
 * affect both neighboring chapters. Publishing only the latest packet once
 * per paint keeps those few pills live while avoiding a full Timeline rebuild
 * and undo entry for every packet.
 */
export function createSectionDragPreviewStore(): SectionDragPreviewStore {
  let visible = new Map<string, Section>()
  let pending: readonly Section[] | null = null
  let frame: number | null = null
  let finishFrame: number | null = null
  const listeners = new Map<string, Set<() => void>>()

  const notify = (ids: Set<string>) => {
    const called = new Set<() => void>()
    for (const id of ids) {
      for (const listener of listeners.get(id) ?? []) {
        if (called.has(listener)) continue
        called.add(listener)
        listener()
      }
    }
  }

  const publishPending = () => {
    if (!pending) return
    const next = new Map(pending.map((section) => [section.id, section]))
    pending = null
    const changed = new Set<string>()
    for (const [id, section] of next) {
      const previous = visible.get(id)
      if (
        !previous ||
        previous.start !== section.start ||
        previous.end !== section.end ||
        previous.name !== section.name ||
        previous.color !== section.color
      ) {
        changed.add(id)
      }
    }
    for (const id of visible.keys()) {
      if (!next.has(id)) changed.add(id)
    }
    visible = next
    notify(changed)
  }

  const clearVisible = () => {
    if (visible.size === 0) return
    const changed = new Set(visible.keys())
    visible = new Map()
    notify(changed)
  }

  return {
    preview: (sections) => {
      pending = sections
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
    getSection: (sectionId, fallback) => visible.get(sectionId) ?? fallback,
    subscribe: (sectionId, listener) => {
      let bucket = listeners.get(sectionId)
      if (!bucket) {
        bucket = new Set()
        listeners.set(sectionId, bucket)
      }
      bucket.add(listener)
      return () => {
        bucket!.delete(listener)
        if (bucket!.size === 0) listeners.delete(sectionId)
      }
    },
  }
}

export const sectionDragPreviewStore = createSectionDragPreviewStore()

export function commitSectionDrag(
  api: SceneAPI,
  targets: readonly Section[],
): void {
  if (targets.length === 0) return
  const current = new Map(api.getSections().map((section) => [section.id, section]))
  const changed = targets.filter((target) => {
    const before = current.get(target.id)
    return (
      !before ||
      before.start !== target.start ||
      before.end !== target.end ||
      before.name !== target.name ||
      before.color !== target.color
    )
  })
  if (changed.length === 0) return
  api.doc.transact(() => {
    for (const section of changed) api.setSection(section)
  })
}

export interface SectionDragSession {
  preview: (targets: readonly Section[]) => void
  commit: () => void
  cancel: () => void
}

export function createSectionDragSession(
  api: SceneAPI,
  store: SectionDragPreviewStore = sectionDragPreviewStore,
): SectionDragSession {
  let targets: readonly Section[] = []
  let moved = false
  let ended = false
  return {
    preview: (nextTargets) => {
      if (ended) return
      moved = true
      targets = nextTargets
      store.preview(nextTargets)
    },
    commit: () => {
      if (ended) return
      if (moved) {
        store.flush()
        commitSectionDrag(api, targets)
      }
      ended = true
      if (moved) store.finish()
      else store.cancel()
    },
    cancel: () => {
      if (ended) return
      ended = true
      store.cancel()
    },
  }
}

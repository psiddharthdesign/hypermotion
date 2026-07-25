// SPDX-License-Identifier: Apache-2.0

import type { Section } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { createTransientPreviewStore } from '@/ui/transientPreviewStore'

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
  const core = createTransientPreviewStore<string, Section>(
    (previous, next) =>
      !previous ||
      previous.start !== next.start ||
      previous.end !== next.end ||
      previous.name !== next.name ||
      previous.color !== next.color,
  )
  return {
    preview: (sections) =>
      core.schedule(() => new Map(sections.map((section) => [section.id, section]))),
    flush: core.flush,
    finish: core.finish,
    cancel: core.cancel,
    getSection: (sectionId, fallback) => core.get(sectionId) ?? fallback,
    subscribe: core.subscribe,
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

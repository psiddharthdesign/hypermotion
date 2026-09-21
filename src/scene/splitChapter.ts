// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import type { SceneMeta, Section } from '@/scene/types'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

const CHAPTER_COLORS = [
  'oklch(0.78 0.13 230)',
  'oklch(0.80 0.16 80)',
  'oklch(0.74 0.18 150)',
  'oklch(0.74 0.18 350)',
]

/** An empty chapter lane represents the entire composition. */
export function chapterAtSplit(
  sections: Section[],
  meta: Pick<SceneMeta, 'duration' | 'frameRate'>,
  time: number,
  sectionId?: string,
): Section | null {
  if (!Number.isFinite(time) || !Number.isFinite(meta.duration)) return null
  const minimum = Math.max(0.05, 1 / Math.max(1, meta.frameRate || 60))
  if (time < minimum || meta.duration - time < minimum) return null
  const candidates = sectionId
    ? sections.filter((section) => section.id === sectionId)
    : sections
  if (sections.length === 0 && !sectionId) {
    return { id: '', name: 'Chapter 1', color: CHAPTER_COLORS[0]!, start: 0, end: meta.duration }
  }
  // Overlapping chapters are legal. Prefer the most recently starting one;
  // a chapter's context menu always targets that specific chapter.
  return [...candidates].reverse().find((section) =>
    time - section.start >= minimum && section.end - time >= minimum,
  ) ?? null
}

/** Preserve all layer and animation data; add only a chapter boundary. */
export function splitChapterAtTime(api: SceneAPI, time: number, sectionId?: string) {
  const sections = api.getSections()
  const source = chapterAtSplit(sections, api.getMeta(), time, sectionId)
  if (!source) return null

  const names = new Set([...sections.map((section) => section.name), source.name])
  let number = 1
  while (names.has(`Chapter ${number}`)) number += 1
  const before: Section = { ...source, id: source.id || `sec_${crypto.randomUUID()}`, end: time }
  const after: Section = {
    id: `sec_${crypto.randomUUID()}`,
    name: `Chapter ${number}`,
    color: CHAPTER_COLORS[(sections.length || 1) % CHAPTER_COLORS.length]!,
    start: time,
    end: source.end,
  }
  api.doc.transact(() => {
    api.setSection(before)
    api.setSection(after)
  }, UNDOABLE_GESTURE_ORIGIN)
  return { source, before, after }
}

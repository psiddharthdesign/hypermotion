// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { addKeyframe } from '@/anim'
import { createSceneAPI, snapshotScene } from '@/scene/doc'
import { readScene, sceneToBytes } from '@/scene/file'
import type { Section } from '@/scene/types'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { chapterAtSplit, splitChapterAtTime } from './splitChapter'

const chapter = (id: string, start: number, end: number): Section => ({
  id, name: id, color: '#3388ff', start, end,
})

describe('split chapter at playhead', () => {
  it('creates two chapters for an unsectioned scene and survives save/reopen', () => {
    const api = createSceneAPI()
    api.setMeta({ duration: 8 })
    const split = splitChapterAtTime(api, 3)!
    expect(api.getSections()).toEqual([
      { ...split.before, name: 'Chapter 1', start: 0, end: 3 },
      { ...split.after, name: 'Chapter 2', start: 3, end: 8 },
    ])
    expect(split.before.id).not.toBe(split.after.id)
    const reopened = readScene(sceneToBytes(api.doc))
    expect(reopened.api.getSections()).toEqual(api.getSections())
    reopened.doc.destroy()
    api.doc.destroy()
  })

  it('splits the containing chapter without changing animation, media, neighbors or duration', () => {
    const api = createSceneAPI()
    api.setMeta({ duration: 10 })
    const root = api.createNode('frame', null, { name: 'Root' })
    const layer = api.createNode('rect', root, { name: 'Animated layer' })
    api.createNode('video', root, { startTime: 1, duration: 8, trimStart: 0.5 })
    addKeyframe(api, layer, 'transform.x', 1, 20)
    addKeyframe(api, layer, 'transform.x', 8, 200)
    const first = chapter('Intro', 0, 2)
    const middle = chapter('Main', 2, 8)
    const last = chapter('Outro', 8, 10)
    for (const section of [first, middle, last]) api.setSection(section)
    const original = snapshotScene(api)
    const listener = vi.fn()
    api.subscribe(listener)

    const split = splitChapterAtTime(api, 5)!
    expect(listener).toHaveBeenCalledTimes(1)
    expect(api.getSections()).toEqual([
      first, { ...middle, end: 5 }, split.after, last,
    ])
    expect(split.after).toMatchObject({ start: 5, end: 8 })
    const result = snapshotScene(api)
    expect({ ...result, sections: original.sections }).toEqual(original)
    api.doc.destroy()
  })

  it('undoes and redoes both halves together', () => {
    const api = createSceneAPI()
    const original = chapter('Original', 0, 5)
    api.setSection(original)
    const undo = new Y.UndoManager(api.doc.getMap('scene'), {
      trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]),
    })
    const split = splitChapterAtTime(api, 2)!
    expect(undo.undoStack).toHaveLength(1)
    undo.undo()
    expect(api.getSections()).toEqual([original])
    undo.redo()
    expect(api.getSections()).toEqual([split.before, split.after])
    undo.destroy()
    api.doc.destroy()
  })

  it('rejects boundaries, gaps, invalid times and fragments shorter than a frame', () => {
    const api = createSceneAPI()
    api.setMeta({ duration: 6, frameRate: 10 })
    api.setSection(chapter('First', 0, 2))
    api.setSection(chapter('Second', 3, 6))
    const original = api.getSections()
    const listener = vi.fn()
    api.subscribe(listener)
    for (const time of [-1, 0, 0.05, 1.95, 2, 2.5, 3, 6, 7, NaN, Infinity]) {
      expect(splitChapterAtTime(api, time)).toBeNull()
    }
    expect(api.getSections()).toEqual(original)
    expect(listener).not.toHaveBeenCalled()
    api.doc.destroy()
  })

  it('targets the requested overlapping chapter and avoids duplicate chapter names', () => {
    const api = createSceneAPI()
    api.setMeta({ duration: 8 })
    const outer = chapter('Chapter 1', 0, 8)
    const inner = chapter('Chapter 2', 2, 6)
    api.setSection(outer)
    api.setSection(inner)
    expect(chapterAtSplit(api.getSections(), api.getMeta(), 4)?.id).toBe(inner.id)
    expect(splitChapterAtTime(api, 4, 'missing')).toBeNull()
    const split = splitChapterAtTime(api, 4, outer.id)!
    expect(split.before).toEqual({ ...outer, end: 4 })
    expect(split.after.name).toBe('Chapter 3')
    expect(api.getSections()).toContainEqual(inner)
    api.doc.destroy()
  })
})

// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI, snapshotScene } from '@/scene/doc'
import { readScene, sceneToBytes } from '@/scene/file'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { getAnimEngine } from '@/anim/engine'
import { DEFAULT_TEXT_ANIMATION } from '@/anim/textAnimations'
import { resolveProgramCamera } from '@/sequence'
import { resolvePreviewAudioClock } from '@/audio/previewPlaybackClock'
import { videoVisibleAtTime } from '@/scene/mediaClip'
import { paperShaderFrame } from '@/render/paperShaderRegistry'
import { createProjectAPI } from './doc'
import { sceneSplitTime } from './splitScene'

function fixture() {
  const api = createSceneAPI()
  api.setMeta({ duration: 8, frameRate: 60 })
  const root = api.createNode('frame', null, { name: 'Scene 1' })
  const project = createProjectAPI(api)
  project.ensureInitialized()
  const source = project.getActiveScene()!
  const item = project.getSequenceItems()[0]!
  return { api, root, project, source, item }
}

afterEach(() => vi.unstubAllGlobals())

describe('split scene', () => {
  it('inserts an independent scene after the current one with unchanged Master runtime', () => {
    const { api, root, project, source, item } = fixture()
    const layer = api.createNode('rect', root, { name: 'Card' })
    const next = project.createScene({ name: 'Next', duration: 2 })
    project.activateScene(source.id)
    const result = project.splitScene(source.id, 3, item.id)!
    expect(result.before.duration).toBe(3)
    expect(result.after.duration).toBe(5)
    expect(project.getSequenceItems().map((entry) => entry.sceneId)).toEqual([source.id, result.after.id, next.id])
    expect(project.getSequenceTimeMap().duration).toBe(10)
    expect(project.getActiveSceneId()).toBe(result.after.id)
    const copy = api.getChildren(result.after.rootNodeId)[0]!
    expect(copy.id).not.toBe(layer)
    api.setNodeProperty(copy.id, 'name', 'Edited copy')
    expect(api.getNode(layer)?.name).toBe('Card')
    api.doc.destroy()
  })

  it('preserves eased animation through the split and supports splitting again', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const { api, root, project, source } = fixture()
    const layer = api.createNode('rect', root, { name: 'Card' })
    api.setTrack({ id: 'motion', nodeId: layer, propertyId: 'transform.x', defaultEasing: { bezier: [0.2, 0.9, 0.7, 0.1] },
      keyframes: [{ id: 'a', time: 0, value: 10 }, { id: 'b', time: 8, value: 500 }] })
    const engine = getAnimEngine()
    engine.attach(api)
    const expected = [3, 3.5, 5, 7.9].map((time) => { engine.seek(time); return engine.getSnapshot()[layer]!.x })
    const split = project.splitScene(source.id, 3)!
    const copy = api.getChildren(split.after.rootNodeId)[0]!
    const actual = [0, 0.5, 2, 4.9].map((time) => { engine.seek(time); return engine.getSnapshot()[copy.id]!.x })
    actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 8))
    const splitAgain = project.splitScene(split.after.id, 2)!
    const finalCopy = api.getChildren(splitAgain.after.rootNodeId)[0]!
    engine.seek(0)
    expect(engine.getSnapshot()[finalCopy.id]!.x).toBeCloseTo(expected[2]!, 8)
    expect(project.getSequenceTimeMap().duration).toBe(8)
    api.doc.destroy()
  })

  it('continues looped and trimmed media, text effects, shaders and camera cuts', () => {
    const { api, root, project, source } = fixture()
    const videoId = api.createNode('video', root, { name: 'Video', duration: 10, startTime: 1, trimStart: 2, trimEnd: 6, playbackRate: 2, loop: true, clipToRange: true })
    const textId = api.createNode('text', root, { name: 'Text', text: 'Hello', textAnimation: { ...DEFAULT_TEXT_ANIMATION, startTime: 1 } })
    const shaderId = api.createNode('shader', root, { name: 'Shader', speed: 1.2 })
    const camera = api.createNode('camera', null, { name: 'Close up' })
    project.reconcileSceneCameras(source.id)
    project.upsertCameraCut(source.id, { id: 'close', cameraId: camera, time: 2 })
    project.upsertCameraCut(source.id, { id: 'wide', cameraId: source.cameraIds[0]!, time: 6 })
    const split = project.splitScene(source.id, 3)!
    const children = api.getChildren(split.after.rootNodeId)
    const copyVideo = children.find((node) => node.name === 'Video')!
    const originalVideo = api.getNode(videoId)!
    if (copyVideo.kind !== 'video' || originalVideo.kind !== 'video') throw new Error('Expected videos')
    expect(copyVideo.startTime).toBe(-2)
    for (const time of [0, 0.5, 2, 4]) {
      expect(resolvePreviewAudioClock({ ...copyVideo, timelineTime: time })).toEqual(resolvePreviewAudioClock({ ...originalVideo, timelineTime: time + 3 }))
      expect(videoVisibleAtTime(copyVideo, time)).toBe(videoVisibleAtTime(originalVideo, time + 3))
    }
    expect(children.find((node) => node.name === 'Text')).toMatchObject({ textAnimation: { startTime: -2 } })
    expect(api.getNode(textId)).toMatchObject({ textAnimation: { startTime: 1 } })
    const shader = api.getNode(shaderId)!
    const copyShader = children.find((node) => node.kind === 'shader')!
    if (shader.kind !== 'shader' || copyShader.kind !== 'shader') throw new Error('Expected shaders')
    expect(paperShaderFrame(copyShader, 1)).toBe(paperShaderFrame(shader, 4))
    expect(api.getNode(split.after.defaultCameraId!)?.name).toBe('Close up')
    expect(Object.values(split.before.cameraCuts)).toHaveLength(1)
    const program = resolveProgramCamera({ scene: split.after, localTime: 3, cameras: split.after.cameraIds.map((id) => ({ id })) })
    expect(api.getNode(program.cameraId!)?.name).toBe(api.getNode(source.cameraIds[0]!)?.name)
    api.doc.destroy()
  })

  it('preserves repeated occurrence trims, work areas, speed, skip and outgoing transitions', () => {
    const { api, project, source, item } = fixture()
    project.setSceneWorkArea(source.id, { start: 1, end: 7 })
    project.updateSequenceItem(item.id, { playbackRate: 2, masterAudioMuted: true, holdDuration: 1, transitionOut: { kind: 'crossfade', duration: 0.5 } })
    project.createScene({ name: 'Next', duration: 4 })
    const repeated = project.addSequenceItem(source.id)
    project.updateSequenceItem(repeated.id, { trimStart: 5, duration: 1, skipped: true })
    const duration = project.getSequenceTimeMap().duration
    const split = project.splitScene(source.id, 3, item.id)!
    expect(project.getSequenceTimeMap().duration).toBe(duration)
    const items = project.getSequenceItems()
    expect(items[0]).toMatchObject({ sceneId: source.id, trimStart: 1, duration: 2, playbackRate: 2, masterAudioMuted: true, transitionOut: { kind: 'cut' } })
    expect(items[0]!.holdDuration ?? 0).toBe(0)
    expect(items[1]).toMatchObject({ sceneId: split.after.id, trimStart: 0, duration: 4, playbackRate: 2, holdDuration: 1, masterAudioMuted: true, transitionOut: { kind: 'crossfade', duration: 0.5 } })
    expect(items.at(-1)).toMatchObject({ id: repeated.id, sceneId: split.after.id, trimStart: 2, duration: 1, skipped: true })
    api.doc.destroy()
  })

  it('undoes atomically and persists the independent halves', () => {
    const { api, root, project, source } = fixture()
    api.createNode('rect', root, { name: 'Card' })
    const before = snapshotScene(api)
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    const split = project.splitScene(source.id, 3)!
    expect(undo.undoStack).toHaveLength(1)
    undo.undo()
    expect(snapshotScene(api)).toEqual(before)
    undo.redo()
    expect(project.getScenes()).toHaveLength(2)
    const reopened = readScene(sceneToBytes(api.doc))
    const loaded = createProjectAPI(reopened.api)
    expect(loaded.getScene(split.after.id)?.duration).toBe(5)
    expect(loaded.getSequenceTimeMap().duration).toBe(8)
    reopened.doc.destroy()
    undo.destroy()
    api.doc.destroy()
  })

  it('rejects scene endpoints and invalid times without changing the document', () => {
    const { api, project, source } = fixture()
    const before = snapshotScene(api)
    for (const time of [0, 8, -1, 9, NaN, Infinity]) expect(project.splitScene(source.id, time)).toBeNull()
    expect(project.splitScene('missing', 2)).toBeNull()
    expect(snapshotScene(api)).toEqual(before)
    expect(sceneSplitTime(8, 1.004, 60)).toBe(1)
    api.doc.destroy()
  })
})

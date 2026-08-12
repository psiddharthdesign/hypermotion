// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { buildSceneBytes, type SceneJson } from '../scene/build.js'
import { assertToolText } from '../testUtils/mcp.js'
import {
  getSequenceTool,
  handleGetSequence,
  handleListScenes,
  listScenesTool,
} from './tools/querySequence.js'

type ToolSchemaProperty = {
  readonly type?: string
  readonly minLength?: number
  readonly pattern?: string
  readonly description?: string
} | undefined

function inputProperty(
  tool: Pick<Tool, 'inputSchema'>,
  name: string,
): ToolSchemaProperty {
  const value = tool.inputSchema.properties?.[name]
  assert.ok(
    value === undefined ||
      (typeof value === 'object' && !Array.isArray(value)),
  )
  return value as ToolSchemaProperty
}

function multiSceneFixture(): SceneJson {
  return {
    meta: {
      name: 'Explainer',
      frameRate: 60,
      canvas: { width: 1920, height: 1080 },
    },
    nodes: {
      introRoot: {
        id: 'introRoot',
        kind: 'frame',
        parent: null,
        children: [],
        size: { width: 1920, height: 1080 },
        layout: { mode: 'none' },
      },
      detailRoot: {
        id: 'detailRoot',
        kind: 'frame',
        parent: null,
        children: [],
        size: { width: 1920, height: 1080 },
        layout: { mode: 'none' },
      },
      wide: {
        id: 'wide',
        kind: 'camera',
        parent: null,
      },
      close: {
        id: 'close',
        kind: 'camera',
        parent: null,
      },
      detail: {
        id: 'detail',
        kind: 'camera',
        parent: null,
      },
    },
    compositionScenes: {
      intro: {
        id: 'intro',
        name: 'Intro',
        rootNodeId: 'introRoot',
        duration: 4,
        workArea: { start: 0.5, end: 3.5 },
        cameraIds: ['wide', 'close'],
        defaultCameraId: 'wide',
        cameraCuts: {
          late: { id: 'late', cameraId: 'wide', time: 2 },
          alpha: { id: 'alpha', cameraId: 'close', time: 1 },
          beta: { id: 'beta', cameraId: 'wide', time: 1 },
        },
      },
      detail: {
        id: 'detail',
        name: 'Detail',
        rootNodeId: 'detailRoot',
        duration: 3,
        cameraIds: ['detail'],
        defaultCameraId: 'detail',
        cameraCuts: {},
      },
    },
    sequenceItems: {
      introItem: {
        id: 'introItem',
        sceneId: 'intro',
        transitionOut: { kind: 'crossfade', duration: 0.5 },
      },
      detailItem: {
        id: 'detailItem',
        sceneId: 'detail',
        masterAudioMuted: true,
        transitionOut: { kind: 'cut', duration: 0 },
      },
    },
    sequenceOrder: ['introItem', 'detailItem'],
    activeCompositionId: 'intro',
  }
}

function writeFixture(scene: SceneJson): {
  directory: string
  scenePath: string
} {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hypermotion-sequence-query-'),
  )
  const scenePath = path.join(directory, 'sequence.hype')
  fs.writeFileSync(scenePath, buildSceneBytes(scene))
  return { directory, scenePath }
}

test('sequence query tool schemas require one scene path', () => {
  for (const tool of [listScenesTool, getSequenceTool]) {
    const scene = inputProperty(tool, 'scene')
    assert.equal(scene?.type, 'string')
    assert.equal(scene?.minLength, 1)
    assert.equal(scene?.pattern, '\\S')
    assert.equal(
      scene?.description,
      'Absolute or relative path to a .hype scene file.',
    )
    assert.deepEqual(tool.inputSchema.required, ['scene'])
    assert.equal(tool.inputSchema.additionalProperties, false)
  }
})

test('sequence query handlers reject invalid arguments and missing files', async () => {
  const invalidScenes = await handleListScenes({ scene: 42 })
  const invalidSequence = await handleGetSequence({
    scene: '/tmp/scene.hype',
    extra: true,
  })
  assert.equal(invalidScenes.isError, true)
  assert.match(assertToolText(invalidScenes), /^list_scenes: invalid arguments/)
  assert.equal(invalidSequence.isError, true)
  assert.match(
    assertToolText(invalidSequence),
    /^get_sequence: invalid arguments/,
  )

  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hypermotion-sequence-query-missing-'),
  )
  const missing = path.join(directory, 'missing.hype')
  try {
    const result = await handleGetSequence({ scene: missing })
    assert.equal(result.isError, true)
    assert.equal(
      assertToolText(result),
      `get_sequence: scene file not found: ${missing}`,
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('list_scenes returns ordered compositions, occurrences, cameras, and sorted cuts', async () => {
  const fixture = writeFixture(multiSceneFixture())
  try {
    const result = await handleListScenes({ scene: fixture.scenePath })
    assert.equal(result.isError, undefined)
    const payload = JSON.parse(assertToolText(result)) as {
      legacy: boolean
      schemaVersion: number
      activeCompositionId: string
      scenes: Array<{
        id: string
        duration: number
        workArea: { start: number; end: number } | null
        cameraCount: number
        cameraCutCount: number
        cameraCuts: Array<{ id: string; time: number }>
        sequenceItemIds: string[]
        occurrenceCount: number
      }>
      issues: unknown[]
    }

    assert.equal(payload.legacy, false)
    assert.equal(payload.schemaVersion, 2)
    assert.equal(payload.activeCompositionId, 'intro')
    assert.deepEqual(
      payload.scenes.map((scene) => scene.id),
      ['intro', 'detail'],
    )
    assert.equal(payload.scenes[0]?.duration, 4)
    assert.deepEqual(payload.scenes[0]?.workArea, {
      start: 0.5,
      end: 3.5,
    })
    assert.equal(payload.scenes[0]?.cameraCount, 2)
    assert.equal(payload.scenes[0]?.cameraCutCount, 3)
    assert.deepEqual(
      payload.scenes[0]?.cameraCuts.map((cut) => cut.id),
      ['alpha', 'beta', 'late'],
    )
    assert.deepEqual(payload.scenes[0]?.sequenceItemIds, ['introItem'])
    assert.equal(payload.scenes[0]?.occurrenceCount, 1)
    assert.deepEqual(payload.issues, [])
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true })
  }
})

test('get_sequence resolves crossfades and master duration on frame boundaries', async () => {
  const fixture = writeFixture(multiSceneFixture())
  try {
    const result = await handleGetSequence({ scene: fixture.scenePath })
    assert.equal(result.isError, undefined)
    const payload = JSON.parse(assertToolText(result)) as {
      frameRate: number
      masterDuration: number
      masterDurationFrames: number
      items: Array<{
        id: string
        masterAudioMuted: boolean
        masterStart: number
        masterEnd: number
        transitionIn: number
        transitionOut: number
      }>
      transitions: Array<{
        kind: string
        fromItemId: string
        toItemId: string
        duration: number
        start: number
        end: number
      }>
      issues: unknown[]
    }

    assert.equal(payload.frameRate, 60)
    assert.equal(payload.masterDuration, 5.5)
    assert.equal(payload.masterDurationFrames, 330)
    assert.deepEqual(payload.items, [
      {
        id: 'introItem',
        sceneId: 'intro',
        sceneName: 'Intro',
        masterAudioMuted: false,
        sourceIndex: 0,
        sequenceIndex: 0,
        sourceStart: 0.5,
        sourceEnd: 3.5,
        sourceDuration: 3,
        sourceDurationFrames: 180,
        holdDuration: 0,
        holdDurationFrames: 0,
        duration: 3,
        durationFrames: 180,
        masterStart: 0,
        masterEnd: 3,
        masterStartFrame: 0,
        masterEndFrame: 180,
        transitionIn: 0,
        transitionOut: 0.5,
        transitionOutRequest: { kind: 'crossfade', duration: 0.5 },
      },
      {
        id: 'detailItem',
        sceneId: 'detail',
        sceneName: 'Detail',
        masterAudioMuted: true,
        sourceIndex: 1,
        sequenceIndex: 1,
        sourceStart: 0,
        sourceEnd: 3,
        sourceDuration: 3,
        sourceDurationFrames: 180,
        holdDuration: 0,
        holdDurationFrames: 0,
        duration: 3,
        durationFrames: 180,
        masterStart: 2.5,
        masterEnd: 5.5,
        masterStartFrame: 150,
        masterEndFrame: 330,
        transitionIn: 0.5,
        transitionOut: 0,
        transitionOutRequest: { kind: 'cut', duration: 0 },
      },
    ])
    assert.deepEqual(payload.transitions, [
      {
        kind: 'crossfade',
        fromItemId: 'introItem',
        toItemId: 'detailItem',
        duration: 0.5,
        durationFrames: 30,
        start: 2.5,
        end: 3,
        startFrame: 150,
        endFrame: 180,
      },
    ])
    assert.deepEqual(payload.issues, [])
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true })
  }
})

test('get_sequence includes trailing hold frames without extending the source range', async () => {
  const scene = multiSceneFixture()
  const detailItem = scene.sequenceItems?.detailItem
  if (!detailItem) throw new Error('missing detail sequence item')
  detailItem.holdDuration = 2.25
  const fixture = writeFixture(scene)
  try {
    const result = await handleGetSequence({ scene: fixture.scenePath })
    assert.equal(result.isError, undefined)
    const payload = JSON.parse(assertToolText(result)) as {
      masterDuration: number
      masterDurationFrames: number
      items: Array<{
        id: string
        sourceStart: number
        sourceEnd: number
        sourceDuration: number
        sourceDurationFrames: number
        holdDuration: number
        holdDurationFrames: number
        duration: number
        durationFrames: number
        masterStart: number
        masterEnd: number
      }>
      issues: unknown[]
    }

    assert.equal(payload.masterDuration, 7.75)
    assert.equal(payload.masterDurationFrames, 465)
    assert.deepEqual(
      payload.items.find((item) => item.id === 'detailItem'),
      {
        id: 'detailItem',
        sceneId: 'detail',
        sceneName: 'Detail',
        masterAudioMuted: true,
        sourceIndex: 1,
        sequenceIndex: 1,
        sourceStart: 0,
        sourceEnd: 3,
        sourceDuration: 3,
        sourceDurationFrames: 180,
        holdDuration: 2.25,
        holdDurationFrames: 135,
        duration: 5.25,
        durationFrames: 315,
        masterStart: 2.5,
        masterEnd: 7.75,
        masterStartFrame: 150,
        masterEndFrame: 465,
        transitionIn: 0.5,
        transitionOut: 0,
        transitionOutRequest: { kind: 'cut', duration: 0 },
      },
    )
    assert.deepEqual(payload.issues, [])
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true })
  }
})

test('sequence queries synthesize one composition and item for legacy files', async () => {
  const fixture = writeFixture({
    meta: {
      name: 'Legacy',
      duration: 2.5,
      frameRate: 30,
      canvas: { width: 640, height: 360 },
    },
    nodes: {
      root: {
        id: 'root',
        kind: 'frame',
        parent: null,
        children: [],
        size: { width: 640, height: 360 },
        layout: { mode: 'none' },
      },
      camera: {
        id: 'camera',
        kind: 'camera',
        parent: null,
      },
    },
  })
  try {
    const scenesResult = await handleListScenes({ scene: fixture.scenePath })
    const sequenceResult = await handleGetSequence({
      scene: fixture.scenePath,
    })
    const scenes = JSON.parse(assertToolText(scenesResult)) as {
      legacy: boolean
      schemaVersion: null
      scenes: Array<{ id: string; cameraIds: string[] }>
    }
    const sequence = JSON.parse(assertToolText(sequenceResult)) as {
      legacy: boolean
      masterDuration: number
      items: Array<{ id: string; sceneId: string }>
    }

    assert.equal(scenes.legacy, true)
    assert.equal(scenes.schemaVersion, null)
    assert.deepEqual(scenes.scenes, [
      {
        id: 'legacy-scene',
        name: 'Legacy',
        rootNodeId: 'root',
        duration: 2.5,
        workArea: null,
        cameraIds: ['camera'],
        defaultCameraId: 'camera',
        cameraCount: 1,
        cameraCutCount: 0,
        cameraCuts: [],
        sequenceItemIds: ['legacy-item'],
        occurrenceCount: 1,
      },
    ])
    assert.equal(sequence.legacy, true)
    assert.equal(sequence.masterDuration, 2.5)
    assert.equal(sequence.items[0]?.id, 'legacy-item')
    assert.equal(sequence.items[0]?.sceneId, 'legacy-scene')
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true })
  }
})

// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'
import {
  buildSceneBytes,
  readSceneSummary,
  type SceneJson,
} from './build.js'

function sampleScene(): SceneJson {
  return {
    meta: {
      name: 'Smoke test',
      duration: 2.5,
      frameRate: 60,
      canvas: { width: 1280, height: 720 },
    },
    nodes: {
      root: {
        id: 'root',
        kind: 'frame',
        parent: null,
        children: ['title'],
        size: { width: 1280, height: 720 },
        layout: {
          mode: 'flex',
          direction: 'column',
          justify: 'center',
          align: 'center',
          padding: { top: 24 },
        },
        appearance: {
          fill: { kind: 'solid', color: '#f4f4f5' },
        },
      },
      title: {
        id: 'title',
        kind: 'text',
        parent: 'root',
        text: 'Hello, tests',
        fontSize: 48,
      },
      camera: {
        id: 'camera',
        kind: 'camera',
        parent: null,
        transform: {
          x: 640,
          y: 360,
          z: 0,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
        },
      },
    },
    tracks: {
      'fade-title': {
        id: 'fade-title',
        nodeId: 'title',
        propertyId: 'appearance.opacity',
        defaultEasing: 'ease-out',
        keyframes: [
          { id: 'k1', time: 0, value: 0 },
          { id: 'k2', time: 0.5, value: 1 },
        ],
      },
    },
    sections: {
      intro: {
        id: 'intro',
        name: 'Intro',
        color: '#2563eb',
        start: 0,
        end: 2.5,
      },
    },
  }
}

test('buildSceneBytes creates a readable .hype summary', () => {
  const bytes = buildSceneBytes(sampleScene())
  const summary = readSceneSummary(bytes)

  assert.equal(summary.meta.name, 'Smoke test')
  assert.deepEqual(summary.meta.canvas, { width: 1280, height: 720 })
  assert.equal(summary.root, 'root')
  assert.equal(summary.activeCameraId, 'camera')
  assert.equal(summary.layerCount, 3)
  assert.equal(summary.trackCount, 1)
  assert.equal(summary.sectionCount, 1)
  assert.equal(summary.keyframeCount, 2)
})

test('buildSceneBytes fills nested defaults expected by the desktop app', () => {
  const data = inspectScene(buildSceneBytes(sampleScene()))
  const nodes = data.nodes as Record<string, Record<string, unknown>>
  const root = nodes.root

  assert.deepEqual(root.layout, {
    mode: 'flex',
    direction: 'column',
    justify: 'center',
    align: 'center',
    gap: 0,
    padding: { top: 24, right: 0, bottom: 0, left: 0 },
    wrap: false,
    columns: 1,
    rowGap: 0,
    columnGap: 0,
  })
  assert.deepEqual(root.appearance, {
    opacity: 1,
    fill: { kind: 'solid', color: '#f4f4f5' },
    stroke: null,
    cornerRadius: 0,
    effects: [],
  })
})

test('buildSceneBytes preserves children as editor-reorderable arrays', () => {
  const data = inspectScene(buildSceneBytes(sampleScene()))
  const nodes = data.nodes as Record<string, Record<string, unknown>>

  assert.deepEqual(nodes.root.children, ['title'])
  assert.equal(nodes.title.parent, 'root')
})

test('buildSceneBytes infers root and active camera ids', () => {
  const scene = sampleScene()
  delete scene.root
  delete scene.activeCameraId

  const summary = readSceneSummary(buildSceneBytes(scene))

  assert.equal(summary.root, 'root')
  assert.equal(summary.activeCameraId, 'camera')
})

function inspectScene(bytes: Uint8Array): Record<string, unknown> {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, bytes)
  return yToPlain(doc.getMap<unknown>('scene')) as Record<string, unknown>
}

function yToPlain(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const out: Record<string, unknown> = {}
    for (const [key, child] of value.entries()) out[key] = yToPlain(child)
    return out
  }
  if (value instanceof Y.Array) return value.toArray().map(yToPlain)
  return value
}

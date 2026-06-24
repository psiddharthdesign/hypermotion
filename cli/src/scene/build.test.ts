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

test('buildSceneBytes preserves explicit transform anchor and 3D mode fields', () => {
  const scene = sampleScene()
  const root = scene.nodes?.root
  if (!root) throw new Error('missing sample root')
  root.transform = {
    x: 0,
    y: 0,
    z: 12,
    rotation: 0,
    rotationX: 8,
    rotationY: -12,
    scaleX: 1,
    scaleY: 1,
    anchorX: 0,
    anchorY: 1,
    anchorZ: 6,
    space: 'world',
    renderMode: 'plane',
  }

  const data = inspectScene(buildSceneBytes(scene))
  const nodes = data.nodes as Record<string, Record<string, unknown>>
  const transform = nodes.root.transform as Record<string, unknown>

  assert.equal(transform.anchorX, 0)
  assert.equal(transform.anchorY, 1)
  assert.equal(transform.anchorZ, 6)
  assert.equal(transform.space, 'world')
  assert.equal(transform.renderMode, 'plane')
})

test('buildSceneBytes preserves children as editor-reorderable arrays', () => {
  const data = inspectScene(buildSceneBytes(sampleScene()))
  const nodes = data.nodes as Record<string, Record<string, unknown>>

  assert.deepEqual(nodes.root.children, ['title'])
  assert.equal(nodes.title.parent, 'root')
})

test('buildSceneBytes keys nodes by their declared ids', () => {
  const scene = sampleScene()
  const sceneNodes = scene.nodes ?? {}
  scene.nodes = {
    artboard: sceneNodes.root,
    headline: sceneNodes.title,
    viewport: sceneNodes.camera,
  }

  const data = inspectScene(buildSceneBytes(scene))
  const nodes = data.nodes as Record<string, Record<string, unknown>>

  assert.deepEqual(Object.keys(nodes).sort(), ['camera', 'root', 'title'])
  assert.equal(nodes.root.id, 'root')
  assert.equal(data.root, 'root')
  assert.equal(data.activeCameraId, 'camera')
})

test('buildSceneBytes keys tracks by their declared ids', () => {
  const scene = sampleScene()
  const sceneTracks = scene.tracks ?? {}
  scene.tracks = {
    alias: sceneTracks['fade-title'],
  }

  const data = inspectScene(buildSceneBytes(scene))
  const tracks = data.tracks as Record<string, Record<string, unknown>>

  assert.deepEqual(Object.keys(tracks), ['fade-title'])
  assert.equal(tracks['fade-title'].id, 'fade-title')
})

test('buildSceneBytes keys sections by their declared ids', () => {
  const scene = sampleScene()
  const sceneSections = scene.sections ?? {}
  scene.sections = {
    alias: sceneSections.intro,
  }

  const data = inspectScene(buildSceneBytes(scene))
  const sections = data.sections as Record<string, Record<string, unknown>>

  assert.deepEqual(Object.keys(sections), ['intro'])
  assert.equal(sections.intro.id, 'intro')
})

test('buildSceneBytes seeds an empty uiState map for editor compatibility', () => {
  const data = inspectScene(buildSceneBytes(sampleScene()))

  assert.deepEqual(data.uiState, {})
})

test('buildSceneBytes writes explicit component metadata defaults', () => {
  const scene = sampleScene()
  scene.nodes = {
    component: {
      id: 'component',
      kind: 'component',
      parent: null,
      children: [],
      size: { width: 320, height: 180 },
      layout: { mode: 'none' },
    },
  }

  const data = inspectScene(buildSceneBytes(scene))
  const nodes = data.nodes as Record<string, Record<string, unknown>>
  const component = nodes.component

  assert.equal(component.workspaceOnly, false)
  assert.deepEqual(component.variantPositions, {})
  assert.deepEqual(component.componentProperties, [])
})

test('buildSceneBytes centers camera focus defaults on the canvas', () => {
  const data = inspectScene(buildSceneBytes(sampleScene()))
  const nodes = data.nodes as Record<string, Record<string, unknown>>
  const camera = nodes.camera

  assert.equal(camera.focusX, 640)
  assert.equal(camera.focusY, 360)
  assert.equal(camera.focusWorldX, 640)
  assert.equal(camera.focusWorldY, 360)
  assert.equal(camera.focusWorldZ, 0)
})

test('buildSceneBytes respects explicit root and active camera ids', () => {
  const scene = sampleScene()
  scene.nodes = {
    ...scene.nodes,
    overlay: {
      id: 'overlay',
      kind: 'frame',
      parent: null,
      children: [],
      size: { width: 320, height: 180 },
      layout: { mode: 'none' },
    },
    sideCamera: {
      id: 'sideCamera',
      kind: 'camera',
      parent: null,
      transform: {
        x: 320,
        y: 180,
        z: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
      },
    },
  }
  scene.root = 'overlay'
  scene.activeCameraId = 'sideCamera'

  const data = inspectScene(buildSceneBytes(scene))

  assert.equal(data.root, 'overlay')
  assert.equal(data.activeCameraId, 'sideCamera')
})

test('readSceneSummary counts keyframes stored as Y.Array values', () => {
  const doc = new Y.Doc()
  const scene = doc.getMap<unknown>('scene')
  scene.set('meta', new Y.Map<unknown>())
  scene.set('nodes', new Y.Map<Y.Map<unknown>>())
  scene.set('sections', new Y.Map<unknown>())

  const tracks = new Y.Map<Y.Map<unknown>>()
  const track = new Y.Map<unknown>()
  const keyframes = new Y.Array<unknown>()
  keyframes.push([
    { id: 'k1', time: 0, value: 0 },
    { id: 'k2', time: 1, value: 1 },
  ])
  track.set('keyframes', keyframes)
  tracks.set('fade', track)
  scene.set('tracks', tracks)

  const summary = readSceneSummary(Y.encodeStateAsUpdate(doc))

  assert.equal(summary.keyframeCount, 2)
})

test('readSceneSummary counts keyframes stored as plain array values', () => {
  const bytes = buildSceneBytes(sampleScene())
  const summary = readSceneSummary(bytes)

  assert.equal(summary.keyframeCount, 2)
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

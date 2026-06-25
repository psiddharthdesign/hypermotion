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
  assert.deepEqual(nodes.title.size, { width: 'hug', height: 'hug' })
  assert.equal(nodes.title.fontFamily, 'Inter')
  assert.equal(nodes.title.fontWeight, 400)
  assert.equal(nodes.title.lineHeight, 1.4)
  assert.equal(nodes.title.letterSpacing, 0)
  assert.equal(nodes.title.textAlign, 'start')
  assert.equal(nodes.title.color, '#0a0a0c')
})

test('buildSceneBytes gives each node independent nested defaults', () => {
  const scene = sampleScene()
  scene.nodes = {
    first: {
      id: 'first',
      kind: 'frame',
      parent: null,
      children: [],
      size: { width: 100, height: 100 },
      layout: { mode: 'none', padding: { top: 8 } },
    },
    second: {
      id: 'second',
      kind: 'frame',
      parent: null,
      children: [],
      size: { width: 100, height: 100 },
      layout: { mode: 'none' },
    },
  }

  const data = inspectScene(buildSceneBytes(scene))
  const nodes = data.nodes as Record<string, Record<string, unknown>>
  const firstLayout = nodes.first.layout as Record<string, unknown>
  const secondLayout = nodes.second.layout as Record<string, unknown>

  assert.deepEqual(firstLayout.padding, { top: 8, right: 0, bottom: 0, left: 0 })
  assert.deepEqual(secondLayout.padding, { top: 0, right: 0, bottom: 0, left: 0 })
})

test('buildSceneBytes preserves per-corner radii in appearance', () => {
  const scene = sampleScene()
  const root = scene.nodes?.root
  if (!root) throw new Error('missing sample root')
  root.appearance = {
    cornerRadius: 8,
    cornerRadii: { tl: 4, tr: 8, br: 12, bl: 16 },
  }

  const data = inspectScene(buildSceneBytes(scene))
  const nodes = data.nodes as Record<string, Record<string, unknown>>
  const appearance = nodes.root.appearance as Record<string, unknown>

  assert.equal(appearance.cornerRadius, 8)
  assert.deepEqual(appearance.cornerRadii, { tl: 4, tr: 8, br: 12, bl: 16 })
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

test('buildSceneBytes preserves image import warnings', () => {
  const scene = sampleScene()
  scene.nodes = {
    image: {
      id: 'image',
      kind: 'image',
      parent: null,
      children: [],
      size: { width: 320, height: 180 },
      src: '/tmp/source.png',
      fit: 'contain',
      importWarning: 'Vector fallback was preserved as a bitmap.',
    },
  }

  const data = inspectScene(buildSceneBytes(scene))
  const nodes = data.nodes as Record<string, Record<string, unknown>>

  assert.equal(nodes.image.fit, 'contain')
  assert.equal(
    nodes.image.importWarning,
    'Vector fallback was preserved as a bitmap.',
  )
})

test('buildSceneBytes writes text defaults expected by the desktop app', () => {
  const scene = sampleScene()
  scene.nodes = {
    title: {
      id: 'title',
      kind: 'text',
      parent: null,
      text: 'Default text',
    },
  }

  const data = inspectScene(buildSceneBytes(scene))
  const nodes = data.nodes as Record<string, Record<string, unknown>>
  const text = nodes.title

  assert.deepEqual(text.size, { width: 'hug', height: 'hug' })
  assert.equal(text.fontFamily, 'Inter')
  assert.equal(text.fontSize, 16)
  assert.equal(text.fontWeight, 400)
  assert.equal(text.lineHeight, 1.4)
  assert.equal(text.letterSpacing, 0)
  assert.equal(text.textAlign, 'start')
  assert.equal(text.color, '#0a0a0c')
})

test('buildSceneBytes fills omitted text size axes', () => {
  const scene = sampleScene()
  scene.nodes = {
    title: {
      id: 'title',
      kind: 'text',
      parent: null,
      text: 'Sized text',
      size: { width: 320 },
    },
  }

  const data = inspectScene(buildSceneBytes(scene))
  const nodes = data.nodes as Record<string, Record<string, unknown>>

  assert.deepEqual(nodes.title.size, { width: 320, height: 'hug' })
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

test('buildSceneBytes defaults omitted track keyframes to empty', () => {
  const scene = sampleScene()
  scene.tracks = {
    'fade-title': {
      id: 'fade-title',
      nodeId: 'title',
      propertyId: 'appearance.opacity',
    },
  }

  const data = inspectScene(buildSceneBytes(scene))
  const tracks = data.tracks as Record<string, Record<string, unknown>>
  const summary = readSceneSummary(buildSceneBytes(scene))

  assert.deepEqual(tracks['fade-title'].keyframes, [])
  assert.equal(summary.keyframeCount, 0)
})

test('buildSceneBytes preserves variant selection keyframe values', () => {
  const scene = sampleScene()
  scene.tracks = {
    variant: {
      id: 'variant',
      nodeId: 'title',
      propertyId: 'variant',
      keyframes: [
        { id: 'k1', time: 0, value: { size: 'compact', tone: 'muted' } },
      ],
    },
  }

  const data = inspectScene(buildSceneBytes(scene))
  const tracks = data.tracks as Record<string, Record<string, unknown>>
  const variantTrack = tracks.variant
  const keyframes = variantTrack.keyframes as Array<Record<string, unknown>>

  assert.deepEqual(keyframes[0].value, { size: 'compact', tone: 'muted' })
})

test('buildSceneBytes accepts non-string variant keyframe fields', () => {
  const scene = sampleScene()
  scene.tracks = {
    variant: {
      id: 'variant',
      nodeId: 'title',
      propertyId: 'variant',
      keyframes: [
        { id: 'k1', time: 0, value: { enabled: true, columns: 3 } },
      ],
    },
  }

  const data = inspectScene(buildSceneBytes(scene))
  const tracks = data.tracks as Record<string, Record<string, unknown>>
  const keyframes = tracks.variant.keyframes as Array<Record<string, unknown>>

  assert.deepEqual(keyframes[0].value, { enabled: true, columns: 3 })
})

test('buildSceneBytes accepts transform anchor keyframes', () => {
  const scene = sampleScene()
  scene.tracks = {
    anchor: {
      id: 'anchor',
      nodeId: 'title',
      propertyId: 'transform.anchorX',
      keyframes: [
        { id: 'k1', time: 0, value: 0.5 },
        { id: 'k2', time: 1, value: 0 },
      ],
    },
  }

  const data = inspectScene(buildSceneBytes(scene))
  const tracks = data.tracks as Record<string, Record<string, unknown>>

  assert.equal(tracks.anchor.propertyId, 'transform.anchorX')
  assert.equal(readSceneSummary(buildSceneBytes(scene)).keyframeCount, 2)
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

test('buildSceneBytes preserves frame editor metadata', () => {
  const scene = sampleScene()
  const root = scene.nodes?.root
  if (!root) throw new Error('missing sample root')
  root.clipsContent = false
  root.layoutGuides = [
    { id: 'guide-1', axis: 'x', position: 320 },
  ]

  const data = inspectScene(buildSceneBytes(scene))
  const nodes = data.nodes as Record<string, Record<string, unknown>>
  const rootNode = nodes.root

  assert.equal(rootNode.clipsContent, false)
  assert.deepEqual(rootNode.layoutGuides, [
    { id: 'guide-1', axis: 'x', position: 320 },
  ])
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

test('buildSceneBytes writes explicit instance metadata defaults', () => {
  const scene = sampleScene()
  scene.nodes = {
    instance: {
      id: 'instance',
      kind: 'instance',
      parent: null,
      children: [],
      size: { width: 320, height: 180 },
      componentId: 'component',
    },
  }

  const data = inspectScene(buildSceneBytes(scene))
  const nodes = data.nodes as Record<string, Record<string, unknown>>
  const instance = nodes.instance

  assert.equal(instance.componentId, 'component')
  assert.deepEqual(instance.layout, {
    mode: 'none',
    direction: 'column',
    justify: 'start',
    align: 'start',
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    wrap: false,
    columns: 1,
    rowGap: 0,
    columnGap: 0,
  })
  assert.deepEqual(instance.selection, {})
  assert.deepEqual(instance.overrides, {})
  assert.deepEqual(instance.interactions, [])
})

test('buildSceneBytes writes media timing defaults', () => {
  const scene = sampleScene()
  scene.nodes = {
    narration: {
      id: 'narration',
      kind: 'audio',
      parent: null,
      children: [],
      src: '/tmp/narration.wav',
    },
    clip: {
      id: 'clip',
      kind: 'video',
      parent: null,
      children: [],
      src: '/tmp/clip.mp4',
      duration: 3,
    },
  }

  const data = inspectScene(buildSceneBytes(scene))
  const nodes = data.nodes as Record<string, Record<string, unknown>>

  assert.deepEqual(nodes.narration.size, { width: 120, height: 40 })
  assert.equal(nodes.narration.duration, 0)
  assert.equal(nodes.narration.volume, 1)
  assert.equal(nodes.narration.trimEnd, 0)
  assert.equal(nodes.narration.muted, false)
  assert.deepEqual(nodes.clip.size, { width: 100, height: 100 })
  assert.equal(nodes.clip.trimEnd, 3)
  assert.equal(nodes.clip.fit, 'cover')
  assert.equal(nodes.clip.muted, true)
})

test('buildSceneBytes fills omitted media size axes', () => {
  const scene = sampleScene()
  scene.nodes = {
    clip: {
      id: 'clip',
      kind: 'video',
      parent: null,
      children: [],
      src: '/tmp/clip.mp4',
      size: { width: 640 },
    },
  }

  const data = inspectScene(buildSceneBytes(scene))
  const nodes = data.nodes as Record<string, Record<string, unknown>>

  assert.deepEqual(nodes.clip.size, { width: 640, height: 100 })
})

test('buildSceneBytes preserves explicit media timing fields', () => {
  const scene = sampleScene()
  scene.nodes = {
    clip: {
      id: 'clip',
      kind: 'video',
      parent: null,
      children: [],
      src: '/tmp/clip.mp4',
      duration: 5,
      volume: 0.6,
      startTime: 1.25,
      trimStart: 0.5,
      trimEnd: 4,
      loop: true,
      muted: false,
      fit: 'contain',
    },
  }

  const data = inspectScene(buildSceneBytes(scene))
  const nodes = data.nodes as Record<string, Record<string, unknown>>
  const clip = nodes.clip

  assert.equal(clip.duration, 5)
  assert.equal(clip.volume, 0.6)
  assert.equal(clip.startTime, 1.25)
  assert.equal(clip.trimStart, 0.5)
  assert.equal(clip.trimEnd, 4)
  assert.equal(clip.loop, true)
  assert.equal(clip.muted, false)
  assert.equal(clip.fit, 'contain')
})

test('buildSceneBytes centers camera focus defaults on the canvas', () => {
  const data = inspectScene(buildSceneBytes(sampleScene()))
  const nodes = data.nodes as Record<string, Record<string, unknown>>
  const camera = nodes.camera

  assert.equal(camera.projection, '2d')
  assert.equal(camera.enabled, true)
  assert.equal(camera.background, null)
  assert.equal(camera.focusX, 640)
  assert.equal(camera.focusY, 360)
  assert.equal(camera.focusWorldX, 640)
  assert.equal(camera.focusWorldY, 360)
  assert.equal(camera.focusWorldZ, 0)
})

test('buildSceneBytes writes camera lens and depth defaults', () => {
  const data = inspectScene(buildSceneBytes(sampleScene()))
  const nodes = data.nodes as Record<string, Record<string, unknown>>
  const camera = nodes.camera

  assert.equal(camera.focalLength, 1000)
  assert.equal(camera.fieldOfView, 35)
  assert.equal(camera.nearClip, 1)
  assert.equal(camera.farClip, 100000)
  assert.equal(camera.depthOfField, false)
  assert.equal(camera.focusMode, 'screen')
  assert.equal(camera.focusTargetNodeId, null)
  assert.equal(camera.focusDistance, 0)
  assert.equal(camera.focusRadius, 160)
  assert.equal(camera.focusFalloff, 180)
  assert.equal(camera.aperture, 0)
  assert.equal(camera.iso, 100)
  assert.equal(camera.blurLevel, 1)
  assert.equal(camera.blurQuality, 8)
  assert.equal(camera.showFocusPlane, false)
})

test('buildSceneBytes derives camera point of interest x/y from transform', () => {
  const scene = sampleScene()
  const camera = scene.nodes?.camera
  if (!camera) throw new Error('missing sample camera')
  camera.transform = {
    x: 480,
    y: 240,
    z: 80,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  }

  const data = inspectScene(buildSceneBytes(scene))
  const nodes = data.nodes as Record<string, Record<string, unknown>>
  const cameraNode = nodes.camera

  assert.equal(cameraNode.pointOfInterestX, 480)
  assert.equal(cameraNode.pointOfInterestY, 240)
  assert.equal(cameraNode.pointOfInterestZ, 0)
})

test('buildSceneBytes preserves perspective camera projection', () => {
  const scene = sampleScene()
  const camera = scene.nodes?.camera
  if (!camera) throw new Error('missing sample camera')
  camera.projection = 'perspective'
  camera.background = { kind: 'solid', color: '#111827' }

  const data = inspectScene(buildSceneBytes(scene))
  const nodes = data.nodes as Record<string, Record<string, unknown>>

  assert.equal(nodes.camera.projection, 'perspective')
  assert.deepEqual(nodes.camera.background, { kind: 'solid', color: '#111827' })
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

test('readSceneSummary treats missing keyframes as empty', () => {
  const doc = new Y.Doc()
  const scene = doc.getMap<unknown>('scene')
  scene.set('meta', new Y.Map<unknown>())
  scene.set('nodes', new Y.Map<Y.Map<unknown>>())
  scene.set('sections', new Y.Map<unknown>())

  const tracks = new Y.Map<Y.Map<unknown>>()
  tracks.set('fade', new Y.Map<unknown>())
  scene.set('tracks', tracks)

  const summary = readSceneSummary(Y.encodeStateAsUpdate(doc))

  assert.equal(summary.trackCount, 1)
  assert.equal(summary.keyframeCount, 0)
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

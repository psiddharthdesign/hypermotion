// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'
import { applyScenePatch, buildSceneBytes, type NodeJson } from './build.js'

function cameraGuide(bytes: Uint8Array, id = 'camera'): unknown {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, bytes)
  const nodes = doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
  return nodes.get(id)?.get('compositionGuide')
}

function build(compositionGuide?: NodeJson['compositionGuide']) {
  return buildSceneBytes({ nodes: {
    root: { id: 'root', kind: 'frame', parent: null, children: [], size: { width: 960, height: 540 } },
    camera: { id: 'camera', kind: 'camera', parent: null, compositionGuide },
  } })
}

test('CLI creates every guide and defaults absent or invalid values to Off', () => {
  for (const guide of ['none', 'thirds', 'center', 'diagonals', 'diamond', 'diamond-grid', 'isometric', 'golden-ratio', 'grid', 'safe-areas'] as const) {
    assert.equal(cameraGuide(build(guide)), guide)
  }
  assert.equal(cameraGuide(build()), 'none')
  assert.equal(cameraGuide(build('future-guide' as NodeJson['compositionGuide'])), 'none')
})

test('CLI preserves and normalizes composition guides when creating and patching cameras', () => {
  const bytes = applyScenePatch(build('diamond'), [
    { op: 'createNode', node: { id: 'copy', kind: 'camera', parent: null, compositionGuide: 'thirds' } },
    { op: 'setNode', nodeId: 'camera', patch: { compositionGuide: 'grid' } },
  ])
  assert.equal(cameraGuide(bytes), 'grid')
  assert.equal(cameraGuide(bytes, 'copy'), 'thirds')
  const patched = applyScenePatch(bytes, [
    { op: 'setNodeProperty', nodeId: 'copy', key: 'compositionGuide', value: 'safe-areas' },
    { op: 'setNode', nodeId: 'camera', patch: { compositionGuide: 'invalid' } },
  ])
  assert.equal(cameraGuide(patched), 'none')
  assert.equal(cameraGuide(patched, 'copy'), 'safe-areas')
})

function cameraProjection(bytes: Uint8Array, id = 'camera'): unknown {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, bytes)
  const nodes = doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
  return nodes.get(id)?.get('projection')
}

test('CLI creates and patches orthographic cameras without losing the lens model', () => {
  const bytes = buildSceneBytes({ nodes: {
    root: { id: 'root', kind: 'frame', parent: null, children: [], size: { width: 960, height: 540 } },
    camera: { id: 'camera', kind: 'camera', parent: null, projection: 'orthographic', compositionGuide: 'isometric' },
  } })
  assert.equal(cameraProjection(bytes), 'orthographic')
  assert.equal(cameraGuide(bytes), 'isometric')
  const copied = applyScenePatch(bytes, [
    { op: 'createNode', node: { id: 'copy', kind: 'camera', parent: null, projection: 'orthographic' } },
    { op: 'setNode', nodeId: 'camera', patch: { projection: 'perspective' } },
  ])
  assert.equal(cameraProjection(copied), 'perspective')
  assert.equal(cameraProjection(copied, 'copy'), 'orthographic')
  const patched = applyScenePatch(copied, [
    { op: 'setNodeProperty', nodeId: 'camera', key: 'projection', value: 'orthographic' },
    { op: 'setNodeProperty', nodeId: 'copy', key: 'projection', value: 'invalid' },
  ])
  assert.equal(cameraProjection(patched), 'orthographic')
  assert.equal(cameraProjection(patched, 'copy'), '2d')
})

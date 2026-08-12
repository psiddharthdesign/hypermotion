// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'
import {
  MAX_LAYER_Z_INDEX,
  MIN_LAYER_Z_INDEX,
  applyScenePatch,
  buildSceneBytes,
  inspectScene,
  validateScene,
  type SceneJson,
} from './build.js'

function scene(zIndex?: number): SceneJson {
  return {
    root: 'root',
    nodes: {
      root: {
        id: 'root',
        kind: 'frame',
        children: ['card'],
        size: { width: 640, height: 360 },
      },
      card: {
        id: 'card',
        kind: 'rect',
        parent: 'root',
        size: { width: 120, height: 80 },
        ...(zIndex === undefined ? {} : { zIndex }),
      },
    },
  }
}

function node(bytes: Uint8Array, id: string): Record<string, unknown> {
  const inspected = inspectScene(bytes)
  return (inspected.nodes as Record<string, Record<string, unknown>>)[id]
}

test('CLI authoring persists a normalized sibling z-index', () => {
  assert.equal(node(buildSceneBytes(scene()), 'card').zIndex, 0)
  assert.equal(node(buildSceneBytes(scene(7.6)), 'card').zIndex, 8)
  assert.equal(
    node(buildSceneBytes(scene(MAX_LAYER_Z_INDEX + 1)), 'card').zIndex,
    MAX_LAYER_Z_INDEX,
  )
  assert.equal(
    node(buildSceneBytes(scene(MIN_LAYER_Z_INDEX - 1)), 'card').zIndex,
    MIN_LAYER_Z_INDEX,
  )
})

test('CLI patches normalize z-index and validation rejects malformed persisted data', () => {
  const source = buildSceneBytes(scene())
  const patched = applyScenePatch(source, [
    { op: 'setNodeProperty', nodeId: 'card', key: 'zIndex', value: -12.6 },
  ])
  assert.equal(node(patched, 'card').zIndex, -13)

  const doc = new Y.Doc()
  Y.applyUpdate(doc, source)
  const sceneMap = doc.getMap<unknown>('scene')
  const nodes = sceneMap.get('nodes') as Y.Map<Y.Map<unknown>>
  nodes.get('card')?.set('zIndex', 20_000)
  const validation = validateScene(Y.encodeStateAsUpdate(doc))
  assert.equal(validation.ok, false)
  assert.ok(
    validation.errors.includes(
      `node card zIndex must be an integer between ${MIN_LAYER_Z_INDEX} and ${MAX_LAYER_Z_INDEX}`,
    ),
  )
})

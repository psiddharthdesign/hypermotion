// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'
import { applyScenePatch, buildSceneBytes, inspectScene, PROPERTY_IDS, validateScene, type FlowConnectionJson, type SceneJson } from './build.js'

const endpoints = { sourceId: 'asset-a', targetId: 'asset-b' }
const defaults = { version: 1, ...endpoints, routing: 'elbow', color: '#2563eb', width: 4, flowEnabled: true, flowColor: '#93c5fd', flowSpeed: 120, flowSpacing: 120, flowSize: 12, flowPhase: 0 }

function fixture(connection: FlowConnectionJson = endpoints): Uint8Array {
  return buildSceneBytes({ root: 'root', nodes: {
    artboardAlias: { id: 'root', kind: 'frame', parent: null, children: ['asset-a', 'asset-b', 'wire'], size: { width: 960, height: 540 } },
    firstAlias: { id: 'asset-a', kind: 'rect', parent: 'root' },
    secondAlias: { id: 'asset-b', kind: 'ellipse', parent: 'root' },
    connectionAlias: { id: 'wire', kind: 'vector', parent: 'root', connection },
  } })
}
function node(bytes: Uint8Array, id = 'wire'): Record<string, unknown> {
  return (inspectScene(bytes).nodes as Record<string, Record<string, unknown>>)[id]!
}

test('CLI creates connection vectors using declared endpoint IDs rather than input record aliases', () => {
  const bytes = fixture()
  assert.deepEqual(node(bytes).connection, defaults)
  assert.equal(node(bytes).kind, 'vector')
  assert.equal(node(bytes).parent, 'root')
  assert.equal(node(bytes).position, 'absolute')
  assert.equal((node(bytes).transform as Record<string, unknown>).renderMode, 'plane')
  assert.deepEqual(node(bytes).size, { width: 1, height: 1 })
  assert.equal((node(bytes).appearance as Record<string, unknown>).fill, null)
  assert.deepEqual(validateScene(bytes).errors, [])
})

test('CLI connection defaults and clamps match desktop authoring', () => {
  const bytes = fixture({ ...endpoints, routing: 'straight', color: '', width: -4, flowEnabled: false, flowColor: '#123456', flowSpeed: -9000, flowSpacing: 9000, flowSize: -10, flowPhase: 8 })
  assert.deepEqual(node(bytes).connection, { ...defaults, routing: 'straight', width: 0.25, flowEnabled: false, flowColor: '#123456', flowSpeed: -2000, flowSpacing: 4000, flowSize: 1, flowPhase: 1 })
  const finite = fixture({ ...endpoints, width: NaN, flowSpeed: Infinity, flowPhase: NaN })
  assert.deepEqual(node(finite).connection, defaults)
})

test('CLI preserves connections and keys through inspection, rebuilding, patching and binary reopening', () => {
  const bytes = applyScenePatch(fixture(), [{ op: 'setTrack', track: {
    id: 'pulse', nodeId: 'wire', propertyId: 'connection.flowPhase', keyframes: [
      { id: 'start', time: 0, value: 0 }, { id: 'end', time: 2, value: 1 },
    ],
  } }])
  const rebuilt = buildSceneBytes(inspectScene(bytes) as SceneJson)
  assert.deepEqual(node(rebuilt).connection, defaults)
  assert.deepEqual(inspectScene(rebuilt).tracks, inspectScene(bytes).tracks)
  const patched = applyScenePatch(rebuilt, [{ op: 'setNodeProperty', nodeId: 'asset-a', key: 'name', value: 'Moved asset' }])
  const doc = new Y.Doc()
  Y.applyUpdate(doc, patched)
  const reopened = Y.encodeStateAsUpdate(doc)
  assert.deepEqual(node(reopened).connection, defaults)
  assert.deepEqual(validateScene(reopened).errors, [])
  doc.destroy()
})

test('CLI patch creation supports connection vectors without enabling arbitrary vector authoring', () => {
  const bytes = applyScenePatch(fixture(), [{ op: 'createNode', node: { id: 'wire-two', kind: 'vector', parent: 'root', connection: { sourceId: 'asset-b', targetId: 'asset-a', routing: 'straight' } } }])
  assert.deepEqual(node(bytes, 'wire-two').connection, { ...defaults, sourceId: 'asset-b', targetId: 'asset-a', routing: 'straight' })
  assert.ok((node(bytes, 'root').children as string[]).includes('wire-two'))
  assert.deepEqual(validateScene(bytes).errors, [])
  assert.throws(() => applyScenePatch(bytes, [{ op: 'createNode', node: { id: 'unconnected', kind: 'vector', parent: 'root' } }]), /unsupported kind: vector/)
  assert.throws(() => fixture({ sourceId: 'asset-a', targetId: 'asset-a' }), /unsupported kind: vector/)
})

test('CLI both patch forms normalize complete connection settings and can clear them', () => {
  let bytes = applyScenePatch(fixture(), [{ op: 'setNode', nodeId: 'wire', patch: { connection: { ...endpoints, width: 9999, flowSpeed: 240, flowPhase: 0.5 } } }])
  assert.deepEqual(node(bytes).connection, { ...defaults, width: 128, flowSpeed: 240, flowPhase: 0.5 })
  bytes = applyScenePatch(bytes, [{ op: 'setNodeProperty', nodeId: 'wire', key: 'connection', value: { ...endpoints, flowSpacing: 1, flowSize: 1000 } }])
  assert.deepEqual(node(bytes).connection, { ...defaults, flowSpacing: 8, flowSize: 128 })
  for (const clear of [{ op: 'setNode', nodeId: 'wire', patch: { connection: null } }, { op: 'setNodeProperty', nodeId: 'wire', key: 'connection', value: null }] as const) {
    assert.equal(node(applyScenePatch(bytes, [clear])).connection, undefined)
  }
})

test('CLI refuses connection data on ordinary shape nodes in create and patch operations', () => {
  let bytes = buildSceneBytes({ nodes: {
    root: { id: 'root', kind: 'frame', children: ['shape'], connection: endpoints },
    shape: { id: 'shape', kind: 'rect', parent: 'root', connection: endpoints },
  } })
  assert.equal(node(bytes, 'root').connection, undefined)
  assert.equal(node(bytes, 'shape').connection, undefined)
  bytes = applyScenePatch(bytes, [
    { op: 'createNode', node: { id: 'ellipse', kind: 'ellipse', parent: 'root', connection: endpoints } },
    { op: 'setNode', nodeId: 'shape', patch: { connection: endpoints } },
    { op: 'setNodeProperty', nodeId: 'root', key: 'connection', value: endpoints },
  ])
  for (const id of ['root', 'shape', 'ellipse']) assert.equal(node(bytes, id).connection, undefined)
})

test('CLI kind changes clear invalid connection data regardless of patch property order', () => {
  for (const patch of [{ kind: 'rect', connection: endpoints }, { connection: endpoints, kind: 'rect' }]) {
    const bytes = applyScenePatch(fixture(), [{ op: 'setNode', nodeId: 'wire', patch }])
    assert.equal(node(bytes).kind, 'rect')
    assert.equal(node(bytes).connection, undefined)
  }
  const bytes = applyScenePatch(fixture(), [{ op: 'setNodeProperty', nodeId: 'wire', key: 'kind', value: 'rect' }])
  assert.equal(node(bytes).connection, undefined)
})

test('CLI exposes and validates all three connection animation properties', () => {
  for (const propertyId of ['connection.width', 'connection.flowSpeed', 'connection.flowPhase'] as const) {
    assert.ok(PROPERTY_IDS.includes(propertyId))
    const bytes = applyScenePatch(fixture(), [{ op: 'setTrack', track: {
      id: propertyId, nodeId: 'wire', propertyId,
      keyframes: [{ id: 'first', time: 0, value: 0 }, { id: 'last', time: 1, value: 1 }],
    } }])
    assert.deepEqual(validateScene(bytes).errors, [])
  }
})

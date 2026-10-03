// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'
import { applyScenePatch, buildSceneBytes, PROPERTY_IDS, validateScene } from './build.js'

function nodes(bytes: Uint8Array) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, bytes)
  return doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
}
function fixture() {
  return buildSceneBytes({ nodes: {
    root: { id: 'root', kind: 'frame', parent: null, children: ['box'], size: { width: 960, height: 540 } },
    box: { id: 'box', kind: 'rect', parent: 'root', size: { width: 120, height: 80 }, extrusion: { depth: 60, sideColor: '#2563eb' } },
  } })
}

test('CLI authors extrusion and exposes depth animation without changing flat legacy nodes', () => {
  const bytes = fixture()
  assert.deepEqual(nodes(bytes).get('box')?.get('extrusion'), { depth: 60, sideColor: '#2563eb' })
  assert.equal(nodes(bytes).get('root')?.get('extrusion'), undefined)
  assert.ok(PROPERTY_IDS.includes('extrusion.depth'))
  const animated = applyScenePatch(bytes, [{ op: 'setTrack', track: {
    id: 'height', nodeId: 'box', propertyId: 'extrusion.depth', keyframes: [
      { id: 'low', time: 0, value: 0 }, { id: 'high', time: 1, value: 120 },
    ],
  } }])
  assert.deepEqual(validateScene(animated).errors, [])
})

test('CLI creates, normalizes, edits, and clears extrusion with both patch operations', () => {
  let bytes = applyScenePatch(fixture(), [
    { op: 'createNode', node: { id: 'cylinder', kind: 'ellipse', parent: 'root', extrusion: { depth: 999999, sideColor: '  #00f  ' } } },
    { op: 'setNode', nodeId: 'box', patch: { extrusion: { depth: -4, sideColor: '' } } },
  ])
  assert.deepEqual(nodes(bytes).get('cylinder')?.get('extrusion'), { depth: 100000, sideColor: '#00f' })
  assert.deepEqual(nodes(bytes).get('box')?.get('extrusion'), { depth: 0, sideColor: '#2563eb' })
  bytes = applyScenePatch(bytes, [
    { op: 'setNodeProperty', nodeId: 'box', key: 'extrusion', value: { depth: 80, sideColor: '#123456' } },
    { op: 'setNode', nodeId: 'cylinder', patch: { extrusion: null } },
  ])
  assert.deepEqual(nodes(bytes).get('box')?.get('extrusion'), { depth: 80, sideColor: '#123456' })
  assert.equal(nodes(bytes).get('cylinder')?.get('extrusion'), undefined)
  bytes = applyScenePatch(bytes, [{ op: 'setNodeProperty', nodeId: 'box', key: 'extrusion', value: null }])
  assert.equal(nodes(bytes).get('box')?.get('extrusion'), undefined)
})

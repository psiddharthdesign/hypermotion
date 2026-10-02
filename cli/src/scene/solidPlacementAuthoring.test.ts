// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import test from 'node:test'
import { applyScenePatch, buildSceneBytes, inspectScene, PROPERTY_IDS, type SceneJson } from './build.js'

function nodes(bytes: Uint8Array) { return inspectScene(bytes).nodes as Record<string, Record<string, unknown>> }
function fixture() { return buildSceneBytes({ nodes: {
  root: { id: 'root', kind: 'frame', children: ['asset', 'legacy'] },
  asset: { id: 'asset', kind: 'frame', parent: 'root', children: ['body'], preventOverlap: true },
  body: { id: 'body', kind: 'rect', parent: 'asset', extrusion: { depth: 80 } },
  legacy: { id: 'legacy', kind: 'ellipse', parent: 'root' },
} }) }

test('CLI preserves opt-in asset protection while legacy shapes remain unrestricted', () => {
  const bytes = fixture()
  assert.equal(nodes(bytes).asset!.preventOverlap, true)
  assert.equal(nodes(bytes).legacy!.preventOverlap, undefined)
  assert.equal(nodes(bytes).body!.preventOverlap, undefined)
  const rebuilt = buildSceneBytes(inspectScene(bytes) as SceneJson)
  assert.equal(nodes(rebuilt).asset!.preventOverlap, true)
  assert.equal(PROPERTY_IDS.some(id => (id as string) === 'preventOverlap'), false)
})

test('CLI create and both patch operations can enable and clear overlap protection', () => {
  let bytes = applyScenePatch(fixture(), [
    { op: 'createNode', node: { id: 'new', kind: 'rect', parent: 'root', preventOverlap: true } },
    { op: 'setNode', nodeId: 'body', patch: { preventOverlap: true } },
    { op: 'setNodeProperty', nodeId: 'legacy', key: 'preventOverlap', value: true },
  ])
  for (const id of ['new', 'body', 'legacy']) assert.equal(nodes(bytes)[id]!.preventOverlap, true)
  bytes = applyScenePatch(bytes, [
    { op: 'setNode', nodeId: 'new', patch: { preventOverlap: false } },
    { op: 'setNodeProperty', nodeId: 'body', key: 'preventOverlap', value: null },
    { op: 'setNodeProperty', nodeId: 'legacy', key: 'preventOverlap', value: 'true' },
  ])
  for (const id of ['new', 'body', 'legacy']) assert.equal(nodes(bytes)[id]!.preventOverlap, undefined)
  assert.equal(nodes(bytes).asset!.preventOverlap, true)
})

test('CLI creation does not treat truthy malformed protection values as enabled', () => {
  const bytes = buildSceneBytes({ nodes: { root: { id: 'root', kind: 'frame', preventOverlap: 'true' as never } } })
  assert.equal(nodes(bytes).root!.preventOverlap, undefined)
  const patched = applyScenePatch(fixture(), [{ op: 'createNode', node: { id: 'bad', kind: 'rect', parent: 'root', preventOverlap: 1 as never } }])
  assert.equal(nodes(patched).bad!.preventOverlap, undefined)
})

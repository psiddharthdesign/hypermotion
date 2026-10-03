// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSceneBytes, inspectScene, validateScene, type SceneJson } from './build.js'
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
function scene(): SceneJson {
  return { root: 'root', nodes: {
    root: { id: 'root', kind: 'frame', parent: null, children: ['arrangement', 'layer'] },
    arrangement: { id: 'arrangement', kind: 'arrangement', parent: 'root', arrangement: { version: 1, mode: 'spherical', radius: 200, memberIds: ['layer'] } },
    layer: { id: 'layer', kind: 'rect', parent: 'root', transformParent: { nodeId: 'arrangement', inverseBind: identity } },
  }, tracks: { radius: { id: 'radius', nodeId: 'arrangement', propertyId: 'arrangement.radius', defaultEasing: 'linear', keyframes: [{ id: 'a', time: 0, value: 200 }, { id: 'b', time: 1, value: 400 }] } } }
}
test('authors, persists and validates native arrangements and their animation', () => {
  const bytes = buildSceneBytes(scene())
  assert.deepEqual(validateScene(bytes).errors, [])
  const data = inspectScene(bytes)
  assert.deepEqual((data.nodes as Record<string, Record<string, unknown>>).arrangement!.arrangement, scene().nodes!.arrangement!.arrangement)
  assert.equal((data.nodes as Record<string, Record<string, unknown>>).arrangement!.position, 'absolute')
})
test('rejects missing, repeated and unlinked members', () => {
  const data = scene()
  data.nodes!.arrangement!.arrangement!.memberIds = ['layer', 'layer', 'missing']
  data.nodes!.layer!.transformParent = null
  const errors = validateScene(buildSceneBytes(data)).errors.join('\n')
  assert.match(errors, /duplicate members/)
  assert.match(errors, /invalid arrangement member/)
  assert.match(errors, /must link to this arrangement/)
})

test('accepts discrete arrangement choices and custom path keyframes', () => {
  const data = scene()
  for (const [key, value] of Object.entries({ orbit: 360, mode: 'path', orientation: 'outward', shape: 'custom', scaleMode: 'ripple', path: { version: 1, points: [{ id: 'a', t: 0, x: 0, y: 0 }, { id: 'b', t: 1, x: 240, y: 0 }] } })) {
    data.tracks![key] = { id: key, nodeId: 'arrangement', propertyId: `arrangement.${key}` as 'arrangement.mode', defaultEasing: 'linear', keyframes: [{ id: 'a', time: 0, value }] }
  }
  assert.deepEqual(validateScene(buildSceneBytes(data)).errors, [])
})


test('rejects attached flow lines as direct arrangement members', () => {
  const data = scene()
  data.nodes!.root!.children!.push('target', 'flow')
  data.nodes!.target = { id: 'target', kind: 'rect', parent: 'root' }
  data.nodes!.flow = { id: 'flow', kind: 'vector', parent: 'root',
    connection: { version: 1, sourceId: 'layer', targetId: 'target' },
    transformParent: { nodeId: 'arrangement', inverseBind: identity },
  }
  data.nodes!.arrangement!.arrangement!.memberIds = ['layer', 'flow']
  assert.match(validateScene(buildSceneBytes(data)).errors.join('\n'), /invalid arrangement member: flow/)
})

// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSceneBytes, inspectScene, validateScene, type SceneJson } from './build.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
function scene(): SceneJson {
  return { root: 'root', nodes: {
    root: { id: 'root', kind: 'frame', parent: null, children: ['null', 'layer'] },
    null: { id: 'null', kind: 'null', parent: 'root' },
    layer: { id: 'layer', kind: 'rect', parent: 'root', transformParent: { nodeId: 'null', inverseBind: identity } },
    camera: { id: 'camera', kind: 'camera', parent: null, transformParent: { nodeId: 'null', inverseBind: identity } },
  } }
}

test('authors and validates Null controllers with layer and scene-level camera links', () => {
  const bytes = buildSceneBytes(scene())
  const validation = validateScene(bytes)
  assert.deepEqual(validation.errors, [])
  const nodes = inspectScene(bytes).nodes as Record<string, Record<string, unknown>>
  assert.deepEqual(nodes.layer!.transformParent, { nodeId: 'null', inverseBind: identity })
  assert.deepEqual(nodes.camera!.transformParent, { nodeId: 'null', inverseBind: identity })
  assert.equal(nodes.null!.position, 'absolute')
  assert.equal((nodes.null!.appearance as Record<string, unknown>).fill, null)
})

test('rejects dangling, malformed and cyclic Null connections', () => {
  const input = scene()
  input.nodes!.null!.transformParent = { nodeId: 'null', inverseBind: [1] }
  input.nodes!.layer!.transformParent = { nodeId: 'missing', inverseBind: identity }
  const errors = validateScene(buildSceneBytes(input)).errors.join('\n')
  assert.match(errors, /cyclic Null connection/)
  assert.match(errors, /finite 4x4 matrix/)
  assert.match(errors, /must reference a Null/)
})

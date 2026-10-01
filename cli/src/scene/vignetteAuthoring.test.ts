// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import { applyScenePatch, buildSceneBytes, inspectScene, PROPERTY_IDS, validateScene, type NodeJson, type SceneJson } from './build.js'

function scene(camera: Partial<NodeJson> = {}): SceneJson {
  return {
    root: 'root', activeCameraId: 'camera',
    nodes: {
      root: { id: 'root', kind: 'frame', parent: null, children: [] },
      camera: { id: 'camera', kind: 'camera', parent: null, ...camera },
    },
  }
}

function cameraFrom(bytes: Uint8Array): Record<string, unknown> {
  return (inspectScene(bytes).nodes as Record<string, Record<string, unknown>>).camera!
}

test('CLI creates inactive vignette defaults and clamps authored values', () => {
  const defaults = cameraFrom(buildSceneBytes(scene()))
  assert.equal(defaults.vignetteEnabled, false)
  assert.equal(defaults.vignetteAmount, 0.35)
  assert.equal(defaults.vignetteSize, 0.5)
  assert.equal(defaults.vignetteFeather, 0.5)
  const camera = cameraFrom(buildSceneBytes(scene({ vignetteEnabled: true, vignetteAmount: 2, vignetteSize: -2, vignetteFeather: NaN })))
  assert.equal(camera.vignetteEnabled, true)
  assert.equal(camera.vignetteAmount, 1)
  assert.equal(camera.vignetteSize, 0)
  assert.equal(camera.vignetteFeather, 0.5)
})

test('CLI supports vignette tracks and all camera patch authoring routes', () => {
  const input = scene({ vignetteEnabled: true, vignetteAmount: 0.8, vignetteSize: 0.25, vignetteFeather: 0.7 })
  input.tracks = Object.fromEntries((['vignetteAmount', 'vignetteSize', 'vignetteFeather'] as const).map(field => {
    const propertyId = `camera.${field}` as const
    assert.ok(PROPERTY_IDS.includes(propertyId as (typeof PROPERTY_IDS)[number]))
    return [field, { id: field, nodeId: 'camera', propertyId, defaultEasing: 'linear', keyframes: [{ id: 'a', time: 0, value: 0.2 }, { id: 'b', time: 1, value: 0.8 }] }]
  }))
  const bytes = buildSceneBytes(input)
  assert.equal(validateScene(bytes).ok, true)
  assert.equal(cameraFrom(bytes).vignetteAmount, 0.8)
  const patched = applyScenePatch(bytes, [
    { op: 'setNodeProperty', nodeId: 'camera', key: 'vignetteAmount', value: 2 },
    { op: 'setNode', nodeId: 'camera', patch: { vignetteSize: -1, vignetteFeather: 0.6 } },
    { op: 'createNode', node: { id: 'second', kind: 'camera', parent: null, vignetteEnabled: true, vignetteAmount: 0.75, vignetteSize: 2 } },
  ])
  const camera = cameraFrom(patched)
  assert.equal(camera.vignetteAmount, 1)
  assert.equal(camera.vignetteSize, 0)
  assert.equal(camera.vignetteFeather, 0.6)
  const created = (inspectScene(patched).nodes as Record<string, Record<string, unknown>>).second!
  assert.equal(created.vignetteEnabled, true)
  assert.equal(created.vignetteAmount, 0.75)
  assert.equal(created.vignetteSize, 1)
  assert.equal(created.vignetteFeather, 0.5)
  assert.equal(Object.keys(inspectScene(patched).tracks as object).length, 3)
})

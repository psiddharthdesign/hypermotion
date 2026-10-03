// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'
import { applyScenePatch, buildSceneBytes, PROPERTY_IDS, type NodeJson, type SceneJson } from './build.js'

function read(bytes: Uint8Array) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, bytes)
  return doc.getMap('scene').toJSON() as { nodes: Record<string, Record<string, unknown>>; tracks: Record<string, Record<string, unknown>> }
}
const camera: NodeJson = {
  id: 'camera', kind: 'camera', parent: null,
  projection: 'orthographic', compositionGuide: 'isometric', focusMode: 'spatial', focusPlaneX: 240, focusPlaneY: 180, focusPlaneZ: -120,
  focusPlaneRotationX: 20, focusPlaneRotationY: -40, focusPlaneRotationZ: 60,
}
const scene: SceneJson = { nodes: { root: { id: 'root', kind: 'frame', parent: null, children: [], size: { width: 960, height: 540 } }, camera } }

test('CLI creates and patches independent focus-plane fields and tracks', () => {
  const bytes = buildSceneBytes({ ...scene, tracks: {
    focus: { id: 'focus', nodeId: 'camera', propertyId: 'camera.focusPlaneRotationY', defaultEasing: 'linear', keyframes: [{ id: 'a', time: 0, value: -40 }, { id: 'b', time: 1, value: 40 }] },
  } })
  const built = read(bytes)
  for (const key of ['focusMode', 'focusPlaneX', 'focusPlaneY', 'focusPlaneZ', 'focusPlaneRotationX', 'focusPlaneRotationY', 'focusPlaneRotationZ'] as const) assert.equal(built.nodes.camera![key], camera[key])
  assert.equal(built.tracks.focus!.propertyId, 'camera.focusPlaneRotationY')
  assert.equal(built.nodes.camera!.focusPlaneInitialized, true)
  assert.equal(built.nodes.camera!.projection, 'orthographic')
  assert.equal(built.nodes.camera!.compositionGuide, 'isometric')
  for (const id of ['camera.focusPlaneX', 'camera.focusPlaneY', 'camera.focusPlaneZ', 'camera.focusPlaneRotationX', 'camera.focusPlaneRotationY', 'camera.focusPlaneRotationZ']) assert.ok((PROPERTY_IDS as readonly string[]).includes(id))
  const patched = read(applyScenePatch(bytes, [
    { op: 'setNode', nodeId: 'camera', patch: { focusPlaneRotationX: 45, focusPlaneRotationZ: -90 } },
    { op: 'createNode', node: { ...camera, id: 'copy' } },
    { op: 'setTrack', track: { id: 'focus-z', nodeId: 'copy', propertyId: 'camera.focusPlaneRotationZ', keyframes: [{ id: 'k', time: 0, value: 60 }] } },
    { op: 'setTrack', track: { id: 'focus-position', nodeId: 'copy', propertyId: 'camera.focusPlaneZ', keyframes: [{ id: 'k', time: 0, value: -120 }] } },
  ]))
  assert.equal(patched.nodes.camera!.focusPlaneRotationX, 45)
  assert.equal(patched.nodes.camera!.focusPlaneRotationZ, -90)
  assert.equal(patched.nodes.copy!.focusMode, 'spatial')
  assert.equal(patched.nodes.copy!.focusPlaneRotationY, -40)
  assert.equal(patched.tracks['focus-z']!.propertyId, 'camera.focusPlaneRotationZ')
  assert.equal(patched.tracks['focus-position']!.propertyId, 'camera.focusPlaneZ')
})

test('CLI keeps legacy camera defaults when no independent focus plane is authored', () => {
  const built = read(buildSceneBytes({ ...scene, nodes: { ...scene.nodes, camera: { id: 'camera', kind: 'camera', parent: null } } }))
  assert.equal(built.nodes.camera!.focusMode, 'screen')
  assert.equal(built.nodes.camera!.focusPlaneInitialized, false)
  for (const key of ['focusPlaneX', 'focusPlaneY', 'focusPlaneZ', 'focusPlaneRotationX', 'focusPlaneRotationY', 'focusPlaneRotationZ']) assert.equal(built.nodes.camera![key], 0)
})

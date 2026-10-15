// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import test from 'node:test'
import { applyScenePatch, buildSceneBytes, inspectScene, PROPERTY_IDS } from './build.js'

test('scene authoring preserves editor UI state and supports setUiState patches', () => {
  const initial = buildSceneBytes({
    nodes: { root: { id: 'root', kind: 'frame', parent: null } },
    uiState: {
      staggerSets: {
        'stagger-1': { id: 'stagger-1', layerIds: ['root'], delay: 0.1, order: 'forward', members: {} },
      },
    },
  })
  assert.deepEqual(inspectScene(initial).uiState, {
    staggerSets: {
      'stagger-1': { id: 'stagger-1', layerIds: ['root'], delay: 0.1, order: 'forward', members: {} },
    },
  })
  const patched = applyScenePatch(initial, [{
    op: 'setUiState', key: 'kfGroups', value: { 'group-1': ['track-1'] },
  }])
  assert.deepEqual(inspectScene(patched).uiState, {
    staggerSets: {
      'stagger-1': { id: 'stagger-1', layerIds: ['root'], delay: 0.1, order: 'forward', members: {} },
    },
    kfGroups: { 'group-1': ['track-1'] },
  })
})

test('vector stroke is exposed as a keyframeable property', () => {
  assert.ok(PROPERTY_IDS.includes('vector.stroke'))
})

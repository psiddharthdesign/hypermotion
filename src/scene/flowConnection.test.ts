// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from './doc'
import { DEFAULT_FLOW_CONNECTION, normalizeFlowConnection } from './flowConnection'
import { applyBytesToScene, applyJsonToScene, sceneToBytes, sceneToJson } from './file'
import { createProjectAPI } from '@/project/doc'
import { getAnimEngine } from '@/anim/engine'
import { addKeyframe } from '@/anim/tracks'
import { keyframeValuesForPatch } from '@/anim/recordKeyframes'

function fixture() {
  const api = createSceneAPI()
  const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
  const a = api.createNode('rect', root, { name: 'Source' })
  const b = api.createNode('rect', root, { name: 'Target' })
  const id = api.createNode('vector', root, { name: 'Flow', connection: { ...DEFAULT_FLOW_CONNECTION, sourceId: a, targetId: b } })
  return { api, root, a, b, id }
}
function expectAttached(api: ReturnType<typeof createSceneAPI>, root = api.getRoot()) {
  const children = api.getChildren(root)
  const source = children.find(node => node.name === 'Source')!, target = children.find(node => node.name === 'Target')!, flow = children.find(node => node.name === 'Flow')!
  expect(flow.connection).toEqual({ ...DEFAULT_FLOW_CONNECTION, sourceId: source.id, targetId: target.id })
}

describe('flow connection scene model', () => {
  it('validates endpoint references and clamps malformed numbers without adding connections to old vectors', () => {
    expect(normalizeFlowConnection({ sourceId: 'a', targetId: 'a' })).toBeUndefined()
    expect(normalizeFlowConnection({ sourceId: 'a' })).toBeUndefined()
    expect(normalizeFlowConnection({ sourceId: 'a', targetId: 'b', width: -4, flowSpeed: Infinity })).toMatchObject({ width: 0.25, flowSpeed: 120 })
    const api = createSceneAPI(), id = api.createNode('vector', null, {})
    expect(api.getNode(id)?.connection).toBeUndefined()
    const rect = api.createNode('rect', null, { connection: { ...DEFAULT_FLOW_CONNECTION, sourceId: 'a', targetId: 'b' } })
    expect(api.getNode(rect)?.connection).toBeUndefined()
  })
  it('preserves links in binary saves and remaps links during JSON import', () => {
    const { api } = fixture()
    const binary = new Y.Doc()
    applyBytesToScene(binary, sceneToBytes(api.doc))
    expectAttached(createSceneAPI(binary))
    const json = applyJsonToScene(new Y.Doc(), sceneToJson(api))
    expect(json.getRoot()).not.toBe(api.getRoot())
    expectAttached(json)
  })
  it('reconnects duplicated compositions to duplicated assets instead of originals', () => {
    const { api } = fixture(), project = createProjectAPI(api)
    project.ensureInitialized()
    const copy = project.duplicateScene(project.getScenes()[0]!.id)!
    expectAttached(api, copy.rootNodeId)
  })
  it('evaluates keyframed width, speed and phase through ordinary animation tracks', () => {
    const { api, id } = fixture()
    for (const [property, end] of [['connection.width', 20], ['connection.flowSpeed', 200], ['connection.flowPhase', 1]] as const) {
      addKeyframe(api, id, property, 0, 0)
      addKeyframe(api, id, property, 2, end)
      const track = api.getTracksForNode(id).find(track => track.propertyId === property)!
      api.setTrack({ ...track, defaultEasing: 'linear', keyframes: track.keyframes.map(k => ({ ...k, easing: 'linear' })) })
    }
    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(1)
    expect(engine.getSnapshot()[id]).toMatchObject({ connectionWidth: 10, connectionFlowSpeed: 100, connectionFlowDistance: 50, connectionFlowPhase: 0.5 })
    expect(keyframeValuesForPatch('connection', { width: 8, flowSpeed: 30, flowPhase: 0.4, color: '#fff' })).toEqual([
      { propertyId: 'connection.width', value: 8 }, { propertyId: 'connection.flowSpeed', value: 30 }, { propertyId: 'connection.flowPhase', value: 0.4 },
    ])
    engine.pause()
  })
})

// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { loadSceneIntoDoc, readScene, sceneToBytes } from '@/scene/file'
import { removeLegacy3DObjects } from '@/scene/removeLegacy3DObjects'

describe('removed standalone 3D objects', () => {
  it('purges old objects, descendants, tracks, and references idempotently', () => {
    const doc = legacyObjectDocument()

    expect(removeLegacy3DObjects(doc)).toEqual(['cube', 'cube-child'])
    expect(removeLegacy3DObjects(doc)).toEqual([])

    const api = createSceneAPI(doc)
    expect(api.getAllNodeIds().sort()).toEqual([
      'camera',
      'root',
      'shader',
      'title',
    ])
    expect(api.getNode('root')?.children).toEqual(['title', 'shader'])
    expect(api.getTrack('cube-track')).toBeNull()
    expect(api.getTrack('title-track')).not.toBeNull()

    const camera = api.getNode('camera')
    expect(camera?.kind).toBe('camera')
    if (camera?.kind === 'camera') {
      expect(camera.focusTargetNodeId).toBeNull()
      expect(camera.focusMode).toBe('screen')
    }

    const shader = api.getNode('shader')
    expect(shader?.kind).toBe('shader')
    if (shader?.kind === 'shader') {
      expect(shader.sourceNodeId).toBeUndefined()
    }

    expect(api.getUiState().trackGroups).toEqual({
      keep: {
        trackIds: ['title-track'],
        collapsed: false,
      },
    })
    expect(api.getUiState().kfGroups).toEqual({
      keep: ['title-keyframe'],
    })
    expect(api.getUiState().staggerSets).toEqual({
      keep: {
        id: 'keep',
        layerIds: ['title'],
        delay: 0.1,
        order: 'forward',
        members: {
          title: {
            'appearance.opacity': ['title-keyframe'],
          },
        },
      },
    })
  })

  it('opens an old .hype document without exposing the removed node kind', () => {
    const oldBytes = sceneToBytes(legacyObjectDocument())
    const { doc, api } = readScene(oldBytes)

    expect(api.getNode('cube')).toBeNull()
    expect(api.getNode('cube-child')).toBeNull()
    expect(api.getNode('root')?.children).toEqual(['title', 'shader'])

    doc.destroy()
  })

  it('replaces an active editor document with a sanitized old file', () => {
    const targetApi = createSceneAPI()
    loadSceneIntoDoc(targetApi.doc, sceneToBytes(legacyObjectDocument()))

    expect(targetApi.getNode('cube')).toBeNull()
    expect(targetApi.getNode('cube-child')).toBeNull()
    expect(targetApi.getNode('root')?.children).toEqual(['title', 'shader'])
  })
  it('preserves native controllers, bindings, and detached offsets during legacy cleanup', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    const controller = api.createNode('null', root)
    const arrangement = api.createNode('arrangement', root)
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const offset = [...identity]
    offset[12] = 120
    const connected = api.createNode('rect', root, {
      transformParent: { nodeId: controller, inverseBind: identity },
      transformOffset: offset,
    })
    const arranged = api.createNode('rect', root, {
      transformParent: { nodeId: arrangement, inverseBind: identity },
    })
    const detached = api.createNode('rect', root, { transformOffset: offset })
    api.setTrack({ id: 'native-motion', nodeId: controller, propertyId: 'transform.x', defaultEasing: 'linear', keyframes: [{ id: 'native-key', time: 0, value: 80 }] })
    const nodes = api.doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
    nodes.set('retired', rawNode('retired', 'primitive3d', root))

    expect(removeLegacy3DObjects(api.doc)).toEqual(['retired'])
    expect(api.getNode(controller)?.kind).toBe('null')
    expect(api.getNode(arrangement)?.kind).toBe('arrangement')
    expect(api.getNode(connected)?.transformParent).toEqual({ nodeId: controller, inverseBind: identity })
    expect(api.getNode(connected)?.transformOffset).toEqual(offset)
    expect(api.getNode(arranged)?.transformParent).toEqual({ nodeId: arrangement, inverseBind: identity })
    expect(api.getNode(detached)?.transformOffset).toEqual(offset)
    expect(api.getTrack('native-motion')).not.toBeNull()
    const snapshot = sceneToBytes(api.doc)
    expect(removeLegacy3DObjects(api.doc)).toEqual([])
    expect(sceneToBytes(api.doc)).toEqual(snapshot)
  })

  it('retains a minimally authored controller when a valid binding identifies its use', () => {
    const doc = legacyObjectDocument()
    const nodes = doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
    nodes.set('controller', rawNode('controller', 'null', 'root'))
    nodes.get('title')!.set('transformParent', {
      nodeId: 'controller', inverseBind: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    })
    expect(removeLegacy3DObjects(doc)).toEqual(['cube', 'cube-child'])
    expect(nodes.has('controller')).toBe(true)
    expect(nodes.get('title')!.has('transformParent')).toBe(true)
  })
})

function legacyObjectDocument(): Y.Doc {
  const doc = new Y.Doc()
  const scene = doc.getMap<unknown>('scene')
  const nodes = new Y.Map<Y.Map<unknown>>()
  const tracks = new Y.Map<Y.Map<unknown>>()
  const uiState = new Y.Map<unknown>()

  scene.set('nodes', nodes)
  scene.set('tracks', tracks)
  scene.set('uiState', uiState)
  scene.set('root', 'root')
  scene.set('activeCameraId', 'camera')

  nodes.set('root', rawNode('root', 'frame', null, [
    'title',
    'cube',
    'shader',
  ]))
  nodes.set('title', rawNode('title', 'text', 'root'))
  nodes.set('cube', rawNode('cube', 'primitive3d', 'root', ['cube-child']))
  nodes.set('cube-child', rawNode('cube-child', 'rect', 'cube'))

  const shader = rawNode('shader', 'shader', 'root')
  shader.set('sourceNodeId', 'cube')
  nodes.set('shader', shader)

  const camera = rawNode('camera', 'camera', null)
  camera.set('focusMode', 'target')
  camera.set('focusTargetNodeId', 'cube')
  nodes.set('camera', camera)

  tracks.set(
    'cube-track',
    rawTrack('cube-track', 'cube', 'cube-keyframe'),
  )
  tracks.set(
    'title-track',
    rawTrack('title-track', 'title', 'title-keyframe'),
  )

  uiState.set('trackGroups', {
    remove: {
      trackIds: ['cube-track'],
      collapsed: false,
    },
    keep: {
      trackIds: ['cube-track', 'title-track'],
      collapsed: false,
    },
  })
  uiState.set('kfGroups', {
    remove: ['cube-keyframe'],
    keep: ['cube-keyframe', 'title-keyframe'],
  })
  uiState.set('kfGroupCollapsed', {
    remove: true,
    keep: false,
  })
  uiState.set('staggerSets', {
    remove: {
      id: 'remove',
      layerIds: ['cube'],
      delay: 0.1,
      order: 'forward',
      members: {
        cube: {
          'appearance.opacity': ['cube-keyframe'],
        },
      },
    },
    keep: {
      id: 'keep',
      layerIds: ['cube', 'title'],
      delay: 0.1,
      order: 'forward',
      members: {
        cube: {
          'appearance.opacity': ['cube-keyframe'],
        },
        title: {
          'appearance.opacity': ['cube-keyframe', 'title-keyframe'],
        },
      },
    },
  })

  return doc
}

function rawNode(
  id: string,
  kind: string,
  parent: string | null,
  children: string[] = [],
): Y.Map<unknown> {
  const node = new Y.Map<unknown>()
  const childArray = new Y.Array<string>()
  node.set('id', id)
  node.set('kind', kind)
  node.set('name', id)
  node.set('parent', parent)
  node.set('children', childArray)
  if (children.length > 0) childArray.push(children)
  return node
}

function rawTrack(
  id: string,
  nodeId: string,
  keyframeId: string,
): Y.Map<unknown> {
  const track = new Y.Map<unknown>()
  track.set('id', id)
  track.set('nodeId', nodeId)
  track.set('propertyId', 'appearance.opacity')
  track.set('defaultEasing', 'linear')
  track.set('keyframes', [{ id: keyframeId, time: 0, value: 1 }])
  return track
}

// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import * as Y from 'yjs'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { buildSceneBytes } from '../scene/build.js'
import { assertToolText } from '../testUtils/mcp.js'
import {
  handleGetLayer,
  handleListCameras,
  handleListLayers,
  handleListTracks,
  getLayerTool,
  listCamerasTool,
  listLayersTool,
  listTracksTool,
} from './tools/queryScene.js'

type ToolSchemaProperty = {
  readonly type?: string
  readonly minLength?: number
  readonly pattern?: string
  readonly description?: string
} | undefined
type PersistedNodeChildren = NonNullable<
  NonNullable<Parameters<typeof buildSceneBytes>[0]['nodes']>[string]['children']
>

function malformedChildren(children: unknown[]): PersistedNodeChildren {
  // Exercise persisted scenes whose child lists contain stale non-string entries.
  return children as PersistedNodeChildren
}

function inputProperty(
  tool: Pick<Tool, 'inputSchema'>,
  name: string,
): ToolSchemaProperty {
  const property = tool.inputSchema.properties?.[name]
  assert.ok(
    property === undefined ||
      (typeof property === 'object' && !Array.isArray(property)),
  )
  return property as ToolSchemaProperty
}

test('query scene MCP tool schemas describe their path and node id inputs', () => {
  for (const tool of [listLayersTool, getLayerTool, listTracksTool, listCamerasTool]) {
    const sceneProperty = inputProperty(tool, 'scene')

    assert.equal(sceneProperty?.type, 'string')
    assert.equal(sceneProperty?.minLength, 1)
    assert.equal(sceneProperty?.pattern, '\\S')
    assert.equal(sceneProperty?.description, 'Absolute or relative path to a .hype scene file.')
    assert.ok(Array.isArray(tool.inputSchema.required))
    assert.ok(tool.inputSchema.required.includes('scene'))
    assert.equal(tool.inputSchema.additionalProperties, false)
  }

  assert.deepEqual(getLayerTool.inputSchema.required, ['scene', 'nodeId'])
  assert.deepEqual(listLayersTool.inputSchema.required, ['scene'])
  assert.deepEqual(listTracksTool.inputSchema.required, ['scene'])
  assert.deepEqual(listCamerasTool.inputSchema.required, ['scene'])

  const getNodeIdProperty = inputProperty(getLayerTool, 'nodeId')
  assert.equal(getNodeIdProperty?.type, 'string')
  assert.equal(getNodeIdProperty?.minLength, 1)
  assert.equal(getNodeIdProperty?.pattern, '\\S')
  assert.equal(getNodeIdProperty?.description, 'Stable layer/node id to return.')

  const filterNodeIdProperty = inputProperty(listTracksTool, 'nodeId')
  assert.equal(filterNodeIdProperty?.type, 'string')
  assert.equal(filterNodeIdProperty?.minLength, 1)
  assert.equal(filterNodeIdProperty?.pattern, '\\S')
  assert.equal(filterNodeIdProperty?.description, 'Optional stable layer/node id to filter by.')
})

test('query scene MCP handlers report invalid arguments as MCP errors', async () => {
  const cases: ReadonlyArray<{
    name: string
    run: () => Promise<CallToolResult>
  }> = [
    { name: 'list_layers', run: () => handleListLayers({ scene: 42 }) },
    { name: 'get_layer', run: () => handleGetLayer({ scene: '/tmp/scene.hype' }) },
    { name: 'list_tracks', run: () => handleListTracks({ scene: 42 }) },
    { name: 'list_cameras', run: () => handleListCameras({ scene: 42 }) },
  ]

  for (const entry of cases) {
    const result = await entry.run()
    assert.equal(result.isError, true)
    assert.match(assertToolText(result), new RegExp(`^${entry.name}: invalid arguments`))
  }
})

test('query scene MCP handlers reject non-record argument payloads', async () => {
  const cases: ReadonlyArray<{
    name: string
    run: () => Promise<CallToolResult>
  }> = [
    { name: 'list_layers', run: () => handleListLayers(null) },
    { name: 'get_layer', run: () => handleGetLayer([]) },
    { name: 'list_tracks', run: () => handleListTracks('scene.hype') },
    { name: 'list_cameras', run: () => handleListCameras(false) },
  ]

  for (const entry of cases) {
    const result = await entry.run()
    assert.equal(result.isError, true)
    assert.match(assertToolText(result), new RegExp(`^${entry.name}: invalid arguments`))
  }
})

test('query scene MCP handlers reject unknown arguments as MCP errors', async () => {
  const cases: ReadonlyArray<{
    name: string
    run: () => Promise<CallToolResult>
  }> = [
    {
      name: 'list_layers',
      run: () => handleListLayers({ scene: '/tmp/scene.hype', output: 'out.json' }),
    },
    {
      name: 'get_layer',
      run: () => handleGetLayer({
        scene: '/tmp/scene.hype',
        nodeId: 'title',
        output: 'out.json',
      }),
    },
    {
      name: 'list_tracks',
      run: () => handleListTracks({ scene: '/tmp/scene.hype', output: 'out.json' }),
    },
    {
      name: 'list_cameras',
      run: () => handleListCameras({ scene: '/tmp/scene.hype', output: 'out.json' }),
    },
  ]

  for (const entry of cases) {
    const result = await entry.run()
    assert.equal(result.isError, true)
    assert.match(assertToolText(result), new RegExp(`^${entry.name}: invalid arguments`))
  }
})

test('query scene MCP handlers reject blank node ids clearly', async () => {
  const cases: ReadonlyArray<{
    name: string
    run: () => Promise<CallToolResult>
  }> = [
    { name: 'get_layer', run: () => handleGetLayer({ scene: '/tmp/scene.hype', nodeId: '  ' }) },
    { name: 'list_tracks', run: () => handleListTracks({ scene: '/tmp/scene.hype', nodeId: '\n' }) },
  ]

  for (const entry of cases) {
    const result = await entry.run()
    assert.equal(result.isError, true)
    assert.match(assertToolText(result), new RegExp(`^${entry.name}: invalid arguments`))
    assert.match(assertToolText(result), /nodeId is required/)
  }
})

test('query scene MCP handlers report missing scene files as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-missing-query-'))
  const missingScene = path.join(dir, 'missing.hype')

  try {
    const cases: ReadonlyArray<{
      name: string
      run: () => Promise<CallToolResult>
    }> = [
      { name: 'list_layers', run: () => handleListLayers({ scene: missingScene }) },
      { name: 'get_layer', run: () => handleGetLayer({ scene: missingScene, nodeId: 'title' }) },
      { name: 'list_tracks', run: () => handleListTracks({ scene: missingScene }) },
      { name: 'list_cameras', run: () => handleListCameras({ scene: missingScene }) },
    ]

    for (const entry of cases) {
      const result = await entry.run()
      assert.equal(result.isError, true)
      assert.equal(assertToolText(result), `${entry.name}: scene file not found: ${missingScene}`)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('query scene MCP handlers reject empty scene paths clearly', async () => {
  const cases: ReadonlyArray<{
    name: string
    run: () => Promise<CallToolResult>
  }> = [
    { name: 'list_layers', run: () => handleListLayers({ scene: '  ' }) },
    { name: 'get_layer', run: () => handleGetLayer({ scene: '\n', nodeId: 'title' }) },
    { name: 'list_tracks', run: () => handleListTracks({ scene: '\t' }) },
    { name: 'list_cameras', run: () => handleListCameras({ scene: '' }) },
  ]

  for (const entry of cases) {
    const result = await entry.run()
    assert.equal(result.isError, true)
    assert.match(assertToolText(result), new RegExp(`^${entry.name}: invalid arguments`))
    assert.match(assertToolText(result), /scene path is required/)
  }
})

test('query scene MCP handlers report directories as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-directory-query-'))
  const scenePath = path.join(dir, 'scene.hype')
  fs.mkdirSync(scenePath)

  try {
    const cases: ReadonlyArray<{
      name: string
      run: () => Promise<CallToolResult>
    }> = [
      { name: 'list_layers', run: () => handleListLayers({ scene: scenePath }) },
      { name: 'get_layer', run: () => handleGetLayer({ scene: scenePath, nodeId: 'title' }) },
      { name: 'list_tracks', run: () => handleListTracks({ scene: scenePath }) },
      { name: 'list_cameras', run: () => handleListCameras({ scene: scenePath }) },
    ]

    for (const entry of cases) {
      const result = await entry.run()
      assert.equal(result.isError, true)
      assert.equal(assertToolText(result), `${entry.name}: scene path is not a file: ${scenePath}`)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('query scene MCP handlers report malformed scene files as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-malformed-query-'))
  const scenePath = path.join(dir, 'malformed.hype')

  try {
    fs.writeFileSync(scenePath, 'not a yjs update')

    const cases: ReadonlyArray<{
      name: string
      run: () => Promise<CallToolResult>
    }> = [
      { name: 'list_layers', run: () => handleListLayers({ scene: scenePath }) },
      { name: 'get_layer', run: () => handleGetLayer({ scene: scenePath, nodeId: 'title' }) },
      { name: 'list_tracks', run: () => handleListTracks({ scene: scenePath }) },
      { name: 'list_cameras', run: () => handleListCameras({ scene: scenePath }) },
    ]

    for (const entry of cases) {
      const result = await entry.run()
      assert.equal(result.isError, true)
      assert.match(
        assertToolText(result),
        new RegExp(`^${entry.name}: ${escapeRegExp(scenePath)} is not a valid \\.hype file:`),
      )
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('query scene MCP handlers trim padded scene paths before reading', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-trimmed-query-'))
  const scenePath = path.join(dir, 'scene.hype')

  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: { name: 'Trimmed Query', canvas: { width: 320, height: 180 } },
        nodes: {
          root: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: [],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
        },
      }),
    )

    const result = await handleListLayers({ scene: `  ${scenePath}\n` })
    const payload = JSON.parse(assertToolText(result)) as {
      root: string
      layers: Array<{ id: string }>
    }

    assert.equal(result.isError, undefined)
    assert.equal(payload.root, 'root')
    assert.deepEqual(
      payload.layers.map((layer) => layer.id),
      ['root'],
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('query scene MCP handlers resolve padded relative scene paths before reading', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-relative-query-'))
  const scenePath = path.join(dir, 'scene.hype')
  const previousCwd = process.cwd()

  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: { name: 'Relative Query', canvas: { width: 320, height: 180 } },
        nodes: {
          root: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: [],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
        },
      }),
    )
    process.chdir(dir)

    const result = await handleListLayers({ scene: ' ./scene.hype ' })
    const payload = JSON.parse(assertToolText(result)) as {
      root: string
      layers: Array<{ id: string }>
    }

    assert.equal(result.isError, undefined)
    assert.equal(payload.root, 'root')
    assert.deepEqual(
      payload.layers.map((layer) => layer.id),
      ['root'],
    )
  } finally {
    process.chdir(previousCwd)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('query scene MCP handlers return layers, tracks, and cameras', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-query-mcp-'))
  const scenePath = path.join(dir, 'scene.hype')

  try {
    const bytes = buildSceneBytes({
      meta: {
        name: 'Query MCP',
        canvas: { width: 320, height: 180 },
      },
      nodes: {
        root: {
          id: 'root',
          name: 'Root frame',
          kind: 'frame',
          parent: null,
          children: malformedChildren(['title', 'title.*', 42]),
          size: { width: 320, height: 180 },
          layout: { mode: 'none' },
        },
        title: {
          id: 'title',
          name: 'Title',
          kind: 'text',
          parent: 'root',
          zIndex: 4,
          text: 'Queryable',
          fontFamily: 'Inter',
          fontSize: 24,
        },
        'title.*': {
          id: 'title.*',
          name: 'Literal title glob',
          kind: 'text',
          parent: 'root',
          text: 'Literal query id',
          fontFamily: 'Inter',
          fontSize: 20,
        },
        camera: {
          id: 'camera',
          name: 'Camera',
          kind: 'camera',
          parent: null,
          transform: { x: 160, y: 90, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        },
      },
      activeCameraId: 'camera',
      tracks: {
        fadeTitle: {
          id: 'fade-title',
          nodeId: 'title',
          propertyId: 'appearance.opacity',
          keyframes: [
            { id: 'fade-start', time: 0, value: 0 },
            { id: 'fade-end', time: 0.3, value: 1 },
          ],
        },
        fadeLiteralTitle: {
          id: 'fade-literal-title',
          nodeId: 'title.*',
          propertyId: 'appearance.opacity',
          keyframes: [
            { id: 'literal-fade-start', time: 0, value: 0 },
            { id: 'literal-fade-end', time: 0.3, value: 1 },
          ],
        },
        moveRoot: {
          id: 'move-root',
          nodeId: 'root',
          propertyId: 'transform.x',
          keyframes: [
            { id: 'move-start', time: 0, value: 0 },
            { id: 'move-end', time: 0.3, value: 12 },
          ],
        },
      },
    })
    const doc = new Y.Doc()
    Y.applyUpdate(doc, bytes)
    const scene = doc.getMap('scene')
    const nodes = scene.get('nodes') as Y.Map<unknown>
    const tracks = scene.get('tracks') as Y.Map<unknown>
    nodes.set('staleNodeEntry', 'not a node')
    tracks.set('staleTrackEntry', 'not a track')
    fs.writeFileSync(scenePath, Y.encodeStateAsUpdate(doc))

    const layersResult = await handleListLayers({ scene: scenePath })
    const layersPayload = JSON.parse(assertToolText(layersResult)) as {
      root: string
      activeCameraId: string
      layers: Array<{
        id: string
        name?: string
        kind: string
        children: string[]
        zIndex: number
      }>
    }

    assert.equal(layersPayload.root, 'root')
    assert.equal(layersPayload.activeCameraId, 'camera')
    assert.deepEqual(
      layersPayload.layers.map((layer) => layer.id).sort(),
      ['camera', 'root', 'title', 'title.*'],
    )
    assert.deepEqual(
      layersPayload.layers.find((layer) => layer.id === 'root')?.children,
      ['title', 'title.*'],
    )
    assert.equal(
      layersPayload.layers.find((layer) => layer.id === 'title')?.zIndex,
      4,
    )

    const layerResult = await handleGetLayer({ scene: scenePath, nodeId: 'title' })
    const layerPayload = JSON.parse(assertToolText(layerResult)) as {
      id: string
      text: string
      zIndex: number
    }
    assert.equal(layerPayload.id, 'title')
    assert.equal(layerPayload.text, 'Queryable')
    assert.equal(layerPayload.zIndex, 4)

    const paddedLayerResult = await handleGetLayer({ scene: scenePath, nodeId: ' title ' })
    const paddedLayerPayload = JSON.parse(assertToolText(paddedLayerResult)) as {
      id: string
      text: string
    }
    assert.equal(paddedLayerPayload.id, 'title')
    assert.equal(paddedLayerPayload.text, 'Queryable')

    const missingLayerResult = await handleGetLayer({ scene: scenePath, nodeId: 'missing' })
    assert.equal(missingLayerResult.isError, true)
    assert.equal(assertToolText(missingLayerResult), 'Layer not found: missing')

    const tracksResult = await handleListTracks({ scene: scenePath, nodeId: 'title' })
    const tracksPayload = JSON.parse(assertToolText(tracksResult)) as {
      tracks: Array<{ id: string; nodeId: string; propertyId: string }>
    }
    assert.equal(tracksPayload.tracks.length, 1)
    assert.equal(tracksPayload.tracks[0]?.id, 'fade-title')
    assert.equal(tracksPayload.tracks[0]?.nodeId, 'title')
    assert.equal(tracksPayload.tracks[0]?.propertyId, 'appearance.opacity')

    const literalTracksResult = await handleListTracks({ scene: scenePath, nodeId: 'title.*' })
    const literalTracksPayload = JSON.parse(assertToolText(literalTracksResult)) as {
      tracks: Array<{ id: string; nodeId: string; propertyId: string }>
    }
    assert.deepEqual(
      literalTracksPayload.tracks.map((track) => track.id),
      ['fade-literal-title'],
    )

    const paddedTracksResult = await handleListTracks({ scene: scenePath, nodeId: ' title ' })
    const paddedTracksPayload = JSON.parse(assertToolText(paddedTracksResult)) as {
      tracks: Array<{ id: string; nodeId: string; propertyId: string }>
    }
    assert.deepEqual(
      paddedTracksPayload.tracks.map((track) => track.id),
      ['fade-title'],
    )

    const allTracksResult = await handleListTracks({ scene: scenePath })
    const allTracksPayload = JSON.parse(assertToolText(allTracksResult)) as {
      tracks: Array<{ id: string; nodeId: string; propertyId: string }>
    }
    assert.deepEqual(
      allTracksPayload.tracks.map((track) => track.id).sort(),
      ['fade-literal-title', 'fade-title', 'move-root'],
    )

    const unrelatedTracksResult = await handleListTracks({ scene: scenePath, nodeId: 'missing' })
    const unrelatedTracksPayload = JSON.parse(assertToolText(unrelatedTracksResult)) as {
      tracks: unknown[]
    }
    assert.deepEqual(unrelatedTracksPayload.tracks, [])

    const camerasResult = await handleListCameras({ scene: scenePath })
    const camerasPayload = JSON.parse(assertToolText(camerasResult)) as {
      activeCameraId: string
      cameras: Array<{ id: string; kind: string }>
    }
    assert.equal(camerasPayload.activeCameraId, 'camera')
    assert.equal(camerasPayload.cameras.length, 1)
    assert.equal(camerasPayload.cameras[0]?.id, 'camera')
    assert.equal(camerasPayload.cameras[0]?.kind, 'camera')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('get_layer rejects malformed node entries whose id does not match the lookup key', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-query-mismatched-id-'))
  const scenePath = path.join(dir, 'scene.hype')

  try {
    const bytes = buildSceneBytes({
      meta: { name: 'Mismatched Node Id', canvas: { width: 320, height: 180 } },
      nodes: {
        root: {
          id: 'root',
          kind: 'frame',
          parent: null,
          children: [],
          size: { width: 320, height: 180 },
          layout: { mode: 'none' },
        },
      },
    })
    const doc = new Y.Doc()
    Y.applyUpdate(doc, bytes)
    const scene = doc.getMap('scene')
    const nodes = scene.get('nodes') as Y.Map<unknown>
    nodes.set('stale', { id: 'different', kind: 'text', text: 'stale' })
    nodes.set('numeric', { id: 42, kind: 'text', text: 'numeric' })
    fs.writeFileSync(scenePath, Y.encodeStateAsUpdate(doc))

    const mismatchedResult = await handleGetLayer({ scene: scenePath, nodeId: 'stale' })
    assert.equal(mismatchedResult.isError, true)
    assert.equal(assertToolText(mismatchedResult), 'Layer not found: stale')

    const numericResult = await handleGetLayer({ scene: scenePath, nodeId: 'numeric' })
    assert.equal(numericResult.isError, true)
    assert.equal(assertToolText(numericResult), 'Layer not found: numeric')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('list_cameras returns an empty list when the scene has no camera nodes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-query-no-camera-'))
  const scenePath = path.join(dir, 'scene.hype')

  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'No Camera Query',
          canvas: { width: 320, height: 180 },
        },
        nodes: {
          root: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: [],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
        },
      }),
    )

    const result = await handleListCameras({ scene: scenePath })
    const payload = JSON.parse(assertToolText(result)) as {
      activeCameraId: string | null
      cameras: unknown[]
    }

    assert.equal(result.isError, undefined)
    assert.equal(payload.activeCameraId, null)
    assert.deepEqual(payload.cameras, [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('list_cameras ignores malformed camera-shaped node entries', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-query-malformed-camera-'))
  const scenePath = path.join(dir, 'scene.hype')

  try {
    const bytes = buildSceneBytes({
      meta: {
        name: 'Malformed Camera Query',
        canvas: { width: 320, height: 180 },
      },
      nodes: {
        root: {
          id: 'root',
          kind: 'frame',
          parent: null,
          children: [],
          size: { width: 320, height: 180 },
          layout: { mode: 'none' },
        },
      },
    })
    const doc = new Y.Doc()
    Y.applyUpdate(doc, bytes)
    const scene = doc.getMap('scene')
    const nodes = scene.get('nodes') as Y.Map<unknown>
    nodes.set('malformedCameraEntry', { id: 42, kind: 'camera' })
    fs.writeFileSync(scenePath, Y.encodeStateAsUpdate(doc))

    const result = await handleListCameras({ scene: scenePath })
    const payload = JSON.parse(assertToolText(result)) as {
      activeCameraId: string | null
      cameras: unknown[]
    }

    assert.equal(result.isError, undefined)
    assert.equal(payload.activeCameraId, null)
    assert.deepEqual(payload.cameras, [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

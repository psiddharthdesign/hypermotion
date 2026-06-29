// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { buildSceneBytes } from '../scene/build.js'
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

test('query scene MCP tool schemas describe their path and node id inputs', () => {
  for (const tool of [listLayersTool, getLayerTool, listTracksTool, listCamerasTool]) {
    const sceneProperty = tool.inputSchema.properties?.scene as
      | Record<string, unknown>
      | undefined

    assert.equal(sceneProperty?.type, 'string')
    assert.equal(sceneProperty?.description, 'Path to a .hype scene file.')
    assert.ok(Array.isArray(tool.inputSchema.required))
    assert.ok(tool.inputSchema.required.includes('scene'))
  }

  assert.deepEqual(getLayerTool.inputSchema.required, ['scene', 'nodeId'])
  assert.deepEqual(listTracksTool.inputSchema.required, ['scene'])

  const getNodeIdProperty = getLayerTool.inputSchema.properties?.nodeId as
    | Record<string, unknown>
    | undefined
  assert.equal(getNodeIdProperty?.type, 'string')
  assert.equal(getNodeIdProperty?.description, 'Stable layer/node id to return.')

  const filterNodeIdProperty = listTracksTool.inputSchema.properties?.nodeId as
    | Record<string, unknown>
    | undefined
  assert.equal(filterNodeIdProperty?.type, 'string')
  assert.equal(filterNodeIdProperty?.description, 'Optional stable layer/node id to filter by.')
})

test('query scene MCP handlers report invalid arguments as MCP errors', async () => {
  const cases: Array<{
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
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.match(text, new RegExp(`^${entry.name}: invalid arguments`))
  }
})

test('query scene MCP handlers report missing scene files as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-missing-query-'))
  const missingScene = path.join(dir, 'missing.hype')

  try {
    const cases: Array<{
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
      const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
      assert.match(text, new RegExp(`^${entry.name}: failed to read ${missingScene}:`))
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

    const cases: Array<{
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
      const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
      assert.match(text, new RegExp(`^${entry.name}: failed to read ${scenePath}:`))
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('query scene MCP handlers return layers, tracks, and cameras', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-query-mcp-'))
  const scenePath = path.join(dir, 'scene.hype')

  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
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
            children: ['title'],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
          title: {
            id: 'title',
            name: 'Title',
            kind: 'text',
            parent: 'root',
            text: 'Queryable',
            fontFamily: 'Inter',
            fontSize: 24,
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
      }),
    )

    const layersResult = await handleListLayers({ scene: scenePath })
    const layersText = layersResult.content[0]?.type === 'text' ? layersResult.content[0].text : ''
    const layersPayload = JSON.parse(layersText) as {
      root: string
      activeCameraId: string
      layers: Array<{ id: string; name?: string; kind: string; children: string[] }>
    }

    assert.equal(layersPayload.root, 'root')
    assert.equal(layersPayload.activeCameraId, 'camera')
    assert.deepEqual(
      layersPayload.layers.map((layer) => layer.id).sort(),
      ['camera', 'root', 'title'],
    )
    assert.deepEqual(
      layersPayload.layers.find((layer) => layer.id === 'root')?.children,
      ['title'],
    )

    const layerResult = await handleGetLayer({ scene: scenePath, nodeId: 'title' })
    const layerText = layerResult.content[0]?.type === 'text' ? layerResult.content[0].text : ''
    const layerPayload = JSON.parse(layerText) as { id: string; text: string }
    assert.equal(layerPayload.id, 'title')
    assert.equal(layerPayload.text, 'Queryable')

    const missingLayerResult = await handleGetLayer({ scene: scenePath, nodeId: 'missing' })
    assert.equal(missingLayerResult.isError, true)
    const missingLayerText =
      missingLayerResult.content[0]?.type === 'text' ? missingLayerResult.content[0].text : ''
    assert.equal(missingLayerText, 'Layer not found: missing')

    const tracksResult = await handleListTracks({ scene: scenePath, nodeId: 'title' })
    const tracksText = tracksResult.content[0]?.type === 'text' ? tracksResult.content[0].text : ''
    const tracksPayload = JSON.parse(tracksText) as {
      tracks: Array<{ id: string; nodeId: string; propertyId: string }>
    }
    assert.equal(tracksPayload.tracks.length, 1)
    assert.equal(tracksPayload.tracks[0]?.id, 'fade-title')
    assert.equal(tracksPayload.tracks[0]?.nodeId, 'title')
    assert.equal(tracksPayload.tracks[0]?.propertyId, 'appearance.opacity')

    const allTracksResult = await handleListTracks({ scene: scenePath })
    const allTracksText =
      allTracksResult.content[0]?.type === 'text' ? allTracksResult.content[0].text : ''
    const allTracksPayload = JSON.parse(allTracksText) as {
      tracks: Array<{ id: string; nodeId: string; propertyId: string }>
    }
    assert.deepEqual(
      allTracksPayload.tracks.map((track) => track.id).sort(),
      ['fade-title', 'move-root'],
    )

    const unrelatedTracksResult = await handleListTracks({ scene: scenePath, nodeId: 'missing' })
    const unrelatedTracksText =
      unrelatedTracksResult.content[0]?.type === 'text' ? unrelatedTracksResult.content[0].text : ''
    const unrelatedTracksPayload = JSON.parse(unrelatedTracksText) as { tracks: unknown[] }
    assert.deepEqual(unrelatedTracksPayload.tracks, [])

    const camerasResult = await handleListCameras({ scene: scenePath })
    const camerasText = camerasResult.content[0]?.type === 'text' ? camerasResult.content[0].text : ''
    const camerasPayload = JSON.parse(camerasText) as {
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

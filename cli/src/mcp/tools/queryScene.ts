// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import { inspectScene } from '../../scene/build.js'

const SceneInput = z.object({ scene: z.string() })
const LayerInput = z.object({ scene: z.string(), nodeId: z.string() })
const TrackInput = z.object({ scene: z.string(), nodeId: z.string().optional() })
type QuerySceneToolName = 'list_layers' | 'get_layer' | 'list_tracks' | 'list_cameras'
type ReadSceneResult =
  | { ok: true; scene: Record<string, unknown> }
  | { ok: false; result: CallToolResult }
type LayerSummary = {
  id: unknown
  name: unknown
  kind: unknown
  parent: unknown
  children: unknown[]
}

const SCENE_PATH_PROPERTY = {
  type: 'string',
  description: 'Path to a .hype scene file.',
} as const

export const listLayersTool: Tool = {
  name: 'list_layers',
  description: 'List all scene layers with id, name, kind, parent, and children.',
  inputSchema: { type: 'object', properties: { scene: SCENE_PATH_PROPERTY }, required: ['scene'] },
}

export const getLayerTool: Tool = {
  name: 'get_layer',
  description: 'Return one layer/node by stable node id.',
  inputSchema: {
    type: 'object',
    properties: {
      scene: SCENE_PATH_PROPERTY,
      nodeId: { type: 'string', description: 'Stable layer/node id to return.' },
    },
    required: ['scene', 'nodeId'],
  },
}

export const listTracksTool: Tool = {
  name: 'list_tracks',
  description: 'List animation tracks, optionally filtered by node id.',
  inputSchema: {
    type: 'object',
    properties: {
      scene: SCENE_PATH_PROPERTY,
      nodeId: { type: 'string', description: 'Optional stable layer/node id to filter by.' },
    },
    required: ['scene'],
  },
}

export const listCamerasTool: Tool = {
  name: 'list_cameras',
  description: 'List camera nodes and the active camera id.',
  inputSchema: { type: 'object', properties: { scene: SCENE_PATH_PROPERTY }, required: ['scene'] },
}

export async function handleListLayers(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const parsed = SceneInput.safeParse(args)
  if (!parsed.success) return invalidArgs('list_layers', parsed.error.message)

  const loaded = read('list_layers', parsed.data.scene)
  if (!loaded.ok) return loaded.result

  const nodes = record(loaded.scene.nodes)
  return text({
    root: loaded.scene.root ?? null,
    activeCameraId: loaded.scene.activeCameraId ?? null,
    layers: Object.values(nodes).map((raw): LayerSummary => {
      const n = record(raw)
      return {
        id: n.id,
        name: n.name,
        kind: n.kind,
        parent: n.parent,
        children: Array.isArray(n.children) ? n.children : [],
      }
    }),
  })
}

export async function handleGetLayer(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const parsed = LayerInput.safeParse(args)
  if (!parsed.success) return invalidArgs('get_layer', parsed.error.message)

  const loaded = read('get_layer', parsed.data.scene)
  if (!loaded.ok) return loaded.result

  const node = record(record(loaded.scene.nodes)[parsed.data.nodeId])
  if (!node.id) return { isError: true, content: [{ type: 'text' as const, text: `Layer not found: ${parsed.data.nodeId}` }] }
  return text(node)
}

export async function handleListTracks(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const parsed = TrackInput.safeParse(args)
  if (!parsed.success) return invalidArgs('list_tracks', parsed.error.message)

  const loaded = read('list_tracks', parsed.data.scene)
  if (!loaded.ok) return loaded.result

  const tracks = Object.values(record(loaded.scene.tracks)).filter((raw) => {
    const t = record(raw)
    return parsed.data.nodeId ? t.nodeId === parsed.data.nodeId : true
  })
  return text({ tracks })
}

export async function handleListCameras(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const parsed = SceneInput.safeParse(args)
  if (!parsed.success) return invalidArgs('list_cameras', parsed.error.message)

  const loaded = read('list_cameras', parsed.data.scene)
  if (!loaded.ok) return loaded.result

  const cameras = Object.values(record(loaded.scene.nodes)).filter((raw) => record(raw).kind === 'camera')
  return text({ activeCameraId: loaded.scene.activeCameraId ?? null, cameras })
}

function read(toolName: QuerySceneToolName, scenePath: string): ReadSceneResult {
  try {
    return { ok: true, scene: inspectScene(new Uint8Array(fs.readFileSync(scenePath))) }
  } catch (err) {
    return {
      ok: false,
      result: {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `${toolName}: failed to read ${scenePath}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        ],
      },
    }
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown): CallToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function invalidArgs(toolName: QuerySceneToolName, message: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: `${toolName}: invalid arguments — ${message}`,
      },
    ],
  }
}

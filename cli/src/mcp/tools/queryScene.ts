// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import { inspectScene } from '../../scene/build.js'

const ScenePathInput = z.string().trim()
const SceneInput = z.object({ scene: ScenePathInput })
const NodeIdInput = z.string().trim().min(1, 'nodeId is required')
const LayerInput = z.object({ scene: ScenePathInput, nodeId: NodeIdInput })
const TrackInput = z.object({ scene: ScenePathInput, nodeId: NodeIdInput.optional() })
type SceneInputData = z.infer<typeof SceneInput>
type LayerInputData = z.infer<typeof LayerInput>
type TrackInputData = z.infer<typeof TrackInput>
type QuerySceneToolName = 'list_layers' | 'get_layer' | 'list_tracks' | 'list_cameras'
type StringSchemaProperty = {
  readonly type: 'string'
  readonly minLength?: number
  readonly pattern?: string
  readonly description: string
}
type QuerySceneSnapshot = {
  root?: unknown
  activeCameraId?: unknown
  nodes?: unknown
  tracks?: unknown
}
type ReadSceneResult =
  | { ok: true; scene: QuerySceneSnapshot }
  | { ok: false; result: CallToolResult }
type QuerySceneErrorMessage = `${QuerySceneToolName}: ${string}` | `Layer not found: ${string}`
type LayerSummary = {
  id: unknown
  name: unknown
  kind: unknown
  parent: unknown
  children: string[]
}

const SCENE_PATH_PROPERTY: StringSchemaProperty = {
  type: 'string',
  minLength: 1,
  pattern: '\\S',
  description: 'Path to a .hype scene file.',
}

const NODE_ID_PROPERTY: StringSchemaProperty = {
  type: 'string',
  minLength: 1,
  pattern: '\\S',
  description: 'Stable layer/node id to return.',
}

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
      nodeId: NODE_ID_PROPERTY,
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
      nodeId: {
        ...NODE_ID_PROPERTY,
        description: 'Optional stable layer/node id to filter by.',
      },
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

  const input: SceneInputData = parsed.data
  const loaded = read('list_layers', input.scene)
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
        children: stringArray(n.children),
      }
    }),
  })
}

export async function handleGetLayer(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const parsed = LayerInput.safeParse(args)
  if (!parsed.success) return invalidArgs('get_layer', parsed.error.message)

  const input: LayerInputData = parsed.data
  const loaded = read('get_layer', input.scene)
  if (!loaded.ok) return loaded.result

  const node = record(record(loaded.scene.nodes)[input.nodeId])
  if (!node.id) return errorText(`Layer not found: ${input.nodeId}`)
  return text(node)
}

export async function handleListTracks(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const parsed = TrackInput.safeParse(args)
  if (!parsed.success) return invalidArgs('list_tracks', parsed.error.message)

  const input: TrackInputData = parsed.data
  const loaded = read('list_tracks', input.scene)
  if (!loaded.ok) return loaded.result

  const tracks = Object.values(record(loaded.scene.tracks)).filter((raw) => {
    const t = record(raw)
    return input.nodeId ? t.nodeId === input.nodeId : true
  })
  return text({ tracks })
}

export async function handleListCameras(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const parsed = SceneInput.safeParse(args)
  if (!parsed.success) return invalidArgs('list_cameras', parsed.error.message)

  const input: SceneInputData = parsed.data
  const loaded = read('list_cameras', input.scene)
  if (!loaded.ok) return loaded.result

  const cameras = Object.values(record(loaded.scene.nodes)).filter((raw) => record(raw).kind === 'camera')
  return text({ activeCameraId: loaded.scene.activeCameraId ?? null, cameras })
}

function read(toolName: QuerySceneToolName, scenePath: string): ReadSceneResult {
  const normalizedScenePath = scenePath.trim()
  if (!normalizedScenePath) {
    return {
      ok: false,
      result: errorText(`${toolName}: scene path is required`),
    }
  }

  let bytes: Buffer
  try {
    const stats = fs.statSync(normalizedScenePath)
    if (!stats.isFile()) {
      return {
        ok: false,
        result: errorText(`${toolName}: scene path is not a file: ${normalizedScenePath}`),
      }
    }

    bytes = fs.readFileSync(normalizedScenePath)
  } catch (err) {
    return {
      ok: false,
      result: errorText(
        `${toolName}: failed to read ${normalizedScenePath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    }
  }

  try {
    return { ok: true, scene: inspectScene(new Uint8Array(bytes)) }
  } catch (err) {
    return {
      ok: false,
      result: errorText(
        `${toolName}: ${normalizedScenePath} is not a valid .hype file: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    }
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function text(value: unknown): CallToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function invalidArgs(toolName: QuerySceneToolName, message: string): CallToolResult {
  return errorText(`${toolName}: invalid arguments — ${message}`)
}

function errorText(message: QuerySceneErrorMessage): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  }
}

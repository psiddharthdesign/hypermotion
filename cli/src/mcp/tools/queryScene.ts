// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import path from 'node:path'
import { inspectScene } from '../../scene/build.js'
import type { McpToolArgs } from './schema.js'

const ScenePathInput = z.string().trim().min(1, 'scene path is required')
const SceneInput = z.object({ scene: ScenePathInput }).strict()
const NodeIdInput = z.string().trim().min(1, 'nodeId is required')
const LayerInput = z.object({ scene: ScenePathInput, nodeId: NodeIdInput }).strict()
const TrackInput = z.object({ scene: ScenePathInput, nodeId: NodeIdInput.optional() }).strict()
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
type ToolInputSchema = Tool['inputSchema']
type LayerSummary = {
  id: unknown
  name: unknown
  kind: unknown
  parent: unknown
  children: string[]
}
type CameraSummary = McpToolArgs & {
  id: string
  kind: 'camera'
}

const SCENE_PATH_PROPERTY: StringSchemaProperty = {
  type: 'string',
  minLength: 1,
  pattern: '\\S',
  description: 'Absolute or relative path to a .hype scene file.',
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
  inputSchema: {
    type: 'object',
    properties: { scene: SCENE_PATH_PROPERTY },
    required: ['scene'],
    additionalProperties: false,
  } satisfies ToolInputSchema,
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
    additionalProperties: false,
  } satisfies ToolInputSchema,
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
    additionalProperties: false,
  } satisfies ToolInputSchema,
}

export const listCamerasTool: Tool = {
  name: 'list_cameras',
  description: 'List camera nodes and the active camera id.',
  inputSchema: {
    type: 'object',
    properties: { scene: SCENE_PATH_PROPERTY },
    required: ['scene'],
    additionalProperties: false,
  } satisfies ToolInputSchema,
}

export async function handleListLayers(
  args: McpToolArgs,
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
    layers: Object.values(nodes)
      .filter(isRecord)
      .map((n): LayerSummary => ({
        id: n.id,
        name: n.name,
        kind: n.kind,
        parent: n.parent,
        children: stringArray(n.children),
      })),
  })
}

export async function handleGetLayer(
  args: McpToolArgs,
): Promise<CallToolResult> {
  const parsed = LayerInput.safeParse(args)
  if (!parsed.success) return invalidArgs('get_layer', parsed.error.message)

  const input: LayerInputData = parsed.data
  const loaded = read('get_layer', input.scene)
  if (!loaded.ok) return loaded.result

  const node = record(record(loaded.scene.nodes)[input.nodeId])
  if (node.id !== input.nodeId) return errorText(`Layer not found: ${input.nodeId}`)
  return text(node)
}

export async function handleListTracks(
  args: McpToolArgs,
): Promise<CallToolResult> {
  const parsed = TrackInput.safeParse(args)
  if (!parsed.success) return invalidArgs('list_tracks', parsed.error.message)

  const input: TrackInputData = parsed.data
  const loaded = read('list_tracks', input.scene)
  if (!loaded.ok) return loaded.result

  const tracks = Object.values(record(loaded.scene.tracks)).filter((raw) => {
    if (!isRecord(raw)) return false
    const t = record(raw)
    return input.nodeId ? t.nodeId === input.nodeId : true
  })
  return text({ tracks })
}

export async function handleListCameras(
  args: McpToolArgs,
): Promise<CallToolResult> {
  const parsed = SceneInput.safeParse(args)
  if (!parsed.success) return invalidArgs('list_cameras', parsed.error.message)

  const input: SceneInputData = parsed.data
  const loaded = read('list_cameras', input.scene)
  if (!loaded.ok) return loaded.result

  const cameras = Object.values(record(loaded.scene.nodes)).filter(isCameraNode)
  return text({ activeCameraId: loaded.scene.activeCameraId ?? null, cameras })
}

function read(toolName: QuerySceneToolName, scenePath: string): ReadSceneResult {
  const trimmedScenePath = scenePath.trim()
  if (!trimmedScenePath) {
    return {
      ok: false,
      result: errorText(`${toolName}: scene path is required`),
    }
  }
  const normalizedScenePath = path.resolve(trimmedScenePath)

  let bytes: Buffer
  try {
    if (!fs.existsSync(normalizedScenePath)) {
      return {
        ok: false,
        result: errorText(`${toolName}: scene file not found: ${normalizedScenePath}`),
      }
    }

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

function record(value: unknown): McpToolArgs {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as McpToolArgs)
    : {}
}

function isRecord(value: unknown): value is McpToolArgs {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isCameraNode(value: unknown): value is CameraSummary {
  return isRecord(value) && value.kind === 'camera' && typeof value.id === 'string'
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

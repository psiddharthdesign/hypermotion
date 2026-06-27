// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import { inspectScene } from '../../scene/build.js'

const SceneInput = z.object({ scene: z.string() })
const LayerInput = z.object({ scene: z.string(), nodeId: z.string() })
const TrackInput = z.object({ scene: z.string(), nodeId: z.string().optional() })

export const listLayersTool: Tool = {
  name: 'list_layers',
  description: 'List all scene layers with id, name, kind, parent, and children.',
  inputSchema: { type: 'object', properties: { scene: { type: 'string' } }, required: ['scene'] },
}

export const getLayerTool: Tool = {
  name: 'get_layer',
  description: 'Return one layer/node by stable node id.',
  inputSchema: {
    type: 'object',
    properties: { scene: { type: 'string' }, nodeId: { type: 'string' } },
    required: ['scene', 'nodeId'],
  },
}

export const listTracksTool: Tool = {
  name: 'list_tracks',
  description: 'List animation tracks, optionally filtered by node id.',
  inputSchema: {
    type: 'object',
    properties: { scene: { type: 'string' }, nodeId: { type: 'string' } },
    required: ['scene'],
  },
}

export const listCamerasTool: Tool = {
  name: 'list_cameras',
  description: 'List camera nodes and the active camera id.',
  inputSchema: { type: 'object', properties: { scene: { type: 'string' } }, required: ['scene'] },
}

export async function handleListLayers(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const parsed = SceneInput.safeParse(args)
  if (!parsed.success) return invalidArgs('list_layers', parsed.error.message)

  const scene = read(parsed.data.scene)
  const nodes = record(scene.nodes)
  return text({
    root: scene.root ?? null,
    activeCameraId: scene.activeCameraId ?? null,
    layers: Object.values(nodes).map((raw) => {
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

  const node = record(record(read(parsed.data.scene).nodes)[parsed.data.nodeId])
  if (!node.id) return { isError: true, content: [{ type: 'text' as const, text: `Layer not found: ${parsed.data.nodeId}` }] }
  return text(node)
}

export async function handleListTracks(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const parsed = TrackInput.safeParse(args)
  if (!parsed.success) return invalidArgs('list_tracks', parsed.error.message)

  const tracks = Object.values(record(read(parsed.data.scene).tracks)).filter((raw) => {
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

  const scene = read(parsed.data.scene)
  const cameras = Object.values(record(scene.nodes)).filter((raw) => record(raw).kind === 'camera')
  return text({ activeCameraId: scene.activeCameraId ?? null, cameras })
}

function read(scenePath: string): Record<string, unknown> {
  return inspectScene(new Uint8Array(fs.readFileSync(scenePath)))
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown): CallToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function invalidArgs(toolName: string, message: string): CallToolResult {
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

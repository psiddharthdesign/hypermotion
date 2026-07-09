// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import path from 'node:path'
import { applyScenePatch, type PatchOperation, type ScenePatch } from '../../scene/build.js'
import { pushSceneToRunningApp } from '../../electron/live.js'

const PatchInput = z.object({
  scene: z.string().trim().min(1, 'scene path is required').describe('Absolute or relative path to the input .hype scene file.'),
  output: z.string().trim().min(1, 'output path is required').optional().describe('Absolute or relative path to write. Defaults to overwriting scene.'),
  patch: z.union([z.string(), z.record(z.unknown()), z.array(z.record(z.unknown()))]),
  applyLive: z.boolean().optional().describe('Push the patched scene into the running desktop app. Defaults to true.'),
})
type PatchInputData = z.infer<typeof PatchInput>

export const patchSceneTool: Tool = {
  name: 'patch_scene',
  description:
    'Apply targeted patch operations to a .hype scene. Supports setMeta, setRoot, setActiveCameraId, createNode, deleteNode, setNode, setNodeProperty, appendChild, moveChild, setTrack, deleteTrack, setSection, deleteSection.',
  inputSchema: {
    type: 'object',
    properties: {
      scene: {
        type: 'string',
        minLength: 1,
        pattern: '\\S',
        description: 'Absolute or relative path to the input .hype scene file.',
      },
      output: {
        type: 'string',
        minLength: 1,
        pattern: '\\S',
        description: 'Absolute or relative path to write. Defaults to overwriting scene.',
      },
      patch: { description: 'Patch as { ops: [...] }, an operation array, or a JSON string.' },
      applyLive: {
        type: 'boolean',
        description: 'Push the patched scene into the running desktop app. Defaults to true.',
      },
    },
    required: ['scene', 'patch'],
  },
}

export async function handlePatchScene(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const parsed = PatchInput.safeParse(args)
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `patch_scene: invalid arguments — ${parsed.error.message}`,
        },
      ],
    }
  }

  const input: PatchInputData = parsed.data
  const output = path.resolve(input.output ?? input.scene)
  let patch: ScenePatch | PatchOperation[]
  try {
    patch =
      typeof input.patch === 'string'
        ? (JSON.parse(input.patch) as ScenePatch | PatchOperation[])
        : (input.patch as ScenePatch | PatchOperation[])
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `patch_scene: failed to parse patch JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }
  let bytes: Buffer
  try {
    bytes = fs.readFileSync(input.scene)
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `patch_scene: failed to read ${input.scene}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }
  let next: Uint8Array
  try {
    next = applyScenePatch(new Uint8Array(bytes), patch)
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `patch_scene: failed to apply patch: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, Buffer.from(next))
  const shouldApplyLive = input.applyLive ?? true
  const liveApplied = shouldApplyLive ? await pushSceneToRunningApp(output) : false
  return {
    content: [
      {
        type: 'text' as const,
        text: `Patched ${input.scene} → ${output}${liveApplied ? ' and applied it to the running desktop app' : ''}`,
      },
    ],
  }
}

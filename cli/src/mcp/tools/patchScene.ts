// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import path from 'node:path'
import { applyScenePatch, type PatchOperation, type ScenePatch } from '../../scene/build.js'
import { pushSceneToRunningApp } from '../../electron/live.js'

const PatchInput = z.object({
  scene: z.string().describe('Path to the input .hype scene file.'),
  output: z.string().optional().describe('Path to write. Defaults to overwriting scene.'),
  patch: z.union([z.string(), z.record(z.unknown()), z.array(z.record(z.unknown()))]),
  applyLive: z.boolean().optional().describe('Push the patched scene into the running desktop app. Defaults to true.'),
})

export const patchSceneTool: Tool = {
  name: 'patch_scene',
  description:
    'Apply targeted patch operations to a .hype scene. Supports setMeta, setRoot, setActiveCameraId, createNode, deleteNode, setNode, setNodeProperty, appendChild, moveChild, setTrack, deleteTrack, setSection, deleteSection.',
  inputSchema: {
    type: 'object',
    properties: {
      scene: { type: 'string', description: 'Path to the input .hype scene file.' },
      output: { type: 'string', description: 'Path to write. Defaults to overwriting scene.' },
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

  const output = path.resolve(parsed.data.output ?? parsed.data.scene)
  const patch =
    typeof parsed.data.patch === 'string'
      ? (JSON.parse(parsed.data.patch) as ScenePatch | PatchOperation[])
      : (parsed.data.patch as ScenePatch | PatchOperation[])
  const bytes = fs.readFileSync(parsed.data.scene)
  const next = applyScenePatch(new Uint8Array(bytes), patch)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, Buffer.from(next))
  const shouldApplyLive = parsed.data.applyLive ?? true
  const liveApplied = shouldApplyLive ? await pushSceneToRunningApp(output) : false
  return {
    content: [
      {
        type: 'text' as const,
        text: `Patched ${parsed.data.scene} → ${output}${liveApplied ? ' and applied it to the running desktop app' : ''}`,
      },
    ],
  }
}

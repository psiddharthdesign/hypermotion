// SPDX-License-Identifier: Apache-2.0

/**
 * `create_scene` MCP tool — build a `.hype` file from a JSON scene
 * description. This is the authoring entrypoint for AI agents: the
 * agent composes the scene as JSON (frames, auto-layout containers,
 * text nodes, tracks, keyframes), the tool serializes it into a
 * `.hype` byte stream the desktop app can open.
 *
 * The agent doesn't need to know about Y.Doc, CRDTs, or the desktop
 * app's internals. It only knows the JSON shape, which mirrors the
 * desktop's `Scene` type one-to-one.
 *
 * Common pattern:
 *
 *   1. Agent composes JSON for a layout (a card, a calendar, a list).
 *   2. Agent calls `create_scene` with the JSON and an output path.
 *   3. Agent calls `render_scene` with the same path → an MP4/WebM/GIF.
 *
 * Step 2 produces a file the user can ALSO open in the desktop app
 * for hand-editing, so this isn't a black box — it's a real authoring
 * surface that hands off cleanly to a human designer.
 */

import { z } from 'zod'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import path from 'node:path'
import { buildSceneBytes, type SceneJson } from '../../scene/build.js'

const CreateInput = z.object({
  output: z
    .string()
    .describe('Absolute path to write the .hype file to. Parent dirs are created if missing.'),
  scene: z
    .union([
      z.string().describe('A JSON string containing the SceneJson'),
      z.record(z.unknown()).describe('The SceneJson object directly'),
    ])
    .describe(
      'The scene to build. Either a JSON string OR an inline object matching the SceneJson schema.',
    ),
})

export const createSceneTool: Tool = {
  name: 'create_scene',
  description:
    "Build a hyper-motion .hype scene file from a JSON description. The agent " +
    "composes a SceneJson object (frames with auto-layout, text nodes, animation " +
    "tracks with keyframes), passes it here, and gets a .hype file the desktop app " +
    "can open. Use this BEFORE render_scene when the scene doesn't already exist.\n\n" +
    "SceneJson shape (top level): { meta?, root?, activeCameraId?, nodes, tracks?, sections? }\n" +
    "Each node: { id, kind: 'frame'|'rect'|'ellipse'|'text'|'image'|'video'|'audio'|'component'|'instance'|'camera', " +
    "parent: id|null, children?: id[], transform?, appearance?, size?, layout?, ...kind-specific }\n" +
    "Auto-layout frames take layout: { mode: 'flex', direction: 'row'|'column', justify, align, gap, padding }\n" +
    "Components can define variants, defaultSelection, variantOverrides, timelines, and interactions. " +
    "Instances point at componentId and carry selection, overrides, and instance-local interaction additions. " +
    "Component timelines are local tracks triggered by interactions, e.g. onClick -> playTimeline, and are scoped per instance.\n" +
    "Tracks: { id, nodeId, propertyId, keyframes?: [{ id, time, value, easingOut? }], defaultEasing? } — omitted keyframes default to [].\n" +
    "Camera nodes can include focalLength, fieldOfView, pointOfInterestX/Y/Z, nearClip, farClip, " +
    "depthOfField, focusWorldX/Y/Z, focusTargetNodeId, focusDistance, focusRadius, focusFalloff, aperture, iso, blurLevel, " +
    "blurQuality, and showFocusPlane.\n" +
    "Property IDs you can keyframe: transform.x, transform.y, transform.z, transform.rotation, " +
    "transform.rotationX, transform.rotationY, transform.scaleX, transform.scaleY, " +
    "camera.focusWorldX, camera.focusWorldY, camera.focusWorldZ, camera.focusDistance, camera.focusRadius, camera.focusFalloff, " +
    "camera.pointOfInterestX, camera.pointOfInterestY, camera.pointOfInterestZ, " +
    "camera.focalLength, camera.fieldOfView, camera.nearClip, camera.farClip, " +
    "camera.aperture, camera.blurLevel, camera.blurQuality, " +
    "appearance.opacity, appearance.cornerRadius, layout.gap, layout.padding.top, " +
    "layout.padding.right, layout.padding.bottom, layout.padding.left, size.width, size.height, " +
    "layout.direction, variant.\n\n" +
    "Include a 'camera' kind node (parent: null) plus a 'frame' kind root (parent: null) for the " +
    "scene to render. The artboard size lives in meta.canvas.width / height.",
  inputSchema: {
    type: 'object',
    properties: {
      output: {
        type: 'string',
        description: 'Absolute path to write the .hype file to.',
      },
      scene: {
        description:
          'The scene to build. Either a JSON string or an inline object matching SceneJson.',
      },
    },
    required: ['output', 'scene'],
  },
}

export async function handleCreateScene(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const parsed = CreateInput.safeParse(args)
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `create_scene: invalid arguments — ${parsed.error.message}`,
        },
      ],
    }
  }

  // Accept the scene either as an inline object or a JSON string.
  // Most MCP clients send objects, but some (and human users via the
  // CLI's inspector) find string-encoded JSON easier to construct.
  let scene: SceneJson
  try {
    scene =
      typeof parsed.data.scene === 'string'
        ? (JSON.parse(parsed.data.scene) as SceneJson)
        : (parsed.data.scene as SceneJson)
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `create_scene: 'scene' was a string but not valid JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }

  if (typeof scene !== 'object' || scene == null) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: 'create_scene: scene must be an object (or a JSON-encoded object).',
        },
      ],
    }
  }

  // Build the Y.Doc bytes.
  let bytes: Uint8Array
  try {
    bytes = buildSceneBytes(scene)
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `create_scene: failed to build scene: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }

  // Make sure the output's parent directory exists. Agents tend to
  // specify deep paths and we don't want a simple ENOENT to obscure
  // the actual failure.
  const outputPath = parsed.data.output
  try {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `create_scene: failed to create output directory: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }

  try {
    fs.writeFileSync(outputPath, Buffer.from(bytes))
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `create_scene: failed to write ${outputPath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }

  const layers = Object.keys(scene.nodes ?? {}).length
  const tracks = Object.keys(scene.tracks ?? {}).length
  return {
    content: [
      {
        type: 'text' as const,
        text:
          `Wrote ${outputPath} (${formatBytes(bytes.length)}, ${layers} layer${layers === 1 ? '' : 's'}, ${tracks} track${tracks === 1 ? '' : 's'}). ` +
          `Pass this path to render_scene to produce an MP4 / WebM / GIF, or open it in the desktop app for hand-editing.`,
      },
    ],
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

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
 * desktop's `Scene` type closely enough for file authoring.
 *
 * Common pattern:
 *
 *   1. Agent composes JSON for a layout (a card, a calendar, a list).
 *   2. Agent calls `create_scene` with the JSON and an output path.
 *   3. User opens that `.hype` in the desktop app, or `render_scene`
 *      exports the saved scene file directly to MP4/WebM/GIF.
 *
 * Step 2 produces a file the user can ALSO open in the desktop app
 * for hand-editing, so this isn't a black box — it's a real authoring
 * surface that hands off cleanly to a human designer.
 */

import { z } from 'zod'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import path from 'node:path'
import {
  PROPERTY_IDS,
  buildSceneBytes,
  readSceneSummary,
  type SceneJson,
} from '../../scene/build.js'
import { pushSceneToRunningApp } from '../../electron/live.js'

const CreateInput = z.object({
  output: z
    .string()
    .trim()
    .min(1, 'output path is required')
    .describe('Absolute path to write the .hype file to. Parent dirs are created if missing.'),
  scene: z
    .union([
      z.string().describe('A JSON string containing the SceneJson'),
      z.record(z.unknown()).describe('The SceneJson object directly'),
    ])
    .describe(
      'The scene to build. Either a JSON string OR an inline object matching the SceneJson schema.',
    ),
  open: z
    .boolean()
    .default(true)
    .describe('Open the newly-created scene in the desktop app. Defaults to true.'),
}).strict()
type CreateInputData = z.infer<typeof CreateInput>

const KEYFRAMEABLE_PROPERTY_DESCRIPTION = PROPERTY_IDS.join(', ')

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
    "Design scenes with auto-layout by default from the first frame onward. Prefer layout.mode: 'flex' for rows/columns " +
    "and layout.mode: 'grid' for grids; use fixed transforms or layout.mode: 'none' only when the user explicitly asks " +
    "for manual positioning or when a specific visual effect cannot be expressed with auto-layout. Inside auto-layout frames, " +
    "prefer height: 'hug' for content-driven groups and controls, width: 'fill' for rows/inputs/sections that should span " +
    "their container, and fixed dimensions only for artboards, icons, media, stable controls, or cases where hug/fill cannot express the layout. " +
    "For UI design work, use a 4-point or 8-point grid: spacing, padding, gaps, radii, and dimensions should generally be multiples of 4 or 8. " +
    "When a design calls for UI icons, use Lucide or Phosphor icon library assets; do not approximate icons with plain " +
    "text characters or ad hoc hand-drawn shapes unless the requested icon is unavailable and the fallback is called out. " +
    "Auto-layout frames take layout: { mode: 'flex', direction: 'row'|'column', justify, align, gap, padding }\n" +
    "Components can define variants, defaultSelection, variantOverrides, timelines, and interactions. " +
    "Instances point at componentId and carry selection, overrides, and instance-local interaction additions. " +
    "Component timelines are local tracks triggered by interactions, e.g. onClick -> playTimeline, and are scoped per instance.\n" +
    "Tracks: { id, nodeId, propertyId, keyframes?: [{ id, time, value, easingOut? }], defaultEasing?, textAnimation? } — omitted keyframes default to [].\n" +
    "Text animation tracks can include textAnimation with mode, applyTo ('layer'|'letters'|'words'|'lines'), order, delay, smoothing, duration, startTime, acceleration, easingPresetId, easingStrength, direction, travelDistance, and blurRadius.\n" +
    "Camera nodes can include focalLength, fieldOfView, pointOfInterestX/Y/Z, nearClip, farClip, " +
    "depthOfField, focusMode, focusWorldX/Y/Z, focusTargetNodeId, focusDistance, focusRadius, focusFalloff, aperture, iso, blurLevel, " +
    "blurQuality, and showFocusPlane. Hyper Motion currently supports only one camera node per scene; " +
    "keep it scene-level with parent: null, set activeCameraId to that camera id, do not list it in any frame/artboard children, " +
    "and default focalLength to 1000 unless the user explicitly requests a different camera/lens feel.\n" +
    `Property IDs you can keyframe: ${KEYFRAMEABLE_PROPERTY_DESCRIPTION}.\n\n` +
    "Include a 'frame' kind root (parent: null) for the scene to render. A scene-level 'camera' kind node " +
    "(parent: null) is optional unless the design needs camera properties. The artboard size lives in meta.canvas.width / height.",
  inputSchema: {
    type: 'object',
    properties: {
      output: {
        type: 'string',
        minLength: 1,
        pattern: '\\S',
        description: 'Absolute, non-blank path to write the .hype file to.',
      },
      scene: {
        anyOf: [{ type: 'string' }, { type: 'object' }],
        description:
          'The scene to build. Either a JSON string or an inline object matching SceneJson.',
      },
      open: {
        type: 'boolean',
        description: 'Open the newly-created scene in the desktop app. Defaults to true.',
        default: true,
      },
    },
    required: ['output', 'scene'],
    additionalProperties: false,
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
  // Most MCP clients send objects, but some agents and scripts find
  // string-encoded JSON easier to construct and pass through stdio.
  const input: CreateInputData = parsed.data
  let scene: unknown
  try {
    scene =
      typeof input.scene === 'string'
        ? JSON.parse(input.scene)
        : input.scene
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

  if (typeof scene !== 'object' || scene == null || Array.isArray(scene)) {
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

  // Make sure the output's parent directory exists. Agents tend to
  // specify deep paths and we don't want a simple ENOENT to obscure
  // the actual failure.
  const outputPath = input.output
  if (!path.isAbsolute(outputPath)) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: 'create_scene: output must be an absolute path.',
        },
      ],
    }
  }

  // Build the Y.Doc bytes.
  let bytes: Uint8Array
  try {
    bytes = buildSceneBytes(scene as SceneJson)
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

  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
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

  let outputStats: fs.Stats | undefined
  try {
    outputStats = fs.statSync(outputPath)
  } catch (err) {
    if (!(err instanceof Error) || (err as NodeJS.ErrnoException).code !== 'ENOENT') {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `create_scene: failed to inspect output path ${outputPath}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        ],
      }
    }
  }
  if (outputStats?.isDirectory()) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `create_scene: output path is a directory: ${outputPath}`,
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

  const summary = readSceneSummary(bytes)
  const layers = summary.layerCount
  const tracks = summary.trackCount
  const shouldOpen = input.open
  let opened = false
  let openNote = ''
  if (shouldOpen) {
    opened = await pushSceneToRunningApp(outputPath)
    if (!opened) {
      openNote = ' Desktop app was not found, so the scene was not opened.'
    }
  }
  return {
    content: [
      {
        type: 'text' as const,
        text:
          `Wrote ${outputPath} (${formatBytes(bytes.length)}, ${layers} layer${layers === 1 ? '' : 's'}, ${tracks} track${tracks === 1 ? '' : 's'}). ` +
          (opened
            ? 'Opened it in the desktop app.'
            : `Pass this path to render_scene to produce an MP4 / WebM / GIF, or open it in the desktop app for hand-editing.${openNote}`),
      },
    ],
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

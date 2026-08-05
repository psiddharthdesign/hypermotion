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
  PAPER_SHADER_TYPES,
  PROPERTY_IDS,
  buildSceneBytes,
  readSceneSummary,
  type SceneJson,
} from '../../scene/build.js'
import { pushSceneToRunningApp } from '../../electron/live.js'
import type { BooleanSchemaProperty, McpToolArgs, StringSchemaProperty } from './schema.js'

const OUTPUT_PATH_DESCRIPTION =
  'Absolute, non-blank path to write the .hype file to. Parent dirs are created if missing.'

const CreateInput = z.object({
  output: z
    .string()
    .trim()
    .min(1, 'output path is required')
    .describe(OUTPUT_PATH_DESCRIPTION),
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
type SceneSchemaProperty = {
  readonly anyOf: readonly [{ readonly type: 'string' }, { readonly type: 'object' }]
  readonly description: string
}

const KEYFRAMEABLE_PROPERTY_DESCRIPTION = [
  ...PROPERTY_IDS,
  'appearance.effects.<effectId>.blur',
].join(', ')

const OUTPUT_PATH_PROPERTY: StringSchemaProperty = {
  type: 'string',
  minLength: 1,
  pattern: '\\S',
  description: OUTPUT_PATH_DESCRIPTION,
}

const SCENE_PROPERTY: SceneSchemaProperty = {
  anyOf: [{ type: 'string' }, { type: 'object' }],
  description:
    'The scene to build. Either a JSON string or an inline object matching SceneJson.',
}

const OPEN_PROPERTY: BooleanSchemaProperty = {
  type: 'boolean',
  description: 'Open the newly-created scene in the desktop app. Defaults to true.',
  default: true,
}

export const createSceneTool: Tool = {
  name: 'create_scene',
  description:
    "Build a hyper-motion .hype scene file from a JSON description. The agent " +
    "composes a SceneJson object (frames with auto-layout, text nodes, animation " +
    "tracks with keyframes), passes it here, and gets a .hype file the desktop app " +
    "can open. Use this BEFORE render_scene when the scene doesn't already exist.\n\n" +
    "SceneJson shape (top level): { meta?, root?, activeCameraId?, compositionScenes?, sequenceItems?, sequenceOrder?, activeCompositionId?, sequenceSchemaVersion?, cameraIds?, defaultCameraId?, cameraCuts?, nodes, tracks?, sections? }\n" +
    "Each node: { id, kind: 'frame'|'rect'|'ellipse'|'text'|'image'|'shader'|'video'|'audio'|'component'|'instance'|'camera', " +
    "parent: id|null, children?: id[], transform?, appearance?, size?, layout?, motionPath?, ...kind-specific }\n" +
    "Ellipse nodes can include arc: { startAngle, sweep, innerRadius } for pie and donut charts. " +
    "startAngle is expressed in degrees (0 points right and positive angles turn clockwise); sweep and innerRadius are ratios in 0..1. " +
    "Animate this geometry with shape.arcStart, shape.arcSweep, and shape.arcInnerRadius tracks.\n" +
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
    `Shader nodes support all 29 Paper Shaders. shaderType is one of: ${PAPER_SHADER_TYPES.join(', ')}. ` +
    "Use colors for a shader's color array, speed in 0..2, scale in 0.1..4, and params for shader-specific JSON-serializable Paper props. " +
    "Image-consuming shaders accept sourceNodeId (another scene layer) or sourceImage (a data URL, URL, or absolute path). " +
    "Fluted Glass, Image Dithering, Halftone Dots, Halftone CMYK, and Heatmap require a source; Paper Texture, Water, Liquid Metal, and Gem Smoke accept one optionally. " +
    "Mesh Gradient remains backward-compatible with top-level distortion, swirl, and grain (Paper's grainOverlay), each in 0..1. " +
    "Its omitted values default to size 640x360, colors ['#e0eaff','#241d9a','#f75092','#9f50d3'], speed 0.6, scale 1, distortion 0.8, swirl 0.1, and grain 0.08. " +
    "Shader parameters are static node fields; " +
    "size, transform, and appearance properties remain animatable through ordinary tracks.\n" +
    "Tracks: { id, nodeId, propertyId, keyframes?: [{ id, time, value, easingOut?, easingPreset?: { presetId, strength } }], defaultEasing?, textAnimation? } — omitted keyframes default to [].\n" +
    "Visual layers can include motionPath: { version: 1, points: [{ id, t, x, y, z, inX, inY, inZ, outX, outY, outZ }], progress, autoOrient, rotationOffset, parameterization: 'parametric'|'arc-length' }. Coordinates are layer-local pixels, the first point is the transform origin, progress is 0..1, and motionPath.progress can be keyframed.\n" +
    "Text animation tracks can include textAnimation with mode, applyTo ('layer'|'letters'|'words'|'lines'), order, delay, smoothing ('none'|'soft'|'smooth' blends neighbouring profile samples), optional staggerCurve ({ version: 1, points: [{ id, x, y, inX, inY, outX, outY }] } defining a monotonic initial-to-final trail profile sampled by every segment as it travels across text), duration, startTime, acceleration, easingPresetId, easingStrength, direction, travelDistance, optional motionVector ({ x, y, z } per segment in line-height multiples; +X right, +Y down, +Z toward the viewer; null or omitted uses direction/travelDistance), optional motionPath ({ version: 1, points: [{ id, t, x, y, z, inX, inY, inZ, outX, outY, outZ }] } defining an editable cubic spatial route in line-height units; t=0 is the settled origin, t=1 is the authored start, +X right, +Y down, +Z toward the viewer; motionPath takes precedence over motionVector), and blurRadius.\n" +
    "Camera nodes can include focalLength, scrollSensitivity (0.1-2, default 1), fieldOfView, pointOfInterestX/Y/Z, nearClip, farClip, " +
    "depthOfField, focusMode, focusWorldX/Y/Z, focusTargetNodeId, focusDistance, focusRadius, focusFalloff, aperture (legacy strength), " +
    "fStop (default 2.8; lower values create more blur), bladeCount (3-16), bladeRotation, bokehRatio (0.25-4), " +
    "dofPreviewQuality ('draft'|'balanced'|'high'), iso, blurLevel, blurQuality (24-48 effective final export samples; default/minimum 24), " +
    "chromaticAberrationEnabled/Amount/Angle, bloomEnabled/Strength/Radius/Threshold, " +
    "vhsEnabled, vhsIntensity, vhsNoise, vhsScanlines, vhsColorBleed, and showFocusPlane. " +
    "Hyper Motion supports multiple camera nodes per scene. Keep every camera scene-level with parent: null and outside frame/artboard children. " +
    "Use cameraIds to declare the cameras owned by this scene (omitting it infers all camera nodes), defaultCameraId as the fallback before the first cut, " +
    "and cameraCuts keyed by cut id as { id, cameraId, time }, where time is scene-local seconds and the hard cut lasts until the next cut. " +
    "Cuts are resolved deterministically by (time, id), so same-time cuts are supported. " +
    "A null defaultCameraId means no preference and falls back to the first enabled owned camera; when omitted in legacy input it derives from activeCameraId first. " +
    "activeCameraId remains the current/legacy preview camera; when omitted while authoring it defaults to defaultCameraId, the first owned camera, or the first camera node. " +
    "Use the camera defaults and default focalLength to 1000 unless the user explicitly requests a different camera/lens feel.\n" +
    "For a multi-scene project, set sequenceSchemaVersion: 2 and author compositionScenes keyed by id as " +
    "{ id, name, rootNodeId, duration, workArea?: { start, end }, workspaceNodeIds?, cameraIds, defaultCameraId, cameraCuts }, with workArea and cameraCuts local to that composition. " +
    "Omitting workArea uses the complete composition. Master occurrences are intersected with the work area, so item trimStart/duration can narrow it but never reveal source outside it. " +
    "Use workspaceNodeIds only for parentless nodes marked workspaceOnly: true whose lifecycle belongs to that composition, such as generated component masters. " +
    "Unlisted pasteboard assets remain project-level and are preserved when a composition is deleted; duplicated compositions may intentionally share listed workspace assets. " +
    "All referenced roots, cameras, layers, and animation tracks remain project-global nodes/tracks; a camera must be owned by exactly one composition. " +
    "Author sequenceItems keyed by id as { id, sceneId, masterAudioMuted?: boolean, trimStart?, duration?, transitionOut?: { kind: 'cut'|'crossfade', duration } }, " +
    "Set masterAudioMuted: true to silence the project-level Master soundtrack during that occurrence; omission means audible. Across a crossfade, Master-audio gain follows the summed visual weight of unmuted occurrences, so mute boundaries ramp with the transition without doubling enabled audio. " +
    "A parentless audio node is a Master-owned soundtrack; audio parented under a composition root is a Scene-local overlay. Scene preview and Scene-only export borrow the selected occurrence at masterStart + sceneTime - sourceStart, while Scene overlays remain on the local clock. Projected Master beat/bar guides stay visible for Scene keyframe timing even when that occurrence's Master bed is muted. " +
    "put those item ids in sequenceOrder, and select activeCompositionId. A composition may occur more than once through separate sequence items. " +
    "The active composition is also projected into root, activeCameraId, and meta.duration for compatibility; when those legacy fields are omitted, create_scene fills the projection automatically. " +
    "Top-level cameraIds/defaultCameraId/cameraCuts are the legacy single-composition form; do not use them as composition ownership in a schema-v2 project. " +
    "Use list_scenes and get_sequence after authoring to inspect composition cameras/cuts, resolved transitions, and frame-aligned master duration.\n" +
    `Property IDs you can keyframe: ${KEYFRAMEABLE_PROPERTY_DESCRIPTION}.\n\n` +
    "Include a 'frame' kind root (parent: null) for the scene to render. A scene-level 'camera' kind node " +
    "(parent: null) is optional unless the design needs camera properties. The artboard size lives in meta.canvas.width / height.",
  inputSchema: {
    type: 'object',
    properties: {
      output: OUTPUT_PATH_PROPERTY,
      scene: SCENE_PROPERTY,
      open: OPEN_PROPERTY,
    },
    required: ['output', 'scene'],
    additionalProperties: false,
  },
}

export async function handleCreateScene(
  args: McpToolArgs,
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

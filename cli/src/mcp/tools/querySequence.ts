// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import path from 'node:path'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { inspectScene } from '../../scene/build.js'
import type { McpToolArgs, StringSchemaProperty } from './schema.js'

const DEFAULT_FRAME_RATE = 60
const LEGACY_SCENE_ID = 'legacy-scene'
const LEGACY_ITEM_ID = 'legacy-item'

const ScenePathInput = z.string().trim().min(1, 'scene path is required')
const SceneInput = z.object({ scene: ScenePathInput }).strict()
type SceneInputData = z.infer<typeof SceneInput>
type SequenceToolName = 'list_scenes' | 'get_sequence'
type ToolInputSchema = Tool['inputSchema']

interface NormalizedCameraCut {
  id: string
  cameraId: string
  time: number
}

interface NormalizedComposition {
  id: string
  name: string
  rootNodeId: string
  duration: number
  workArea: { start: number; end: number } | null
  cameraIds: string[]
  defaultCameraId: string | null
  cameraCuts: NormalizedCameraCut[]
}

interface NormalizedTransition {
  kind: 'cut' | 'crossfade'
  duration: number
}

interface NormalizedSequenceItem {
  id: string
  sceneId: string
  masterAudioMuted?: boolean
  trimStart?: number
  duration?: number
  holdDuration?: number
  transitionOut?: NormalizedTransition
  sourceIndex: number
}

interface SequenceIssue {
  code: string
  severity: 'warning' | 'error'
  message: string
  sceneId?: string
  itemId?: string
}

interface NormalizedProject {
  legacy: boolean
  schemaVersion: number | null
  activeCompositionId: string | null
  frameRate: number
  scenes: NormalizedComposition[]
  items: NormalizedSequenceItem[]
  issues: SequenceIssue[]
}

interface ResolvedItem {
  item: NormalizedSequenceItem
  scene: NormalizedComposition
  sequenceIndex: number
  sourceStartFrame: number
  sourceEndFrame: number
  sourceDurationFrames: number
  holdDurationFrames: number
  durationFrames: number
  masterStartFrame: number
  masterEndFrame: number
  transitionInFrames: number
  transitionOutFrames: number
}

interface ResolvedSequence {
  frameRate: number
  durationFrames: number
  items: ResolvedItem[]
  transitions: Array<{
    kind: 'crossfade'
    fromItemId: string
    toItemId: string
    durationFrames: number
    startFrame: number
    endFrame: number
  }>
  issues: SequenceIssue[]
}

const SCENE_PATH_PROPERTY: StringSchemaProperty = {
  type: 'string',
  minLength: 1,
  pattern: '\\S',
  description: 'Absolute or relative path to a .hype scene file.',
}

const INPUT_SCHEMA = {
  type: 'object',
  properties: { scene: SCENE_PATH_PROPERTY },
  required: ['scene'],
  additionalProperties: false,
} satisfies ToolInputSchema

export const listScenesTool: Tool = {
  name: 'list_scenes',
  description:
    'List compositions in master-sequence order, including duration, work area, owned cameras, local camera cuts, and occurrence ids. Legacy files are exposed as one synthetic composition.',
  inputSchema: INPUT_SCHEMA,
}

export const getSequenceTool: Tool = {
  name: 'get_sequence',
  description:
    'Return the frame-aligned master sequence after work-area/occurrence-trim intersection, resolved transitions, composition camera metadata, and total export duration. Legacy files are exposed as one sequence item.',
  inputSchema: INPUT_SCHEMA,
}

export async function handleListScenes(
  args: McpToolArgs,
): Promise<CallToolResult> {
  const parsed = SceneInput.safeParse(args)
  if (!parsed.success) {
    return invalidArgs('list_scenes', parsed.error.message)
  }
  const loaded = readScene('list_scenes', parsed.data)
  if (!loaded.ok) return loaded.result

  const project = normalizeProject(loaded.scene)
  return text({
    legacy: project.legacy,
    schemaVersion: project.schemaVersion,
    activeCompositionId: project.activeCompositionId,
    scenes: summarizeScenes(project),
    issues: project.issues,
  })
}

export async function handleGetSequence(
  args: McpToolArgs,
): Promise<CallToolResult> {
  const parsed = SceneInput.safeParse(args)
  if (!parsed.success) {
    return invalidArgs('get_sequence', parsed.error.message)
  }
  const loaded = readScene('get_sequence', parsed.data)
  if (!loaded.ok) return loaded.result

  const project = normalizeProject(loaded.scene)
  const resolved = resolveSequence(project)
  return text({
    legacy: project.legacy,
    schemaVersion: project.schemaVersion,
    activeCompositionId: project.activeCompositionId,
    frameRate: resolved.frameRate,
    masterDuration: framesToSeconds(
      resolved.durationFrames,
      resolved.frameRate,
    ),
    masterDurationFrames: resolved.durationFrames,
    items: resolved.items.map((entry) => ({
      id: entry.item.id,
      sceneId: entry.scene.id,
      sceneName: entry.scene.name,
      masterAudioMuted: entry.item.masterAudioMuted === true,
      sourceIndex: entry.item.sourceIndex,
      sequenceIndex: entry.sequenceIndex,
      sourceStart: framesToSeconds(
        entry.sourceStartFrame,
        resolved.frameRate,
      ),
      sourceEnd: framesToSeconds(entry.sourceEndFrame, resolved.frameRate),
      sourceDuration: framesToSeconds(
        entry.sourceDurationFrames,
        resolved.frameRate,
      ),
      sourceDurationFrames: entry.sourceDurationFrames,
      holdDuration: framesToSeconds(
        entry.holdDurationFrames,
        resolved.frameRate,
      ),
      holdDurationFrames: entry.holdDurationFrames,
      duration: framesToSeconds(entry.durationFrames, resolved.frameRate),
      durationFrames: entry.durationFrames,
      masterStart: framesToSeconds(
        entry.masterStartFrame,
        resolved.frameRate,
      ),
      masterEnd: framesToSeconds(entry.masterEndFrame, resolved.frameRate),
      masterStartFrame: entry.masterStartFrame,
      masterEndFrame: entry.masterEndFrame,
      transitionIn: framesToSeconds(
        entry.transitionInFrames,
        resolved.frameRate,
      ),
      transitionOut: framesToSeconds(
        entry.transitionOutFrames,
        resolved.frameRate,
      ),
      transitionOutRequest:
        entry.item.transitionOut ?? { kind: 'cut', duration: 0 },
    })),
    transitions: resolved.transitions.map((transition) => ({
      kind: transition.kind,
      fromItemId: transition.fromItemId,
      toItemId: transition.toItemId,
      duration: framesToSeconds(
        transition.durationFrames,
        resolved.frameRate,
      ),
      durationFrames: transition.durationFrames,
      start: framesToSeconds(transition.startFrame, resolved.frameRate),
      end: framesToSeconds(transition.endFrame, resolved.frameRate),
      startFrame: transition.startFrame,
      endFrame: transition.endFrame,
    })),
    scenes: summarizeScenes(project),
    issues: resolved.issues,
  })
}

function summarizeScenes(project: NormalizedProject): Array<{
  id: string
  name: string
  rootNodeId: string
  duration: number
  workArea: { start: number; end: number } | null
  cameraIds: string[]
  defaultCameraId: string | null
  cameraCount: number
  cameraCutCount: number
  cameraCuts: NormalizedCameraCut[]
  sequenceItemIds: string[]
  occurrenceCount: number
}> {
  return project.scenes.map((scene) => {
    const sequenceItemIds = project.items
      .filter((item) => item.sceneId === scene.id)
      .map((item) => item.id)
    return {
      id: scene.id,
      name: scene.name,
      rootNodeId: scene.rootNodeId,
      duration: scene.duration,
      workArea: scene.workArea,
      cameraIds: scene.cameraIds,
      defaultCameraId: scene.defaultCameraId,
      cameraCount: scene.cameraIds.length,
      cameraCutCount: scene.cameraCuts.length,
      cameraCuts: scene.cameraCuts,
      sequenceItemIds,
      occurrenceCount: sequenceItemIds.length,
    }
  })
}

function normalizeProject(scene: Record<string, unknown>): NormalizedProject {
  const issues: SequenceIssue[] = []
  const meta = record(scene.meta)
  const rawFrameRate = meta.frameRate
  const frameRate =
    typeof rawFrameRate === 'number' &&
    Number.isFinite(rawFrameRate) &&
    rawFrameRate > 0
      ? rawFrameRate
      : DEFAULT_FRAME_RATE
  if (frameRate !== rawFrameRate) {
    issues.push({
      code: 'invalid-frame-rate',
      severity: 'warning',
      message: `Invalid frame rate ${String(rawFrameRate)}; using ${frameRate}.`,
    })
  }

  const hasSequenceModel =
    Object.prototype.hasOwnProperty.call(scene, 'compositionScenes') ||
    Object.prototype.hasOwnProperty.call(scene, 'sequenceItems') ||
    Object.prototype.hasOwnProperty.call(scene, 'sequenceOrder') ||
    Object.prototype.hasOwnProperty.call(scene, 'activeCompositionId') ||
    Object.prototype.hasOwnProperty.call(scene, 'sequenceSchemaVersion')
  if (!hasSequenceModel) {
    return normalizeLegacyProject(scene, frameRate, issues)
  }

  const rawCompositions = record(scene.compositionScenes)
  const rawItems = record(scene.sequenceItems)
  const sceneById = new Map<string, NormalizedComposition>()
  for (const [mapKey, raw] of Object.entries(rawCompositions)) {
    const composition = record(raw)
    const id =
      typeof composition.id === 'string' && composition.id.length > 0
        ? composition.id
        : mapKey
    const normalized = normalizeComposition(id, composition)
    if (!sceneById.has(id)) {
      sceneById.set(id, normalized)
    } else {
      issues.push({
        code: 'duplicate-scene-id',
        severity: 'error',
        sceneId: id,
        message: `Duplicate composition id "${id}"; keeping the first.`,
      })
    }
  }

  const itemById = new Map<string, NormalizedSequenceItem>()
  let sourceIndex = 0
  for (const [mapKey, raw] of Object.entries(rawItems)) {
    const item = record(raw)
    const id =
      typeof item.id === 'string' && item.id.length > 0
        ? item.id
        : mapKey
    if (itemById.has(id)) {
      issues.push({
        code: 'duplicate-sequence-item-id',
        severity: 'error',
        itemId: id,
        message: `Duplicate sequence item id "${id}"; keeping the first.`,
      })
      continue
    }
    itemById.set(id, normalizeSequenceItem(id, item, sourceIndex))
    sourceIndex += 1
  }

  const items = orderedItems(scene.sequenceOrder, itemById, issues).map(
    (item, index) => ({ ...item, sourceIndex: index }),
  )
  const sceneOrder = new Map<string, number>()
  items.forEach((item, index) => {
    if (!sceneOrder.has(item.sceneId)) sceneOrder.set(item.sceneId, index)
  })
  const scenes = [...sceneById.values()]
    .map((composition, insertionIndex) => ({ composition, insertionIndex }))
    .sort(
      (a, b) =>
        (sceneOrder.get(a.composition.id) ?? Number.MAX_SAFE_INTEGER) -
          (sceneOrder.get(b.composition.id) ?? Number.MAX_SAFE_INTEGER) ||
        a.insertionIndex - b.insertionIndex,
    )
    .map(({ composition }) => composition)

  const schemaVersion =
    typeof scene.sequenceSchemaVersion === 'number' &&
    Number.isFinite(scene.sequenceSchemaVersion)
      ? scene.sequenceSchemaVersion
      : null
  const activeCompositionId =
    typeof scene.activeCompositionId === 'string' &&
    scene.activeCompositionId.length > 0
      ? scene.activeCompositionId
      : null
  return {
    legacy: false,
    schemaVersion,
    activeCompositionId,
    frameRate,
    scenes,
    items,
    issues,
  }
}

function normalizeLegacyProject(
  scene: Record<string, unknown>,
  frameRate: number,
  issues: SequenceIssue[],
): NormalizedProject {
  const meta = record(scene.meta)
  const nodes = record(scene.nodes)
  const nodeCameras = Object.values(nodes)
    .map(record)
    .filter(
      (node) =>
        node.kind === 'camera' &&
        typeof node.id === 'string' &&
        node.id.length > 0,
    )
  const declaredCameraIds = stringArray(scene.cameraIds)
  const cameraIds =
    Array.isArray(scene.cameraIds)
      ? declaredCameraIds
      : nodeCameras.map((camera) => camera.id as string)
  const activeCameraId =
    typeof scene.activeCameraId === 'string' &&
    scene.activeCameraId.length > 0
      ? scene.activeCameraId
      : null
  const explicitDefaultCameraId =
    typeof scene.defaultCameraId === 'string' &&
    scene.defaultCameraId.length > 0
      ? scene.defaultCameraId
      : null
  const id =
    typeof scene.activeCompositionId === 'string' &&
    scene.activeCompositionId.length > 0
      ? scene.activeCompositionId
      : LEGACY_SCENE_ID
  const composition: NormalizedComposition = {
    id,
    name:
      typeof meta.name === 'string' && meta.name.trim().length > 0
        ? meta.name
        : 'Untitled',
    rootNodeId: typeof scene.root === 'string' ? scene.root : '',
    duration: finiteNumber(meta.duration, 0),
    workArea: null,
    cameraIds,
    defaultCameraId:
      explicitDefaultCameraId ?? activeCameraId ?? cameraIds[0] ?? null,
    cameraCuts: normalizeCameraCuts(record(scene.cameraCuts)),
  }
  return {
    legacy: true,
    schemaVersion: null,
    activeCompositionId: composition.id,
    frameRate,
    scenes: [composition],
    items: [
      {
        id: LEGACY_ITEM_ID,
        sceneId: composition.id,
        trimStart: 0,
        transitionOut: { kind: 'cut', duration: 0 },
        sourceIndex: 0,
      },
    ],
    issues,
  }
}

function normalizeComposition(
  id: string,
  raw: Record<string, unknown>,
): NormalizedComposition {
  const duration = finiteNumber(raw.duration, 0)
  const rawWorkArea = record(raw.workArea)
  const workArea =
    raw.workArea !== undefined &&
    typeof rawWorkArea.start === 'number' &&
    Number.isFinite(rawWorkArea.start) &&
    typeof rawWorkArea.end === 'number' &&
    Number.isFinite(rawWorkArea.end) &&
    rawWorkArea.start >= 0 &&
    rawWorkArea.end > rawWorkArea.start &&
    rawWorkArea.end <= duration
      ? { start: rawWorkArea.start, end: rawWorkArea.end }
      : null
  return {
    id,
    name:
      typeof raw.name === 'string' && raw.name.trim().length > 0
        ? raw.name
        : id,
    rootNodeId: typeof raw.rootNodeId === 'string' ? raw.rootNodeId : '',
    duration,
    workArea,
    cameraIds: stringArray(raw.cameraIds),
    defaultCameraId:
      typeof raw.defaultCameraId === 'string' &&
      raw.defaultCameraId.length > 0
        ? raw.defaultCameraId
        : null,
    cameraCuts: normalizeCameraCuts(record(raw.cameraCuts)),
  }
}

function normalizeCameraCuts(
  rawCuts: Record<string, unknown>,
): NormalizedCameraCut[] {
  return Object.entries(rawCuts)
    .map(([mapKey, raw]) => {
      const cut = record(raw)
      return {
        id:
          typeof cut.id === 'string' && cut.id.length > 0 ? cut.id : mapKey,
        cameraId: typeof cut.cameraId === 'string' ? cut.cameraId : '',
        time: finiteNumber(cut.time, 0),
      }
    })
    .sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time
      if (a.id < b.id) return -1
      if (a.id > b.id) return 1
      return 0
    })
}

function normalizeSequenceItem(
  id: string,
  raw: Record<string, unknown>,
  sourceIndex: number,
): NormalizedSequenceItem {
  const transition = record(raw.transitionOut)
  let transitionOut: NormalizedTransition | undefined
  if (transition.kind === 'cut' || transition.kind === 'crossfade') {
    transitionOut = {
      kind: transition.kind,
      duration: finiteNumber(transition.duration, 0),
    }
  }
  return {
    id,
    sceneId: typeof raw.sceneId === 'string' ? raw.sceneId : '',
    masterAudioMuted: raw.masterAudioMuted === true ? true : undefined,
    trimStart:
      typeof raw.trimStart === 'number' ? raw.trimStart : undefined,
    duration: typeof raw.duration === 'number' ? raw.duration : undefined,
    holdDuration:
      typeof raw.holdDuration === 'number' ? raw.holdDuration : undefined,
    transitionOut,
    sourceIndex,
  }
}

function orderedItems(
  rawOrder: unknown,
  itemById: ReadonlyMap<string, NormalizedSequenceItem>,
  issues: SequenceIssue[],
): NormalizedSequenceItem[] {
  const result: NormalizedSequenceItem[] = []
  const seen = new Set<string>()
  if (Array.isArray(rawOrder)) {
    for (const rawId of rawOrder) {
      if (typeof rawId !== 'string' || seen.has(rawId)) continue
      seen.add(rawId)
      const item = itemById.get(rawId)
      if (item) {
        result.push(item)
      } else {
        issues.push({
          code: 'missing-sequence-item',
          severity: 'error',
          itemId: rawId,
          message: `Sequence order references missing item "${rawId}".`,
        })
      }
    }
  }
  for (const [id, item] of itemById) {
    if (seen.has(id)) continue
    result.push(item)
  }
  return result
}

function resolveSequence(project: NormalizedProject): ResolvedSequence {
  const issues = [...project.issues]
  const sceneById = new Map(project.scenes.map((scene) => [scene.id, scene]))
  const timings: Array<{
    item: NormalizedSequenceItem
    scene: NormalizedComposition
    durationFrames: number
    sourceStartFrame: number
    sourceEndFrame: number
    sourceDurationFrames: number
    holdDurationFrames: number
  }> = []

  for (const item of project.items) {
    const scene = sceneById.get(item.sceneId)
    if (!scene) {
      issues.push({
        code: 'missing-scene',
        severity: 'error',
        itemId: item.id,
        sceneId: item.sceneId,
        message: `Sequence item "${item.id}" references missing scene "${item.sceneId}".`,
      })
      continue
    }
    const sceneDurationFrames =
      Number.isFinite(scene.duration) && scene.duration > 0
        ? Math.max(1, secondsToFrames(scene.duration, project.frameRate))
        : 0
    if (sceneDurationFrames === 0) {
      issues.push({
        code: 'empty-item',
        severity: 'warning',
        itemId: item.id,
        sceneId: scene.id,
        message: `Sequence item "${item.id}" has no renderable duration.`,
      })
      continue
    }

    const rawTrimStart = item.trimStart ?? 0
    const requestedStartFrame = secondsToFrames(
      finiteNumber(rawTrimStart, 0),
      project.frameRate,
    )
    const sourceStartFrame = clamp(
      requestedStartFrame,
      0,
      sceneDurationFrames,
    )
    if (
      !Number.isFinite(rawTrimStart) ||
      sourceStartFrame !== requestedStartFrame
    ) {
      issues.push({
        code: 'trim-clamped',
        severity: 'warning',
        itemId: item.id,
        sceneId: scene.id,
        message: `Sequence item "${item.id}" trim start was clamped to the scene range.`,
      })
    }
    const availableSceneFrames = sceneDurationFrames - sourceStartFrame
    if (availableSceneFrames <= 0) {
      issues.push({
        code: 'empty-item',
        severity: 'warning',
        itemId: item.id,
        sceneId: scene.id,
        message: `Sequence item "${item.id}" starts at the scene end.`,
      })
      continue
    }

    const durationResolution = resolveDurationFrames(
      item.duration,
      availableSceneFrames,
      project.frameRate,
    )
    if (durationResolution.clamped) {
      issues.push({
        code: 'duration-clamped',
        severity: 'warning',
        itemId: item.id,
        sceneId: scene.id,
        message: `Sequence item "${item.id}" duration was clamped.`,
      })
    }
    const workAreaStartFrame = scene.workArea
      ? clamp(
          Math.floor(scene.workArea.start * project.frameRate + 1e-9),
          0,
          sceneDurationFrames,
        )
      : 0
    const workAreaEndFrame = scene.workArea
      ? clamp(
          Math.ceil(scene.workArea.end * project.frameRate - 1e-9),
          0,
          sceneDurationFrames,
        )
      : sceneDurationFrames
    const requestedEndFrame =
      sourceStartFrame + durationResolution.frames
    const intersectedStartFrame = Math.max(
      sourceStartFrame,
      workAreaStartFrame,
    )
    const intersectedEndFrame = Math.min(
      requestedEndFrame,
      workAreaEndFrame,
    )
    if (intersectedEndFrame <= intersectedStartFrame) {
      issues.push({
        code: 'empty-item',
        severity: 'warning',
        itemId: item.id,
        sceneId: scene.id,
        message: `Sequence item "${item.id}" does not intersect scene "${scene.id}"'s work area.`,
      })
      continue
    }
    const sourceDurationFrames = intersectedEndFrame - intersectedStartFrame
    const holdResolution = resolveHoldDurationFrames(
      item.holdDuration,
      project.frameRate,
    )
    if (holdResolution.clamped) {
      issues.push({
        code: 'hold-duration-clamped',
        severity: 'warning',
        itemId: item.id,
        sceneId: scene.id,
        message: `Sequence item "${item.id}" hold duration was clamped.`,
      })
    }
    timings.push({
      item,
      scene,
      durationFrames: sourceDurationFrames + holdResolution.frames,
      sourceStartFrame: intersectedStartFrame,
      sourceEndFrame: intersectedEndFrame,
      sourceDurationFrames,
      holdDurationFrames: holdResolution.frames,
    })
  }

  const transitionFrames: number[] = []
  for (let index = 0; index + 1 < timings.length; index += 1) {
    const current = timings[index]!
    const next = timings[index + 1]!
    const transition = current.item.transitionOut
    if (!transition || transition.kind === 'cut') {
      transitionFrames.push(0)
      continue
    }
    const requestedFrames =
      Number.isFinite(transition.duration) && transition.duration > 0
        ? Math.max(
            1,
            secondsToFrames(transition.duration, project.frameRate),
          )
        : 0
    const incomingFrames =
      index > 0 ? transitionFrames[index - 1] ?? 0 : 0
    const maximumFrames = Math.min(
      Math.max(0, current.durationFrames - incomingFrames),
      next.durationFrames,
    )
    const frames = Math.min(requestedFrames, maximumFrames)
    transitionFrames.push(frames)
    if (
      !Number.isFinite(transition.duration) ||
      transition.duration < 0 ||
      frames !== requestedFrames
    ) {
      issues.push({
        code: 'transition-clamped',
        severity: 'warning',
        itemId: current.item.id,
        sceneId: current.scene.id,
        message: `Transition leaving sequence item "${current.item.id}" was clamped.`,
      })
    }
  }

  const items: ResolvedItem[] = []
  const transitions: ResolvedSequence['transitions'] = []
  let nextMasterStartFrame = 0
  timings.forEach((timing, index) => {
    const transitionInFrames =
      index > 0 ? transitionFrames[index - 1] ?? 0 : 0
    const transitionOutFrames = transitionFrames[index] ?? 0
    const masterStartFrame = nextMasterStartFrame
    const masterEndFrame = masterStartFrame + timing.durationFrames
    items.push({
      ...timing,
      sequenceIndex: items.length,
      masterStartFrame,
      masterEndFrame,
      transitionInFrames,
      transitionOutFrames,
    })
    const next = timings[index + 1]
    if (transitionOutFrames > 0 && next) {
      transitions.push({
        kind: 'crossfade',
        fromItemId: timing.item.id,
        toItemId: next.item.id,
        durationFrames: transitionOutFrames,
        startFrame: masterEndFrame - transitionOutFrames,
        endFrame: masterEndFrame,
      })
    }
    nextMasterStartFrame = masterEndFrame - transitionOutFrames
  })

  return {
    frameRate: project.frameRate,
    durationFrames: items.at(-1)?.masterEndFrame ?? 0,
    items,
    transitions,
    issues,
  }
}

function resolveDurationFrames(
  requestedDuration: number | undefined,
  availableFrames: number,
  frameRate: number,
): { frames: number; clamped: boolean } {
  if (requestedDuration === undefined) {
    return { frames: availableFrames, clamped: false }
  }
  if (!Number.isFinite(requestedDuration) || requestedDuration <= 0) {
    return { frames: Math.min(1, availableFrames), clamped: true }
  }
  const requestedFrames = Math.max(
    1,
    secondsToFrames(requestedDuration, frameRate),
  )
  const frames = Math.min(requestedFrames, availableFrames)
  return { frames, clamped: frames !== requestedFrames }
}

function resolveHoldDurationFrames(
  requestedDuration: number | undefined,
  frameRate: number,
): { frames: number; clamped: boolean } {
  if (requestedDuration === undefined || requestedDuration === 0) {
    return { frames: 0, clamped: false }
  }
  if (!Number.isFinite(requestedDuration) || requestedDuration < 0) {
    return { frames: 0, clamped: true }
  }
  return {
    frames: Math.max(0, secondsToFrames(requestedDuration, frameRate)),
    clamped: false,
  }
}

function readScene(
  toolName: SequenceToolName,
  input: SceneInputData,
):
  | { ok: true; scene: Record<string, unknown> }
  | { ok: false; result: CallToolResult } {
  const normalizedScenePath = path.resolve(input.scene.trim())
  let bytes: Buffer
  try {
    if (!fs.existsSync(normalizedScenePath)) {
      return {
        ok: false,
        result: errorText(
          `${toolName}: scene file not found: ${normalizedScenePath}`,
        ),
      }
    }
    const stats = fs.statSync(normalizedScenePath)
    if (!stats.isFile()) {
      return {
        ok: false,
        result: errorText(
          `${toolName}: scene path is not a file: ${normalizedScenePath}`,
        ),
      }
    }
    bytes = fs.readFileSync(normalizedScenePath)
  } catch (error) {
    return {
      ok: false,
      result: errorText(
        `${toolName}: failed to read ${normalizedScenePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    }
  }
  try {
    return {
      ok: true,
      scene: inspectScene(new Uint8Array(bytes)),
    }
  } catch (error) {
    return {
      ok: false,
      result: errorText(
        `${toolName}: ${normalizedScenePath} is not a valid .hype file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    }
  }
}

function secondsToFrames(seconds: number, frameRate: number): number {
  return Math.round((Number.isFinite(seconds) ? seconds : 0) * frameRate)
}

function framesToSeconds(frames: number, frameRate: number): number {
  return frames / frameRate
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function invalidArgs(
  toolName: SequenceToolName,
  message: string,
): CallToolResult {
  return errorText(`${toolName}: invalid arguments — ${message}`)
}

function text(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  }
}

function errorText(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  }
}

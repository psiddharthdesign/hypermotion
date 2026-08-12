// SPDX-License-Identifier: Apache-2.0

/**
 * Pure sequence-domain types.
 *
 * This module deliberately has no Yjs, React, renderer, or Electron
 * dependencies. Persistence and UI adapters can therefore share the same
 * timing contract with headless export and the CLI.
 */

export type CompositionSceneId = string
export type SequenceItemId = string
export type GlobalNodeId = string
export type CameraId = GlobalNodeId
export type CameraCutId = string

/**
 * A program-camera edit in composition-local time.
 *
 * Node ids are project-global. That lets render and editor caches use a camera
 * id without pairing it with a scene id, and prevents ambiguous cut targets.
 */
export interface CameraCut {
  id: CameraCutId
  /** Composition-local time in seconds. */
  time: number
  cameraId: CameraId
}

/** Persistence-friendly camera-cut collection. */
export type CameraCutMap = Readonly<Record<CameraCutId, CameraCut>>

/** Accepted by pure helpers so callers do not need to allocate a record. */
export type CameraCutCollection = CameraCutMap | readonly CameraCut[]

/** A composition-local source window used by preview and Master assembly. */
export interface CompositionWorkArea {
  /** Inclusive source in-point in composition-local seconds. */
  start: number
  /** Exclusive source out-point in composition-local seconds. */
  end: number
}

/**
 * An independently authored composition used by one or more sequence items.
 *
 * `rootNodeId` and every `cameraIds` entry must be globally unique within the
 * project. `defaultCameraId` may be null for resilient loading, although normal
 * authoring keeps at least one enabled camera in every composition.
 */
export interface CompositionScene {
  id: CompositionSceneId
  name: string
  rootNodeId: GlobalNodeId
  /** Authored composition duration in seconds. */
  duration: number
  /**
   * Optional authored work area. When omitted, the complete composition is
   * active. Master occurrences are always intersected with this window; their
   * own trim/duration can narrow it, but can never reveal source outside it.
   */
  workArea?: CompositionWorkArea
  /**
   * Parentless pasteboard assets owned by this composition.
   *
   * Assets may be shared by duplicated compositions. Deleting a composition
   * removes an owned asset only after the final owning composition is gone.
   * Omitted for legacy projects, whose workspace assets remain unowned and
   * therefore are never removed as a side effect of scene deletion.
   */
  workspaceNodeIds?: readonly GlobalNodeId[]
  cameraIds: readonly CameraId[]
  defaultCameraId: CameraId | null
  cameraCuts: CameraCutMap
}

export type SequenceTransitionKind = 'cut' | 'crossfade'

/**
 * The transition leaving a sequence item.
 *
 * A cut always resolves to zero overlap. Crossfade duration is clamped to the
 * available tails of the adjacent items so at most two compositions are
 * active at any master-timeline instant.
 */
export interface SequenceTransition {
  kind: SequenceTransitionKind
  /** Requested overlap in seconds. */
  duration: number
}

/**
 * One ordered use of a composition on the master timeline.
 *
 * A scene can appear more than once. `trimStart` and `duration` are optional
 * so the common case uses the composition work area (or the complete
 * composition when no work area is authored). Explicit occurrence trims are
 * intersected with the work area and therefore only narrow that source window.
 */
export interface SequenceItem {
  id: SequenceItemId
  sceneId: CompositionSceneId
  /**
   * Mute the project-level Master soundtrack for this occurrence.
   *
   * Omitted and false are equivalent. During a crossfade the soundtrack gain
   * follows the summed contribution of the unmuted occurrences, so edits
   * between muted and unmuted scenes ramp smoothly with the visual transition.
   */
  masterAudioMuted?: boolean
  /** Composition-local in point in seconds. Defaults to zero. */
  trimStart?: number
  /**
   * Visible source duration in seconds. Defaults to the remaining composition
   * duration after `trimStart`.
   */
  duration?: number
  /**
   * Optional freeze-frame tail appended after the visible source range.
   *
   * This extends the occurrence on the Master timeline without changing the
   * owning composition's authored duration. The final source frame remains
   * active throughout the hold. Missing and zero are equivalent.
   */
  holdDuration?: number
  /** Transition from this item to the next resolved item. */
  transitionOut?: SequenceTransition
}

export type FrameRounding = 'nearest' | 'floor' | 'ceil'
export type MasterTimeQuantization = FrameRounding | 'none'

export type SequenceTimeMapIssueCode =
  | 'invalid-frame-rate'
  | 'invalid-scene-id'
  | 'duplicate-scene-id'
  | 'invalid-sequence-item-id'
  | 'duplicate-sequence-item-id'
  | 'duplicate-global-node-id'
  | 'missing-scene'
  | 'invalid-scene-duration'
  | 'work-area-clamped'
  | 'invalid-root-node-id'
  | 'invalid-camera-id'
  | 'duplicate-camera-id'
  | 'default-camera-not-owned'
  | 'camera-cut-target-not-owned'
  | 'trim-clamped'
  | 'duration-clamped'
  | 'empty-item'
  | 'transition-clamped'

export interface SequenceTimeMapIssue {
  code: SequenceTimeMapIssueCode
  severity: 'warning' | 'error'
  message: string
  sceneId?: CompositionSceneId
  itemId?: SequenceItemId
  cameraId?: CameraId
  cameraCutId?: CameraCutId
}

export interface BuildSequenceTimeMapInput {
  scenes: readonly CompositionScene[]
  /** Master-timeline order. */
  items: readonly SequenceItem[]
  frameRate: number
}

/** A frame-aligned sequence item ready for editor or renderer consumption. */
export interface ResolvedSequenceItem {
  item: SequenceItem
  scene: CompositionScene
  /** Index in the original `BuildSequenceTimeMapInput.items` array. */
  sourceIndex: number
  /** Index after invalid or empty items have been omitted. */
  sequenceIndex: number
  sourceStartFrame: number
  sourceEndFrame: number
  /** Renderable source frames before any trailing freeze-frame hold. */
  sourceDurationFrames: number
  /** Trailing freeze-frame frames on the Master timeline. */
  holdDurationFrames: number
  /** Total Master occurrence span, including `holdDurationFrames`. */
  durationFrames: number
  sourceStart: number
  sourceEnd: number
  sourceDuration: number
  holdDuration: number
  /** Total Master occurrence span, including `holdDuration`. */
  duration: number
  masterStartFrame: number
  masterEndFrame: number
  masterStart: number
  masterEnd: number
  transitionInFrames: number
  transitionOutFrames: number
  transitionIn: number
  transitionOut: number
}

export interface ResolvedSequenceTransition {
  kind: Exclude<SequenceTransitionKind, 'cut'>
  fromItemId: SequenceItemId
  toItemId: SequenceItemId
  durationFrames: number
  startFrame: number
  endFrame: number
  duration: number
  start: number
  end: number
}

export interface SequenceTimeMap {
  frameRate: number
  durationFrames: number
  duration: number
  items: readonly ResolvedSequenceItem[]
  transitions: readonly ResolvedSequenceTransition[]
  issues: readonly SequenceTimeMapIssue[]
}

export type ResolvedSequenceLayerRole = 'single' | 'outgoing' | 'incoming'

/** One composition contribution at a resolved master-timeline instant. */
export interface ResolvedSequenceLayer {
  item: ResolvedSequenceItem
  role: ResolvedSequenceLayerRole
  /** Composition-local render time, clamped to the item's source range. */
  localTime: number
  /** Compositing contribution in the inclusive range 0..1. */
  weight: number
  /** 0..1 while in a transition, otherwise null. */
  transitionProgress: number | null
}

export interface MasterTimeResolution {
  /** Sanitized and optionally frame-quantized master time. */
  masterTime: number
  masterFrame: number
  /** Null outside a transition. */
  transition: ResolvedSequenceTransition | null
  /** Render order: outgoing first, incoming second. */
  layers: readonly ResolvedSequenceLayer[]
}

export interface ResolveMasterTimeOptions {
  /** Defaults to `none` for smooth interactive playback. */
  quantize?: MasterTimeQuantization
  /** Defaults to true. */
  clamp?: boolean
}

export interface ProgramCameraDescriptor {
  id: CameraId
  /** Missing means enabled for compatibility with legacy camera nodes. */
  enabled?: boolean
}

export type ProgramCameraResolutionSource =
  | 'cut'
  | 'earlier-cut'
  | 'default'
  | 'fallback'
  | 'first-enabled'
  | 'none'

export interface ResolveProgramCameraInput {
  scene: CompositionScene
  localTime: number
  cameras: readonly ProgramCameraDescriptor[]
  /**
   * Optional adapter-provided last-known-safe camera. It is considered after
   * the scene default and before the first enabled owned camera.
   */
  fallbackCameraId?: CameraId | null
  /** Quantizes cuts and local time when provided. */
  frameRate?: number
}

export interface ProgramCameraResolution {
  cameraId: CameraId | null
  source: ProgramCameraResolutionSource
  /** Latest authored cut at or before local time, even when unusable. */
  requestedCut: CameraCut | null
  /** The cut actually supplying `cameraId`, if any. */
  resolvedCut: CameraCut | null
  /** Why `requestedCut` could not be used. */
  requestedCutFailure: 'missing' | 'disabled' | 'not-owned' | null
}

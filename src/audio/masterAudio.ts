// SPDX-License-Identifier: Apache-2.0

import type { SceneNode } from '@/scene'
import {
  normalizeFrameRate,
  quantizeTimeToFrame,
  resolveMasterTime,
  type SequenceTimeMap,
} from '@/sequence'

export type MasterAudioNode = Extract<SceneNode, { kind: 'audio' }>

export type MasterAudioEditMode = 'move' | 'trim-start' | 'trim-end'

export interface MasterAudioClipWindow {
  startTime: number
  trimStart: number
  trimEnd: number
}

/**
 * Audio is a project/master asset in the sequence model.
 *
 * It deliberately has no composition parent. Scene roots own visual media
 * such as video layers; a parentless audio node follows master time exactly
 * once regardless of how many scenes the sequence contains.
 */
export function isMasterAudioNode(
  node: SceneNode | null | undefined,
): node is MasterAudioNode {
  return node?.kind === 'audio' && node.parent === null
}

/**
 * Scene timelines expose visual media and parented audio overlays owned by
 * that composition. Parentless audio remains Master-owned and must not become
 * an editable Scene clip.
 */
export function isSceneTimelineMediaNode(
  node: SceneNode | null | undefined,
  activeTreeNodeIds: ReadonlySet<string>,
): node is Extract<SceneNode, { kind: 'audio' | 'video' }> {
  return (
    (node?.kind === 'audio' || node?.kind === 'video') &&
    node.parent !== null &&
    activeTreeNodeIds.has(node.id)
  )
}

/**
 * Project soundtrack gain at one Master-timeline instant.
 *
 * A regular cut resolves to either 0 or 1 according to the active occurrence.
 * During a crossfade, the outgoing and incoming visual weights are summed only
 * for occurrences whose Master audio is enabled. This gives muted boundaries
 * the same smooth envelope as the visual edit while preventing a fully audible
 * pair from doubling in volume.
 */
export function resolveMasterAudioGain(
  timeMap: SequenceTimeMap,
  masterTime: number,
): number {
  if (
    !Number.isFinite(masterTime) ||
    masterTime < 0 ||
    masterTime > timeMap.duration
  ) {
    return 0
  }
  const gain = resolveMasterTime(timeMap, masterTime, {
    clamp: true,
    quantize: 'none',
  }).layers.reduce(
    (total, layer) =>
      total + (layer.item.item.masterAudioMuted === true ? 0 : layer.weight),
    0,
  )
  return clamp(gain, 0, 1)
}

/** Visible Master-timeline duration after source trimming and playback rate. */
export function masterAudioClipDuration(
  node: Pick<
    MasterAudioNode,
    'duration' | 'playbackRate' | 'trimStart' | 'trimEnd'
  >,
): number {
  const sourceDuration = finiteNonNegative(node.duration)
  const trimStart = clamp(finiteNonNegative(node.trimStart), 0, sourceDuration)
  const trimEnd = clamp(
    Number.isFinite(node.trimEnd) ? node.trimEnd : sourceDuration,
    trimStart,
    sourceDuration,
  )
  return (trimEnd - trimStart) / safePlaybackRate(node.playbackRate)
}

/**
 * Resolve a pointer drag into a frame-aligned Master audio edit.
 *
 * Audio source trims are expressed in source seconds while the drag delta is
 * Master time. Converting through playbackRate keeps the audible content fixed
 * beneath the playhead when the leading edge is trimmed.
 */
export function editMasterAudioClip(
  node: Pick<
    MasterAudioNode,
    'duration' | 'playbackRate' | 'startTime' | 'trimStart' | 'trimEnd'
  >,
  mode: MasterAudioEditMode,
  requestedTimelineDelta: number,
  masterDuration: number,
  frameRate: number,
): MasterAudioClipWindow {
  const fps = normalizeFrameRate(frameRate)
  const frameStep = 1 / fps
  const rate = safePlaybackRate(node.playbackRate)
  const sourceDuration = finiteNonNegative(node.duration)
  const trimStart = clamp(finiteNonNegative(node.trimStart), 0, sourceDuration)
  const trimEnd = clamp(
    Number.isFinite(node.trimEnd) ? node.trimEnd : sourceDuration,
    trimStart,
    sourceDuration,
  )
  const startTime = finiteNonNegative(node.startTime)
  const timelineDuration = (trimEnd - trimStart) / rate
  const durationLimit = finiteNonNegative(masterDuration)
  const delta = quantizeTimeToFrame(
    Number.isFinite(requestedTimelineDelta) ? requestedTimelineDelta : 0,
    fps,
  )

  if (mode === 'move') {
    const minimumVisible = Math.min(frameStep, timelineDuration)
    const maxStart = Math.max(0, durationLimit - minimumVisible)
    return {
      startTime: clamp(
        quantizeTimeToFrame(startTime + delta, fps),
        0,
        maxStart,
      ),
      trimStart,
      trimEnd,
    }
  }

  if (mode === 'trim-start') {
    const minimumDelta = Math.max(-startTime, -trimStart / rate)
    const maximumDelta = Math.max(0, timelineDuration - frameStep)
    const appliedDelta = clamp(delta, minimumDelta, maximumDelta)
    return {
      startTime: quantizeTimeToFrame(startTime + appliedDelta, fps),
      trimStart: clamp(
        trimStart + appliedDelta * rate,
        0,
        Math.max(0, trimEnd - frameStep * rate),
      ),
      trimEnd,
    }
  }

  const minimumDelta = Math.min(0, -timelineDuration + frameStep)
  const sourceExpansion = Math.max(0, (sourceDuration - trimEnd) / rate)
  const masterExpansion = Math.max(
    0,
    durationLimit - (startTime + timelineDuration),
  )
  const maximumDelta = Math.min(sourceExpansion, masterExpansion)
  const appliedDelta = clamp(delta, minimumDelta, maximumDelta)
  return {
    startTime,
    trimStart,
    trimEnd: clamp(
      trimEnd + appliedDelta * rate,
      Math.min(sourceDuration, trimStart + frameStep * rate),
      sourceDuration,
    ),
  }
}

function safePlaybackRate(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
